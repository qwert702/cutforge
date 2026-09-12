// 核心数据模型:不可变的工程文档。所有字段用秒表示(浮点),
// 帧精度的取整在渲染/导出边界做,核心层只关心时间轴语义。

export type TrackKind = 'video' | 'audio';
export type AssetKind = 'video' | 'audio' | 'image';

export interface MediaAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: AssetKind;
  /** blob: URL,仅当前会话有效 */
  readonly url: string;
  /** 图片为 null */
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface Track {
  readonly id: string;
  readonly kind: TrackKind;
  readonly name: string;
}

/** 时间线上的一段素材引用:start 为时间线位置,inPoint 为源内偏移。 */
export interface Clip {
  readonly id: string;
  readonly trackId: string;
  readonly assetId: string;
  readonly start: number;
  readonly duration: number;
  readonly inPoint: number;
}

export interface ProjectDoc {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** 有序:视频轨在前、音频轨在后 */
  readonly tracks: readonly Track[];
  readonly clips: readonly Clip[];
  readonly assets: readonly MediaAsset[];
}

export const clipEnd = (clip: Clip): number => clip.start + clip.duration;

/** 视频轨接受视频与图片;音频轨只接受音频。 */
export const assetSupportsTrack = (asset: MediaAsset, track: Track): boolean =>
  track.kind === 'video' ? asset.kind !== 'audio' : asset.kind === 'audio';

export function emptyProject(name = '未命名工程'): ProjectDoc {
  return { name, width: 1920, height: 1080, fps: 30, tracks: [], clips: [], assets: [] };
}

let counter = 0;
/** 可读的短 id;含随机后缀,跨会话/跨进程不冲突。 */
export function uid(prefix: string): string {
  counter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${counter.toString(36)}${rand}`;
}

/** 时间取整到工程 fps 对应的帧,消除浮点误差(核心层唯一的取整点)。 */
export function snapToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps) / fps;
}
