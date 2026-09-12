// 预览合成器:canvas 逐帧绘制。视频/图片画到 canvas,音频用元素播放。
// 每个素材一个媒体元素,按当前播放头 seek;播放时用 rAF 主时钟推进。

import { useEffect, useRef } from 'react';
import { clipEnd, type Clip, type MediaAsset, type ProjectDoc } from '../../core/types.ts';
import { useEditor, useProject, editorStore } from '../hooks/useEditorStore.ts';

type Element = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

export function Preview() {
  const doc = useProject();
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elementsRef = useRef(new Map<string, Element>());

  // 素材元素池:按 assetId 缓存,doc.assets 变化时同步增删
  useEffect(() => {
    const pool = elementsRef.current;
    const wanted = new Set(doc.assets.map((a) => a.id));
    for (const [id, el] of pool) {
      if (!wanted.has(id)) {
        el.remove();
        pool.delete(id);
      }
    }
    for (const asset of doc.assets) {
      if (pool.has(asset.id)) continue;
      const el = createMediaElement(asset);
      pool.set(asset.id, el);
    }
  }, [doc.assets]);

  // 播放主时钟
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = (now - last) / 1000;
      last = now;
      if (editorStore.get().playing && !editorStore.tick(delta)) return;
      drawFrame(canvasRef.current, editorStore.get().history.present, elementsRef.current, editorStore.get().playhead);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 播放头/播放状态变化:同步媒体元素位置
  useEffect(() => {
    syncMedia(doc, elementsRef.current, editor.playhead, editor.playing);
  }, [editor.playhead, editor.playing, doc]);

  return (
    <div className="preview-wrap">
      <canvas ref={canvasRef} width={doc.width} height={doc.height} className="preview-canvas" />
      <div className="preview-meta">
        {doc.width}×{doc.height} · {doc.fps}fps · {editor.playhead.toFixed(2)}s
      </div>
    </div>
  );
}

function createMediaElement(asset: MediaAsset): Element {
  if (asset.kind === 'image') {
    const img = new Image();
    img.src = asset.url;
    return img;
  }
  const el = document.createElement(asset.kind === 'video' ? 'video' : 'audio');
  el.src = asset.url;
  el.preload = 'auto';
  return el;
}

function activeClipOnTrack(doc: ProjectDoc, trackId: string, time: number): Clip | null {
  return doc.clips.find((c) => c.trackId === trackId && time >= c.start && time < clipEnd(c)) ?? null;
}

function syncMedia(doc: ProjectDoc, pool: Map<string, Element>, time: number, playing: boolean): void {
  for (const clip of doc.clips) {
    const el = pool.get(clip.assetId);
    if (!el || el instanceof HTMLImageElement) continue;
    const active = time >= clip.start && time < clipEnd(clip);
    const target = clip.inPoint + (time - clip.start);
    if (!active || !playing) {
      el.pause();
      if (active && Math.abs(el.currentTime - target) > 0.05) el.currentTime = Math.max(0, target);
      continue;
    }
    if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = Math.max(0, target);
    void el.play().catch(() => undefined);
  }
}

function drawFrame(
  canvas: HTMLCanvasElement | null,
  doc: ProjectDoc,
  pool: Map<string, Element>,
  time: number,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const videoTracks = doc.tracks.filter((t) => t.kind === 'video');
  // 第一个视频轨在最底层,依次向上叠放
  for (const track of videoTracks) {
    const clip = activeClipOnTrack(doc, track.id, time);
    if (!clip) continue;
    const el = pool.get(clip.assetId);
    if (!el) continue;
    if (el instanceof HTMLImageElement) {
      drawContain(ctx, el, el.naturalWidth, el.naturalHeight, canvas);
      continue;
    }
    if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      drawContain(ctx, el, el.videoWidth, el.videoHeight, canvas);
    }
  }
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  canvas: HTMLCanvasElement,
): void {
  if (!sw || !sh) return;
  const scale = Math.min(canvas.width / sw, canvas.height / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
