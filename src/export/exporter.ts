// 统一导出引擎:WebCodecs 编码 + webm-muxer / mp4-muxer 封装。
// 全程客户端完成,不依赖任何 GPL 组件:
//   WebM:VP9(回退 VP8)+ Opus
//   MP4 :H.264(AVC,回退探测)+ AAC(回退 Opus)
// 支持变速(sourceTimeAt)、音量与淡入淡出(音频增益自动化)、文字片段。

import { ArrayBufferTarget as WebMTarget, Muxer as WebMMuxer } from 'webm-muxer';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { projectDuration } from '../core/select.ts';
import { isTextClip, sourceSpan, sourceTimeAt, type ProjectDoc } from '../core/types.ts';
import {
  createPool,
  disposePool,
  drawTimelineFrame,
  seekElement,
} from '../render/compositor.ts';

export type ExportFormat = 'webm' | 'mp4';

export interface ExportProgress {
  readonly stage: 'video' | 'audio' | 'muxing';
  /** 0-1 */
  readonly ratio: number;
}

export interface ExportOptions {
  readonly format: ExportFormat;
  readonly fps?: number;
  readonly videoBitrate?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly hasAudio: boolean;
}

const AUDIO_SAMPLE_RATE = 48_000;

export function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

export async function exportProject(doc: ProjectDoc, options: ExportOptions): Promise<ExportResult> {
  if (!webCodecsAvailable()) throw new Error('此浏览器不支持 WebCodecs,无法导出(请用新版 Chrome/Edge)');
  const fps = options.fps ?? doc.fps;
  const duration = projectDuration(doc);
  if (duration <= 0) throw new Error('时间线为空,没有可导出的内容');
  const frameCount = Math.ceil(duration * fps);
  const hasAudio = doc.clips.some((c) => !isTextClip(c) && doc.assets.find((a) => a.id === c.assetId)?.kind !== 'image');

  if (options.format === 'mp4') {
    return runExport(doc, { ...options, fps, duration, frameCount, hasAudio }, {
      muxer: (target) => new Mp4Muxer({
        target,
        video: { codec: 'avc', width: doc.width, height: doc.height, frameRate: fps },
        ...(hasAudio ? { audio: { codec: 'aac', numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
        fastStart: 'in-memory',
      }),
      target: new Mp4Target(),
      mimeType: 'video/mp4',
      videoCodecs: ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'],
      audioCodecs: ['mp4a.40.2', 'opus'],
    });
  }
  return runExport(doc, { ...options, fps, duration, frameCount, hasAudio }, {
    muxer: (target) => new WebMMuxer({
      target,
      video: { codec: 'V_VP9', width: doc.width, height: doc.height, frameRate: fps },
      ...(hasAudio ? { audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
    }),
    target: new WebMTarget(),
    mimeType: 'video/webm',
    videoCodecs: ['vp09.00.10.08', 'vp8'],
    audioCodecs: ['opus'],
  });
}

// ── 通用导出流程 ────────────────────────────────────────────────────────────

interface FormatProfile<TTarget> {
  muxer: (target: TTarget) => { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void; finalize: () => void };
  target: TTarget & { buffer: ArrayBuffer };
  mimeType: string;
  videoCodecs: readonly string[];
  /** 依序尝试的音频编码器(AAC 失败回退 Opus) */
  audioCodecs: readonly string[];
}

async function runExport<TTarget>(
  doc: ProjectDoc,
  ctx: { format: ExportFormat; fps: number; duration: number; frameCount: number; hasAudio: boolean } & ExportOptions,
  profile: FormatProfile<TTarget>,
): Promise<ExportResult> {
  const { fps, frameCount } = ctx;
  const bitrate = ctx.videoBitrate ?? 6_000_000;

  let chosenVideo: string | null = null;
  for (const codec of profile.videoCodecs) {
    const support = await VideoEncoder.isConfigSupported({ codec, width: doc.width, height: doc.height, bitrate, framerate: fps });
    if (support.supported) {
      chosenVideo = codec;
      break;
    }
  }
  if (!chosenVideo) throw new Error('浏览器不支持所需的视频编码(导出 MP4 需要 H.264 硬件编码支持)');

  const muxer = profile.muxer(profile.target);

  await encodeVideo(doc, muxer, { ...ctx, videoCodec: chosenVideo, bitrate });
  let audioDone = false;
  if (ctx.hasAudio) {
    // 依序尝试音频编码(MP4: AAC → Opus),全部失败则静音输出
    for (let i = 0; i < profile.audioCodecs.length && !audioDone; i += 1) {
      try {
        await encodeAudio(doc, muxer, ctx, profile.audioCodecs[i]);
        audioDone = true;
      } catch {
        // 换下一个编码器或放弃音轨
      }
    }
  }
  ctx.onProgress?.({ stage: 'muxing', ratio: 0.5 });
  muxer.finalize();
  ctx.onProgress?.({ stage: 'muxing', ratio: 1 });
  const buffer = profile.target.buffer;
  return {
    blob: new Blob([buffer], { type: profile.mimeType }),
    mimeType: profile.mimeType,
    durationSeconds: ctx.duration,
    frameCount,
    hasAudio: audioDone,
  };
}

async function encodeVideo(
  doc: ProjectDoc,
  muxer: { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void },
  ctx: { fps: number; frameCount: number; videoCodec: string; bitrate: number; signal?: AbortSignal; onProgress?: (p: ExportProgress) => void },
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建导出画布');

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({
    codec: ctx.videoCodec,
    width: doc.width,
    height: doc.height,
    bitrate: ctx.bitrate,
    framerate: ctx.fps,
  });

  const pool = createPool(doc);
  try {
    await Promise.all(
      [...pool.values()]
        .filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement)
        .map((el) => waitReady(el)),
    );
    for (let frame = 0; frame < ctx.frameCount; frame += 1) {
      if (ctx.signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
      if (encodeError) throw encodeError;
      const time = frame / ctx.fps;
      // 逐帧精确 seek(含变速);文字/图片直接绘制
      for (const clip of doc.clips) {
        if (isTextClip(clip)) continue;
        const el = pool.get(clip.assetId);
        if (el instanceof HTMLVideoElement && time >= clip.start && time < clip.start + clip.duration) {
          await seekElement(el, sourceTimeAt(clip, time));
        }
      }
      drawTimelineFrame(context, doc, pool, time);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1e6) / ctx.fps),
        duration: Math.round(1e6 / ctx.fps),
      });
      encoder.encode(videoFrame, { keyFrame: frame % (ctx.fps * 2) === 0 });
      videoFrame.close();
      if (encoder.encodeQueueSize > 8) await drainQueue(encoder);
      ctx.onProgress?.({ stage: 'video', ratio: (frame + 1) / ctx.frameCount });
    }
    await encoder.flush();
  } finally {
    encoder.close();
    disposePool(pool);
  }
}

function waitReady(el: HTMLVideoElement): Promise<void> {
  if (el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('loadeddata', done);
      resolve();
    };
    el.addEventListener('loadeddata', done);
  });
}

function drainQueue(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (encoder.encodeQueueSize <= 4 ? resolve() : setTimeout(check, 8));
    check();
  });
}

// ── 音频:解码 → OfflineAudioContext 混音(变速/音量/淡入淡出)→ 编码 ─────────

async function encodeAudio(
  doc: ProjectDoc,
  muxer: { addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void },
  ctx: { duration: number; signal?: AbortSignal; onProgress?: (p: ExportProgress) => void },
  encoderCodec: string,
): Promise<void> {
  const audioClips = doc.clips.filter((c) => !isTextClip(c) && doc.assets.find((a) => a.id === c.assetId)?.kind !== 'image');
  if (audioClips.length === 0) return;

  const decodeContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
  const buffers = new Map<string, AudioBuffer>();
  try {
    for (const clip of audioClips) {
      const asset = doc.assets.find((a) => a.id === clip.assetId);
      if (!asset || buffers.has(asset.id)) continue;
      const response = await fetch(asset.url);
      const bytes = await response.arrayBuffer();
      buffers.set(asset.id, await decodeContext.decodeAudioData(bytes));
    }
  } finally {
    void decodeContext.close();
  }

  const frames = Math.ceil(ctx.duration * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, frames, AUDIO_SAMPLE_RATE);
  for (const clip of audioClips) {
    const buffer = buffers.get(clip.assetId);
    if (!buffer) continue;
    const source = offline.createBufferSource();
    source.buffer = buffer;
    const speed = clip.speed ?? 1;
    source.playbackRate.value = speed;
    const gain = offline.createGain();
    source.connect(gain).connect(offline.destination);
    // 音量与淡入淡出自动化
    const volume = clip.volume ?? 1;
    const startAt = Math.max(0, clip.start);
    const endAt = clip.start + clip.duration;
    gain.gain.setValueAtTime(clip.fadeIn ? 0 : volume, startAt);
    if (clip.fadeIn) gain.gain.linearRampToValueAtTime(volume, startAt + clip.fadeIn);
    if (clip.fadeOut) {
      gain.gain.setValueAtTime(volume, Math.max(startAt, endAt - clip.fadeOut));
      gain.gain.linearRampToValueAtTime(0, endAt);
    }
    source.start(clip.start, clip.inPoint, Math.min(sourceSpan(clip), buffer.duration - clip.inPoint));
  }
  const rendered = await offline.startRendering();

  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({ codec: encoderCodec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: 160_000 });

  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  const chunkFrames = 960; // 20ms @48k
  try {
    for (let offset = 0; offset < frames; offset += chunkFrames) {
      if (ctx.signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
      if (encodeError) throw encodeError;
      const count = Math.min(chunkFrames, frames - offset);
      const data = new Float32Array(count * 2);
      data.set(left.subarray(offset, offset + count), 0);
      data.set(right.subarray(offset, offset + count), count);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: count,
        numberOfChannels: 2,
        timestamp: Math.round((offset * 1e6) / AUDIO_SAMPLE_RATE),
        data,
      });
      encoder.encode(audioData);
      audioData.close();
      if (offset % (chunkFrames * 50) === 0) ctx.onProgress?.({ stage: 'audio', ratio: offset / frames });
    }
    await encoder.flush();
  } finally {
    encoder.close();
  }
}
