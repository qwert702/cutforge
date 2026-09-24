// 预览合成器:canvas 逐帧绘制 + 播放主时钟。绘制逻辑与导出共用 compositor。

import { useEffect, useRef } from 'react';
import { projectDuration } from '../../core/select.ts';
import { clipEnd, sourceTimeAt, type ProjectDoc } from '../../core/types.ts';
import {
  disposePool,
  drawTimelineFrame,
  type MediaPool,
} from '../../render/compositor.ts';
import { editorStore, useEditor, useProject } from '../hooks/useEditorStore.ts';

export function Preview() {
  const doc = useProject();
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poolRef = useRef<MediaPool>(new Map());
  const drawnAssetsRef = useRef('');

  useEffect(() => {
    const pool = poolRef.current;
    const signature = doc.assets.map((a) => a.id).join(',');
    if (signature === drawnAssetsRef.current) return;
    drawnAssetsRef.current = signature;
    const wanted = new Set(doc.assets.map((a) => a.id));
    for (const [id, el] of pool) {
      if (!wanted.has(id)) {
        el.remove();
        pool.delete(id);
      }
    }
    for (const asset of doc.assets) {
      if (asset.kind === 'text' || pool.has(asset.id)) continue;
      const el = document.createElement(asset.kind === 'image' ? 'img' : asset.kind === 'video' ? 'video' : 'audio');
      el.src = asset.url;
      if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
        el.preload = 'auto';
        el.muted = true;
      }
      pool.set(asset.id, el);
    }
  }, [doc.assets]);

  // 播放主时钟:同时驱动画面重绘
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const delta = (now - last) / 1000;
      last = now;
      if (editorStore.get().playing && !editorStore.tick(delta)) return;
      drawFrameAt(editorStore.get().playhead);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 播放头/播放状态变化:同步媒体元素(发声/位置)
  useEffect(() => {
    syncMedia(doc, poolRef.current, editor.playhead, editor.playing);
    drawFrameAt(editor.playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.playhead, editor.playing, doc]);

  // 卸载时释放素材池
  useEffect(() => () => disposePool(poolRef.current), []);

  function drawFrameAt(time: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) drawTimelineFrame(ctx, editorStore.get().history.present, poolRef.current, time);
  }

  return (
    <div className="preview-wrap">
      <canvas ref={canvasRef} width={doc.width} height={doc.height} className="preview-canvas" />
      <div className="preview-meta">
        {doc.width}×{doc.height} · {doc.fps}fps · {editor.playhead.toFixed(2)}s / {projectDuration(doc).toFixed(2)}s
      </div>
    </div>
  );
}

function syncMedia(doc: ProjectDoc, pool: MediaPool, time: number, playing: boolean): void {
  for (const clip of doc.clips) {
    const el = pool.get(clip.assetId);
    if (!(el instanceof HTMLVideoElement) && !(el instanceof HTMLAudioElement)) continue;
    const media = el as HTMLVideoElement | HTMLAudioElement;
    const active = time >= clip.start && time < clipEnd(clip);
    const target = sourceTimeAt(clip, time);
    const speed = clip.speed ?? 1;
    if (media.playbackRate !== speed) {
      try { media.playbackRate = speed; } catch { /* 个别浏览器对极端值抛错 */ }
    }
    const volume = Math.min(1, Math.max(0, clip.volume ?? 1));
    if (media.volume !== volume) media.volume = volume;
    if (!active || !playing) {
      media.pause();
      if (active && Math.abs(media.currentTime - target) > 0.05) media.currentTime = Math.max(0, target);
      continue;
    }
    if (Math.abs(media.currentTime - target) > 0.25) media.currentTime = Math.max(0, target);
    void media.play().catch(() => undefined);
  }
}
