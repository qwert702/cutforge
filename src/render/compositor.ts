// 时间线合成器:预览播放与导出共用的"某一时刻画面"绘制逻辑。
// 池中每个素材一个媒体元素;视频轨自下而上叠放,contain 缩放居中;
// 文字片段直接绘制;片段的淡入淡出作为全画面转场叠加。

import { clipEnd, type MediaAsset, type ProjectDoc } from '../core/types.ts';

export type PoolElement = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
export type MediaPool = Map<string, PoolElement>;

export function createMediaElement(asset: MediaAsset): PoolElement {
  if (asset.kind === 'image') {
    const img = new Image();
    img.src = asset.url;
    return img;
  }
  const el = document.createElement(asset.kind === 'video' ? 'video' : 'audio');
  el.src = asset.url;
  el.preload = 'auto';
  el.muted = true; // 默认静音:预览的发声由播放逻辑控制
  return el;
}

export function createPool(doc: ProjectDoc): MediaPool {
  const pool: MediaPool = new Map();
  for (const asset of doc.assets) {
    if (asset.kind === 'text') continue;
    pool.set(asset.id, createMediaElement(asset));
  }
  return pool;
}

export function disposePool(pool: MediaPool): void {
  for (const el of pool.values()) {
    el.remove();
    if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
      el.removeAttribute('src');
      el.load();
    }
  }
  pool.clear();
}

export function activeClipOnTrack(doc: ProjectDoc, trackId: string, time: number) {
  return doc.clips.find((c) => c.trackId === trackId && time >= c.start && time < clipEnd(c)) ?? null;
}

/** 把某个视频素材精确定位到源内时间(含变速),返回 seek 完成的 Promise(带超时兜底)。 */
export function seekElement(el: HTMLVideoElement, sourceTime: number): Promise<void> {
  if (Math.abs(el.currentTime - sourceTime) < 0.001 && el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2000); // 个别编解码 seek 事件丢失时兜底
    el.addEventListener('seeked', done);
    try {
      el.currentTime = Math.max(0, sourceTime);
    } catch {
      done();
    }
  });
}

/** 淡入淡出在时刻 t 的叠加不透明度(0 = 无叠加)。 */
export function fadeAlphaAt(
  clip: { start: number; duration: number; fadeIn?: number; fadeOut?: number },
  t: number,
): number {
  const end = clip.start + clip.duration;
  let alpha = 0;
  const elapsed = t - clip.start;
  const remaining = end - t;
  if (clip.fadeIn && clip.fadeIn > 0 && elapsed < clip.fadeIn) {
    alpha = Math.max(alpha, 1 - elapsed / clip.fadeIn);
  }
  if (clip.fadeOut && clip.fadeOut > 0 && remaining < clip.fadeOut) {
    alpha = Math.max(alpha, 1 - remaining / clip.fadeOut);
  }
  return Math.min(1, Math.max(0, alpha));
}

/** 绘制 time 时刻的完整画面(视频轨按顺序叠放 + 文字 + 转场叠加)。 */
export function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  doc: ProjectDoc,
  pool: MediaPool,
  time: number,
): void {
  const canvas = ctx.canvas;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let fadeAlpha = 0;
  let fadeColor = '0,0,0';

  const videoTracks = doc.tracks.filter((t) => t.kind === 'video');
  for (const track of videoTracks) {
    const clip = activeClipOnTrack(doc, track.id, time);
    if (!clip) continue;
    if (clip.text !== undefined) {
      drawTextClip(ctx, clip.text, canvas.width, canvas.height);
    } else {
      const el = pool.get(clip.assetId);
      if (!el) continue;
      if (el instanceof HTMLImageElement) {
        if (el.complete && el.naturalWidth > 0) {
          drawContain(ctx, el, el.naturalWidth, el.naturalHeight, canvas.width, canvas.height);
        }
      } else if (el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0) {
        drawContain(ctx, el, el.videoWidth, el.videoHeight, canvas.width, canvas.height);
      }
    }
    // 转场叠加:取最上层片段的淡入淡出(取最大不透明度)
    const alpha = fadeAlphaAt(clip, time);
    if (alpha > fadeAlpha) {
      fadeAlpha = alpha;
      fadeColor = clip.fadeType === 'white' ? '255,255,255' : '0,0,0';
    }
  }

  if (fadeAlpha > 0.001) {
    ctx.fillStyle = `rgba(${fadeColor},${fadeAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  text: { content: string; size: number; color: string; x?: number; y?: number },
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!text.content.trim()) return;
  ctx.save();
  ctx.font = `${text.size}px 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = (text.x ?? 0.5) * canvasWidth;
  const y = (text.y ?? 0.5) * canvasHeight;
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = text.size / 7;
  ctx.fillStyle = text.color;
  // 支持多行
  const lines = text.content.split('\n');
  const lineHeight = text.size * 1.3;
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, startY + i * lineHeight));
  ctx.restore();
}

export function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (!sw || !sh) return;
  const scale = Math.min(canvasWidth / sw, canvasHeight / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (canvasWidth - w) / 2, (canvasHeight - h) / 2, w, h);
}
