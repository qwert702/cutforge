// 花字样式预设:改写 TextSpec 的颜色/描边,渲染器负责 strokeText。
import type { TextSpec } from '../core/types.ts';

export interface TextStylePreset {
  readonly id: string;
  readonly label: string;
  readonly preview: string;
  apply: (text: TextSpec) => TextSpec;
}

export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = [
  {
    id: 'plain',
    label: '默认',
    preview: '#ffffff',
    apply: (text) => ({ ...text, color: '#ffffff', stroke: undefined }),
  },
  {
    id: 'outline',
    label: '白字黑边',
    preview: '#ffffff',
    apply: (text) => ({ ...text, color: '#ffffff', stroke: { color: '#111111', width: Math.max(4, text.size / 9) } }),
  },
  {
    id: 'neon',
    label: '霓虹',
    preview: '#7df9ff',
    apply: (text) => ({ ...text, color: '#7df9ff', stroke: { color: '#0a84ff', width: Math.max(4, text.size / 11) } }),
  },
  {
    id: 'gold',
    label: '鎏金',
    preview: '#ffd700',
    apply: (text) => ({ ...text, color: '#ffd700', stroke: { color: '#7a5200', width: Math.max(3, text.size / 13) } }),
  },
  {
    id: 'inverted',
    label: '黑字白边',
    preview: '#111111',
    apply: (text) => ({ ...text, color: '#111111', stroke: { color: '#ffffff', width: Math.max(4, text.size / 9) } }),
  },
];

export function textStyleById(id: string): TextStylePreset | undefined {
  return TEXT_STYLE_PRESETS.find((p) => p.id === id);
}
