// 本地语音识别字幕:transformers.js(WASM)运行 Whisper,模型经 hf-mirror 下载。
// 全程在用户浏览器内推理,音频不出本机;模型只下载一次(浏览器 Cache 缓存)。
// 产出片段级字幕 [{start, end, text}] → 由调用方转成文字片段上字幕轨。

import type { MediaAsset } from '../core/types.ts';

// 模型下载主机:开发环境走 Vite 同源代理(/hf-proxy),生产环境可经
// localStorage `cutforge.asr.host` 指向自建 CORS 代理,否则退回 hf-mirror 直连
// (直连在多数浏览器会因重定向 CORS 失败,界面会给出明确提示)。
function resolveModelHost(): string {
  try {
    const configured = localStorage.getItem('cutforge.asr.host');
    if (configured) return configured.replace(/\/$/, '');
  } catch {
    /* 忽略 */
  }
  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {
    return `${location.origin}/hf-proxy`;
  }
  return 'https://hf-mirror.com';
}

const MODEL_ID = 'onnx-community/whisper-tiny';
const DTYPE = 'q8';

export interface SubtitleSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface AsrProgress {
  readonly stage: 'model' | 'transcribe';
  /** 0-1;模型下载阶段为累计进度 */
  readonly ratio: number;
  readonly detail?: string;
}

export interface TranscribeOptions {
  /** 'zh' | 'en' | 'auto'(whisper 语言码) */
  readonly language?: string;
  readonly onProgress?: (progress: AsrProgress) => void;
  readonly signal?: AbortSignal;
}

interface AsrPipeline {
  (audio: Float32Array, options?: Record<string, unknown>): Promise<{
    text: string;
    chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
  }>;
}

let pipelinePromise: Promise<AsrPipeline> | null = null;

/** 懒加载识别管线(首次调用触发模型下载,之后走浏览器缓存)。 */
async function getPipeline(onProgress?: (p: AsrProgress) => void, signal?: AbortSignal): Promise<AsrPipeline> {
  pipelinePromise ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.remoteHost = resolveModelHost();
    env.allowLocalModels = false;
    const fileProgress = new Map<string, number>();
    return pipeline('automatic-speech-recognition', MODEL_ID, {
      dtype: DTYPE,
      device: 'wasm',
      progress_callback: (info: { status?: string; file?: string; progress?: number }) => {
        if (info.status === 'progress' && info.file) {
          fileProgress.set(info.file, (info.progress ?? 0) / 100);
          const values = [...fileProgress.values()];
          const ratio = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
          onProgress?.({ stage: 'model', ratio, detail: `下载模型 ${Math.round(ratio * 100)}%` });
        }
      },
    }) as unknown as Promise<AsrPipeline>;
  })();
  // 失败时清除缓存以便重试
  pipelinePromise.catch(() => {
    pipelinePromise = null;
  });
  void signal;
  return pipelinePromise;
}

/** 把任意媒体素材解码为 16kHz 单声道 Float32(whisper 输入要求)。 */
export async function decodeToMono16k(asset: MediaAsset): Promise<Float32Array> {
  const response = await fetch(asset.url);
  const bytes = await response.arrayBuffer();
  try {
    return mixdown(await decodeWith(bytes, 16_000));
  } catch {
    // 部分环境下低采样率上下文解码会间歇失败:退回原生采样率,再手动重采样
    const buffer = await decodeWith(bytes, undefined);
    return buffer.sampleRate === 16_000 ? mixdown(buffer) : resampleTo16k(buffer);
  }
}

async function decodeWith(bytes: ArrayBuffer, sampleRate: number | undefined): Promise<AudioBuffer> {
  const context = sampleRate ? new AudioContext({ sampleRate }) : new AudioContext();
  try {
    // Chrome 会接管(detach)传入的缓冲:传副本,保证失败重试时缓冲仍可用
    return await context.decodeAudioData(bytes.slice(0));
  } finally {
    void context.close();
  }
}

function mixdown(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

/** 线性插值重采样到 16kHz 并混音为单声道。 */
function resampleTo16k(buffer: AudioBuffer): Float32Array {
  const source = buffer.sampleRate;
  const target = 16_000;
  const length = Math.floor((buffer.length * target) / source);
  const mono = new Float32Array(length);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) channels.push(buffer.getChannelData(ch));
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = Math.min(buffer.length - 1, (i * source) / target);
    const left = Math.floor(sourceIndex);
    const frac = sourceIndex - left;
    let sum = 0;
    for (const data of channels) {
      sum += data[left] * (1 - frac) + data[Math.min(data.length - 1, left + 1)] * frac;
    }
    mono[i] = sum / channels.length;
  }
  return mono;
}

/** 识别素材语音,返回带时间戳的字幕片段(时间相对素材开头)。 */
export async function transcribeAsset(
  asset: MediaAsset,
  options: TranscribeOptions = {},
): Promise<SubtitleSegment[]> {
  options.onProgress?.({ stage: 'transcribe', ratio: 0, detail: '解码音频…' });
  const audio = await decodeToMono16k(asset);
  const transcriber = await getPipeline((progress) => options.onProgress?.(progress), options.signal);
  options.signal?.throwIfAborted();
  options.onProgress?.({ stage: 'transcribe', ratio: 0.3, detail: '识别中…' });
  const output = await transcriber(audio, {
    return_timestamps: true,
    ...(options.language && options.language !== 'auto' ? { language: options.language, task: 'transcribe' } : {}),
  });
  options.onProgress?.({ stage: 'transcribe', ratio: 1 });
  const chunks = output.chunks ?? [];
  const segments: SubtitleSegment[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (!text) continue;
    segments.push({
      start: chunk.timestamp[0] ?? 0,
      end: chunk.timestamp[1] ?? (chunk.timestamp[0] ?? 0) + 2,
      text,
    });
  }
  // 模型没给分片时退化为整段一条
  if (segments.length === 0 && output.text.trim()) {
    segments.push({ start: 0, end: audio.length / 16_000, text: output.text.trim() });
  }
  return segments;
}

/** 是否首次使用(用于 UI 提示需要下载模型)。 */
export const MODEL_INFO = { id: MODEL_ID, dtype: DTYPE };
