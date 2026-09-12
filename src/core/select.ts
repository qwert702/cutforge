// 选择器:从工程文档派生的只读查询。

import { clipEnd, type Clip, type ProjectDoc } from './types.ts';

export function trackById(doc: ProjectDoc, trackId: string) {
  return doc.tracks.find((t) => t.id === trackId) ?? null;
}

export function assetById(doc: ProjectDoc, assetId: string) {
  return doc.assets.find((a) => a.id === assetId) ?? null;
}

export function clipById(doc: ProjectDoc, clipId: string) {
  return doc.clips.find((c) => c.id === clipId) ?? null;
}

export function clipsOnTrack(doc: ProjectDoc, trackId: string): readonly Clip[] {
  return doc.clips.filter((c) => c.trackId === trackId).toSorted((a, b) => a.start - b.start);
}

export function clipsAtTime(doc: ProjectDoc, time: number): readonly Clip[] {
  return doc.clips.filter((c) => time >= c.start && time < clipEnd(c));
}

/** 工程总时长(时间线上最后一个片段的结束点)。 */
export function projectDuration(doc: ProjectDoc): number {
  return doc.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/** 给定区间内是否与同轨已有片段重叠(可排除某个片段,用于 move/trim)。 */
export function hasOverlap(
  doc: ProjectDoc,
  trackId: string,
  start: number,
  end: number,
  excludeClipId?: string,
): boolean {
  return doc.clips.some(
    (c) =>
      c.trackId === trackId &&
      c.id !== excludeClipId &&
      start < clipEnd(c) &&
      end > c.start,
  );
}

/**
 * 从 `from` 起在目标轨道上向后寻找第一个能放下 `duration` 的空闲起点。
 * 用于 duplicate 与拖拽落点的自动吸附。
 */
export function findFreeStart(
  doc: ProjectDoc,
  trackId: string,
  duration: number,
  from: number,
): number {
  const clips = clipsOnTrack(doc, trackId).filter((c) => clipEnd(c) > from);
  let candidate = from;
  for (const clip of clips) {
    if (candidate + duration <= clip.start) return candidate;
    candidate = Math.max(candidate, clipEnd(clip));
  }
  return candidate;
}
