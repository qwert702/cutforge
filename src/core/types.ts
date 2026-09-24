// 核心数据模型:不可变的工程文档。所有字段用秒表示(浮点),
// 帧精度的取整在渲染/导出边界做,核心层只关心时间轴语义。

export type TrackKind = 'video' | 'audio';
/** text 素材 = 无源文件的合成素材(内容由片段携带) */
export type AssetKind = 'video' | 'audio' | 'image' | 'text';

export interface MediaAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: AssetKind;
  /** blob: URL,仅当前会话有效;text 素材为空串 */
  readonly url: string;
  /** 图片/文字为 null;text 素材视作无限长 */
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface Track {
  readonly id: string;
  readonly kind: TrackKind;
  readonly name: string;
}

/** 文字片段的内容与样式(画布坐标系,px 按工程分辨率) */
export interface TextSpec {
  readonly content: string;
  readonly size: number;
  readonly color: string;
  /** 0-1 相对画布宽高的锚点位置;省略时水平/垂直居中 */
  readonly x?: number;
  readonly y?: number;
}

/** 时间线上的一段素材引用:start 为时间线位置,inPoint 为源内偏移。 */
export interface Clip {
  readonly id: string;
  readonly trackId: string;
  /** 文字片段没有素材,固定为空串 */
  readonly assetId: string;
  readonly start: number;
  readonly duration: number;
  readonly inPoint: number;
  /** 播放速度 0.25-4,默认 1;源时间映射 sourceTime = inPoint + (t-start)*speed */
  readonly speed?: number;
  /** 音量 0-2,默认 1 */
  readonly volume?: number;
  /** 淡入/淡出时长(秒,≤ duration/2);视频轨上同时作为画面转场 */
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /** 淡入淡出的底色 */
  readonly fadeType?: 'black' | 'white';
  /** 文字片段内容;存在时 assetId 必须为空串 */
  readonly text?: TextSpec;
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

/** 片段在源内消耗的时长(含变速) */
export const sourceSpan = (clip: Clip): number => clip.duration * (clip.speed ?? 1);

/** 时间线时刻 t 对应的素材源内时间 */
export const sourceTimeAt = (clip: Clip, t: number): number =>
  clip.inPoint + (t - clip.start) * (clip.speed ?? 1);

export const isTextClip = (clip: Clip): boolean => clip.text !== undefined;

/** 视频轨接受视频与图片;音频轨只接受音频;text 只能上视频轨。 */
export const assetSupportsTrack = (asset: MediaAsset, track: Track): boolean => {
  if (asset.kind === 'text') return track.kind === 'video';
  return track.kind === 'video' ? asset.kind !== 'audio' : asset.kind === 'audio';
};

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
