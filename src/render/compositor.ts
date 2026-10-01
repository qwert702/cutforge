// 时间线合成器:预览播放与导出共用的"某一时刻画面"绘制逻辑。
// 池中每个素材一个媒体元素;视频轨自下而上叠放,contain 缩放居中;
// 文字片段直接绘制;片段的淡入淡出作为全画面转场叠加。

import { clipEnd, clipTransformAt, type Clip, type ClipTransform, type MediaAsset, type ProjectDoc } from '../core/types.ts';
import { previousAdjacentClip } from '../core/select.ts';
import { filterCssFor } from './filters.ts';

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
    const transform = clipTransformAt(clip, time);
    if (transform.opacity <= 0.001) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, transform.opacity);
    ctx.filter = filterCssFor(clip.filter?.preset, clip.filter?.intensity);

    // 片段间转场:入场片开始后的 duration 秒内,与前一片段末帧定格双层过渡
    const transition = clip.transitionIn;
    const prev = transition ? previousAdjacentClip(doc, clip) : null;
    if (transition && prev && time < clip.start + transition.duration) {
      const progress = Math.min(1, Math.max(0, (time - clip.start) / transition.duration));
      drawTransitionPair(ctx, pool, prev, clip, progress, transition.type, canvas.width, canvas.height);
      ctx.restore();
      const alpha = fadeAlphaAt(clip, time);
      if (alpha > fadeAlpha) {
        fadeAlpha = alpha;
        fadeColor = clip.fadeType === 'white' ? '255,255,255' : '0,0,0';
      }
      continue;
    }

    if (clip.text !== undefined) {
      // 文字片段:位置由文字样式决定,关键帧提供缩放/旋转/透明度
      drawTextClip(ctx, clip.text, canvas.width, canvas.height, transform);
    } else {
      const el = pool.get(clip.assetId);
      if (!el) {
        ctx.restore();
        continue;
      }
      if (el instanceof HTMLImageElement) {
        if (el.complete && el.naturalWidth > 0) {
          drawMediaAt(ctx, el, el.naturalWidth, el.naturalHeight, canvas.width, canvas.height, transform);
        }
      } else if (el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0) {
        drawMediaAt(ctx, el, el.videoWidth, el.videoHeight, canvas.width, canvas.height, transform);
      }
    }
    ctx.restore();
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
  text: { content: string; size: number; color: string; x?: number; y?: number; stroke?: { color: string; width: number } },
  canvasWidth: number,
  canvasHeight: number,
  transform: ClipTransform,
): void {
  if (!text.content.trim()) return;
  ctx.save();
  ctx.font = `${text.size}px 'Segoe UI', 'Microsoft YaHei', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const anchorX = (text.x ?? 0.5) * canvasWidth;
  const anchorY = (text.y ?? 0.5) * canvasHeight;
  ctx.translate(anchorX, anchorY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scale, transform.scale);
  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = text.size / 7;
  ctx.fillStyle = text.color;
  // 支持多行
  const lines = text.content.split('\n');
  const lineHeight = text.size * 1.3;
  const startY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    // 花字描边:先描边再填充
    if (text.stroke && text.stroke.width > 0) {
      ctx.lineWidth = text.stroke.width;
      ctx.strokeStyle = text.stroke.color;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, y);
    }
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

/** 片段间转场:前片段末帧定格 + 入场片段按类型过渡(双层绘制)。 */
function drawTransitionPair(
  ctx: CanvasRenderingContext2D,
  pool: MediaPool,
  prev: Clip,
  incoming: Clip,
  progress: number,
  type: 'dissolve' | 'slide-left' | 'slide-right' | 'wipe' | 'zoom',
  canvasWidth: number,
  canvasHeight: number,
): void {
  const drawClipLayer = (clip: Clip, alpha: number, offsetX: number, zoom: number, clipRect: { w: number } | null): void => {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, Math.max(0, alpha));
    if (clipRect) {
      ctx.beginPath();
      ctx.rect(0, 0, canvasWidth * clipRect.w, canvasHeight);
      ctx.clip();
    }
    if (clip.text !== undefined) {
      drawTextClip(ctx, clip.text, canvasWidth, canvasHeight, clipTransformAt(clip, clip.start + clip.duration - 0.001));
      ctx.restore();
      return;
    }
    const el = pool.get(clip.assetId);
    if (!el) {
      ctx.restore();
      return;
    }
    const transform = clipTransformAt(clip, clip.start + clip.duration - 0.001); // 末帧状态
    const shift = offsetX * canvasWidth;
    ctx.translate(shift, 0);
    if (el instanceof HTMLImageElement) {
      if (el.complete && el.naturalWidth > 0) {
        drawMediaAt(ctx, el, el.naturalWidth, el.naturalHeight, canvasWidth, canvasHeight, { ...transform, scale: transform.scale * zoom });
      }
    } else if (el instanceof HTMLVideoElement && el.readyState >= 2 && el.videoWidth > 0) {
      drawMediaAt(ctx, el, el.videoWidth, el.videoHeight, canvasWidth, canvasHeight, { ...transform, scale: transform.scale * zoom });
    }
    ctx.restore();
  };

  // 前片段:末帧定格(其媒体元素在转场窗口内保持最后位置)
  switch (type) {
    case 'dissolve':
      drawClipLayer(prev, 1, 0, 1, null);
      drawClipLayer(incoming, progress, 0, 1, null);
      break;
    case 'slide-left': // 入场片从右向左滑入
      drawClipLayer(prev, 1, -progress * 0.6, 1, null);
      drawClipLayer(incoming, 1, (1 - progress) * 1.0, 1, null);
      break;
    case 'slide-right':
      drawClipLayer(prev, 1, progress * 0.6, 1, null);
      drawClipLayer(incoming, 1, -(1 - progress) * 1.0, 1, null);
      break;
    case 'wipe': // 入场片从左向右擦除覆盖
      drawClipLayer(prev, 1, 0, 1, null);
      drawClipLayer(incoming, 1, 0, 1, { w: progress });
      break;
    case 'zoom': // 前片段放大淡出,入场片浮现
      drawClipLayer(prev, 1 - progress, 0, 1 + progress * 0.4, null);
      drawClipLayer(incoming, progress, 0, 1, null);
      break;
  }
}

/** contain 适配 + 关键帧变换(位置/缩放/旋转),以画布中心为默认锚点。 */
export function drawMediaAt(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  canvasWidth: number,
  canvasHeight: number,
  transform: ClipTransform,
): void {
  if (!sw || !sh) return;
  const scale = Math.min(canvasWidth / sw, canvasHeight / sh) * transform.scale;
  const w = sw * scale;
  const h = sh * scale;
  ctx.translate(transform.x * canvasWidth, transform.y * canvasHeight);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.drawImage(source, -w / 2, -h / 2, w, h);
}

export function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  drawMediaAt(ctx, source, sw, sh, canvasWidth, canvasHeight, {
    x: 0.5, y: 0.5, scale: 1, opacity: 1, rotation: 0,
  });
}
