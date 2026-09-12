// 纯 reducer:输入 (doc, command),输出 ApplyResult。
// 不变式:
//   1. 同一轨道上的片段互不重叠;
//   2. 片段的 inPoint >= 0,且音视频素材满足 inPoint + duration <= 源时长;
//   3. 片段所属轨道必须存在,且素材类型与轨道类型兼容;
//   4. 所有命令携带显式 id,重放是确定性的。
// 违反不变式的命令返回 ok:false,文档原样返回(不产生撤销点)。

import type { ApplyResult, Command } from './commands.ts';
import {
  assetSupportsTrack,
  clipEnd,
  snapToFrame,
  type Clip,
  type ProjectDoc,
} from './types.ts';
import { assetById, clipById, findFreeStart, hasOverlap, trackById } from './select.ts';

const EPSILON = 1e-9;

function round(doc: ProjectDoc, seconds: number): number {
  return snapToFrame(seconds, doc.fps);
}

function normalizeClip(doc: ProjectDoc, clip: Clip): Clip {
  return { ...clip, start: round(doc, clip.start), duration: round(doc, clip.duration), inPoint: round(doc, clip.inPoint) };
}

function validateClip(doc: ProjectDoc, clip: Clip): string | null {
  if (!(clip.duration > EPSILON)) return '片段时长必须大于 0';
  if (clip.start < -EPSILON) return '片段起点不能为负';
  if (clip.inPoint < -EPSILON) return '素材内偏移不能为负';
  const track = trackById(doc, clip.trackId);
  if (!track) return `轨道不存在:${clip.trackId}`;
  const asset = assetById(doc, clip.assetId);
  if (!asset) return `素材不存在:${clip.assetId}`;
  if (!assetSupportsTrack(asset, track)) return `音频素材不能放到视频轨以外的轨道(${track.kind})`;
  if (asset.durationSeconds !== null && clip.inPoint + clip.duration > asset.durationSeconds + EPSILON) {
    return '片段超出了素材源时长';
  }
  if (hasOverlap(doc, clip.trackId, clip.start, clipEnd(clip), clip.id)) return '与同轨片段重叠';
  return null;
}

export function applyCommand(doc: ProjectDoc, command: Command): ApplyResult {
  switch (command.type) {
    case 'project.rename': {
      const name = command.name.trim();
      if (!name) return { ok: false, error: '工程名不能为空' };
      return { ok: true, doc: { ...doc, name } };
    }

    case 'asset.add': {
      if (doc.assets.some((a) => a.id === command.asset.id)) return { ok: false, error: '素材 id 已存在' };
      return { ok: true, doc: { ...doc, assets: [...doc.assets, command.asset] } };
    }

    case 'track.add': {
      const { track } = command;
      if (doc.tracks.some((t) => t.id === track.id)) return { ok: false, error: '轨道 id 已存在' };
      if (!track.name.trim()) return { ok: false, error: '轨道名不能为空' };
      const tracks = track.kind === 'video'
        ? [...doc.tracks.filter((t) => t.kind === 'video'), track, ...doc.tracks.filter((t) => t.kind === 'audio')]
        : [...doc.tracks.filter((t) => t.kind === 'video'), ...doc.tracks.filter((t) => t.kind === 'audio'), track];
      return { ok: true, doc: { ...doc, tracks } };
    }

    case 'track.remove': {
      if (!trackById(doc, command.trackId)) return { ok: false, error: '轨道不存在' };
      return {
        ok: true,
        doc: {
          ...doc,
          tracks: doc.tracks.filter((t) => t.id !== command.trackId),
          clips: doc.clips.filter((c) => c.trackId !== command.trackId),
        },
      };
    }

    case 'track.rename': {
      const track = trackById(doc, command.trackId);
      if (!track) return { ok: false, error: '轨道不存在' };
      const name = command.name.trim();
      if (!name) return { ok: false, error: '轨道名不能为空' };
      return {
        ok: true,
        doc: { ...doc, tracks: doc.tracks.map((t) => (t.id === track.id ? { ...t, name } : t)) },
      };
    }

    case 'clip.add': {
      const clip = normalizeClip(doc, command.clip);
      const error = validateClip(doc, clip);
      if (error) return { ok: false, error };
      return { ok: true, doc: { ...doc, clips: [...doc.clips, clip] } };
    }

    case 'clip.move': {
      const clip = clipById(doc, command.clipId);
      if (!clip) return { ok: false, error: '片段不存在' };
      const trackId = command.trackId ?? clip.trackId;
      const moved = normalizeClip(doc, { ...clip, trackId, start: command.start });
      const error = validateClip(doc, moved);
      if (error) return { ok: false, error };
      return { ok: true, doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? moved : c)) } };
    }

    case 'clip.trim': {
      const clip = clipById(doc, command.clipId);
      if (!clip) return { ok: false, error: '片段不存在' };
      // 语义:只给 start → 右边缘不动(时长收缩,inPoint 跟随移动);
  //      只给 duration → 左边缘不动(inPoint 不变);两者都给 → 显式设置。
      const oldEnd = clipEnd(clip);
      const start = command.start ?? clip.start;
      const duration = command.duration ?? (command.start !== undefined ? oldEnd - start : clip.duration);
      const trimmed = normalizeClip(doc, { ...clip, start, duration, inPoint: clip.inPoint + (start - clip.start) });
      const error = validateClip(doc, trimmed);
      if (error) return { ok: false, error };
      return { ok: true, doc: { ...doc, clips: doc.clips.map((c) => (c.id === clip.id ? trimmed : c)) } };
    }

    case 'clip.split': {
      const clip = clipById(doc, command.clipId);
      if (!clip) return { ok: false, error: '片段不存在' };
      const at = round(doc, command.at);
      if (!(at > clip.start + EPSILON && at < clipEnd(clip) - EPSILON)) {
        return { ok: false, error: '分割点必须在片段内部' };
      }
      const leftDuration = round(doc, at - clip.start);
      const right: Clip = {
        ...clip,
        id: command.newClipId,
        start: at,
        duration: round(doc, clipEnd(clip) - at),
        inPoint: round(doc, clip.inPoint + leftDuration),
      };
      const left: Clip = { ...clip, duration: leftDuration };
      // 此时文档里 left 尚未收缩,校验右侧需排除原片段自身,
      // 否则右侧必然与"还没变短的 left"误判重叠。
      if (hasOverlap(doc, clip.trackId, right.start, clipEnd(right), clip.id)) {
        return { ok: false, error: '与同轨片段重叠' };
      }
      return {
        ok: true,
        doc: { ...doc, clips: [...doc.clips.map((c) => (c.id === clip.id ? left : c)), right] },
      };
    }

    case 'clip.remove': {
      if (!clipById(doc, command.clipId)) return { ok: false, error: '片段不存在' };
      return { ok: true, doc: { ...doc, clips: doc.clips.filter((c) => c.id !== command.clipId) } };
    }

    case 'clip.duplicate': {
      const clip = clipById(doc, command.clipId);
      if (!clip) return { ok: false, error: '片段不存在' };
      if (doc.clips.some((c) => c.id === command.newClipId)) return { ok: false, error: '片段 id 已存在' };
      const start = findFreeStart(doc, clip.trackId, clip.duration, clipEnd(clip));
      const copy = normalizeClip(doc, { ...clip, id: command.newClipId, start });
      return { ok: true, doc: { ...doc, clips: [...doc.clips, copy] } };
    }
  }
}
