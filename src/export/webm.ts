// WebM 导出:WebCodecs 编码(VP9 视频 + Opus 音频)+ webm-muxer 封装。
// 全程客户端完成,不依赖任何 GPL 组件;浏览器需支持 WebCodecs
// (Chrome/Edge 94+,Firefox 130+)。

import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { projectDuration } from '../core/select.ts';
import type { ProjectDoc } from '../core/types.ts';
import { createPool, disposePool, drawTimelineFrame, seekElement } from '../render/compositor.ts';

export interface ExportProgress {
  readonly stage: 'video' | 'audio' | 'muxing';
  /** 0-1 */
  readonly ratio: number;
}

export interface ExportOptions {
  readonly fps?: number;
  readonly videoBitrate?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export interface ExportResult {
  readonly blob: Blob;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly hasAudio: boolean;
}

const AUDIO_SAMPLE_RATE = 48_000;

export function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

export async function exportWebM(doc: ProjectDoc, options: ExportOptions = {}): Promise<ExportResult> {
  if (!webCodecsAvailable()) throw new Error('此浏览器不支持 WebCodecs,无法导出(请用新版 Chrome/Edge)');
  const fps = options.fps ?? doc.fps;
  const duration = projectDuration(doc);
  if (duration <= 0) throw new Error('时间线为空,没有可导出的内容');
  const frameCount = Math.ceil(duration * fps);
  const hasAudio = doc.clips.some((c) => {
    const asset = doc.assets.find((a) => a.id === c.assetId);
    return asset?.kind === 'audio' || asset?.kind === 'video';
  });

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP9', width: doc.width, height: doc.height, frameRate: fps },
    ...(hasAudio ? { audio: { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
  });

  await encodeVideo(doc, muxer, { ...options, fps, frameCount });
  let audioDone = false;
  if (hasAudio) {
    try {
      await encodeAudio(doc, muxer, { ...options, duration });
      audioDone = true;
    } catch {
      // 音频失败不阻塞视频导出(例如格式无法解码),静音输出
    }
  }
  options.onProgress?.({ stage: 'muxing', ratio: 0.5 });
  muxer.finalize();
  options.onProgress?.({ stage: 'muxing', ratio: 1 });
  const { buffer } = target;
  return {
    blob: new Blob([buffer], { type: 'video/webm' }),
    durationSeconds: duration,
    frameCount,
    hasAudio: audioDone,
  };
}

// ── 视频:逐帧 seek → 绘制 → VideoFrame → VP9 编码 ──────────────────────────

async function encodeVideo(
  doc: ProjectDoc,
  muxer: Muxer<ArrayBufferTarget>,
  options: ExportOptions & { fps: number; frameCount: number },
): Promise<void> {
  const { fps, frameCount } = options;
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('无法创建导出画布');

  // VP9 优先,老浏览器回退 VP8
  let chosen: string | null = null;
  for (const codec of ['vp09.00.10.08', 'vp8']) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width: doc.width,
      height: doc.height,
      bitrate: options.videoBitrate ?? 4_000_000,
      framerate: fps,
    });
    if (support.supported) {
      chosen = codec;
      break;
    }
  }
  if (!chosen) throw new Error('浏览器不支持 VP9/VP8 编码');

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({
    codec: chosen,
    width: doc.width,
    height: doc.height,
    bitrate: options.videoBitrate ?? 4_000_000,
    framerate: fps,
  });

  const pool = createPool(doc);
  try {
    // 等所有视频素材元数据就绪
    await Promise.all(
      [...pool.values()]
        .filter((el): el is HTMLVideoElement => el instanceof HTMLVideoElement)
        .map((el) => waitReady(el)),
    );
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
      if (encodeError) throw encodeError;
      const time = frame / fps;
      // 逐帧精确 seek 绘制(确定性优先;速度依赖浏览器 seek 性能)
      for (const clip of doc.clips) {
        const el = pool.get(clip.assetId);
        if (el instanceof HTMLVideoElement && time >= clip.start && time < clip.start + clip.duration) {
          await seekElement(el, clip.inPoint + (time - clip.start));
        }
      }
      drawTimelineFrame(ctx, doc, pool, time);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
      videoFrame.close();
      if (encoder.encodeQueueSize > 8) {
        await waitForQueueDrain(encoder);
      }
      options.onProgress?.({ stage: 'video', ratio: (frame + 1) / frameCount });
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

function waitForQueueDrain(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (encoder.encodeQueueSize <= 4 ? resolve() : setTimeout(check, 8));
    check();
  });
}

// ── 音频:解码素材 → OfflineAudioContext 混音 → Opus 编码 ────────────────────

async function encodeAudio(
  doc: ProjectDoc,
  muxer: Muxer<ArrayBufferTarget>,
  options: ExportOptions & { duration: number },
): Promise<void> {
  const audioClips = doc.clips.filter((c) => {
    const asset = doc.assets.find((a) => a.id === c.assetId);
    return asset?.kind === 'audio' || asset?.kind === 'video';
  });
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

  const frames = Math.ceil(options.duration * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, frames, AUDIO_SAMPLE_RATE);
  for (const clip of audioClips) {
    const buffer = buffers.get(clip.assetId);
    if (!buffer) continue;
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start(clip.start, clip.inPoint, Math.min(clip.duration, buffer.duration - clip.inPoint));
  }
  const rendered = await offline.startRendering();

  let encodeError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encodeError = error instanceof Error ? error : new Error(String(error));
    },
  });
  encoder.configure({ codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: 128_000 });

  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  const chunkFrames = 960; // 20ms @48k
  try {
    for (let offset = 0; offset < frames; offset += chunkFrames) {
      if (options.signal?.aborted) throw new DOMException('导出已取消', 'AbortError');
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
      if (offset % (chunkFrames * 50) === 0) {
        options.onProgress?.({ stage: 'audio', ratio: offset / frames });
      }
    }
    await encoder.flush();
  } finally {
    encoder.close();
  }
}
