// 滤镜预设:每个预设按强度(0-1)生成 canvas ctx.filter 字符串。
// 纯函数,预览与导出共用;零外部依赖(canvas 原生能力)。

export interface FilterPreset {
  readonly id: string;
  readonly label: string;
  /** intensity 0-1 → ctx.filter 字符串(强度 0 必须返回空串,即无滤镜) */
  readonly css: (intensity: number) => string;
}

const pct = (base: number, i: number): string => `${Math.round((base - 1) * i * 100)}%`;
const deg = (base: number, i: number): string => `${Math.round(base * i)}deg`;
const px = (base: number, i: number): string => `${(base * i).toFixed(1)}px`;

export const FILTER_PRESETS: readonly FilterPreset[] = [
  { id: 'cinema', label: '电影感', css: (i) => `contrast(${1 + 0.3 * i}) saturate(${1 - 0.2 * i}) brightness(${1 - 0.05 * i})` },
  { id: 'bw', label: '黑白', css: (i) => `grayscale(${Math.round(i * 100)}%)` },
  { id: 'vintage', label: '复古', css: (i) => `sepia(${pct(0.6, i)}) contrast(${1 + 0.1 * i}) brightness(${1 + 0.05 * i})` },
  { id: 'warm', label: '暖冬', css: (i) => `sepia(${pct(0.3, i)}) saturate(${1 + 0.2 * i}) hue-rotate(${deg(-10, i)})` },
  { id: 'cool', label: '冷调', css: (i) => `hue-rotate(${deg(15, i)}) saturate(${1 + 0.1 * i})` },
  { id: 'cyber', label: '赛博朋克', css: (i) => `saturate(${1 + 0.8 * i}) hue-rotate(${deg(30, i)}) contrast(${1 + 0.2 * i})` },
  { id: 'contrast', label: '高对比', css: (i) => `contrast(${1 + 0.5 * i})` },
  { id: 'soft', label: '柔和', css: (i) => `brightness(${1 + 0.08 * i}) saturate(${1 - 0.15 * i}) contrast(${1 - 0.08 * i})` },
  { id: 'vivid', label: '鲜艳', css: (i) => `saturate(${1 + 0.6 * i})` },
  { id: 'faded', label: '褪色', css: (i) => `contrast(${1 - 0.2 * i}) saturate(${1 - 0.3 * i}) brightness(${1 + 0.1 * i})` },
  { id: 'dreamy', label: '梦幻柔焦', css: (i) => `blur(${px(3, i)}) brightness(${1 + 0.05 * i})` },
  { id: 'noir', label: '暗调 noir', css: (i) => `grayscale(${pct(1, i)}) contrast(${1 + 0.4 * i}) brightness(${1 - 0.12 * i})` },
];

export function filterLabel(id: string): string {
  return FILTER_PRESETS.find((p) => p.id === id)?.label ?? id;
}

/** 片段滤镜 → ctx.filter 字符串;无滤镜/强度 0 返回空串(canvas 语义为无滤镜)。 */
export function filterCssFor(preset: string | undefined, intensity: number | undefined): string {
  if (!preset) return '';
  const def = FILTER_PRESETS.find((p) => p.id === preset);
  if (!def) return '';
  const clamped = Math.min(1, Math.max(0, intensity ?? 1));
  if (clamped <= 0) return '';
  return def.css(clamped);
}
