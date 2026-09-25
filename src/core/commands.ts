// 命令层:对工程文档的全部修改都通过这里。
// 命令携带显式 id(而不是在 reducer 内部生成),保证同一命令重放得到
// 同一结果 —— 这是 Agent 提案/批准模式与撤销栈能共用一套命令的前提。

import type { Clip, KeyframeProp, MediaAsset, ProjectDoc, TextSpec, Track } from './types.ts';

export type Command =
  | { readonly type: 'project.rename'; readonly name: string }
  | { readonly type: 'asset.add'; readonly asset: MediaAsset }
  | { readonly type: 'track.add'; readonly track: Track }
  | { readonly type: 'track.remove'; readonly trackId: string }
  | { readonly type: 'track.rename'; readonly trackId: string; readonly name: string }
  | { readonly type: 'clip.add'; readonly clip: Clip }
  | { readonly type: 'clip.move'; readonly clipId: string; readonly start: number; readonly trackId?: string }
  | {
      readonly type: 'clip.trim';
      readonly clipId: string;
      /** 至少给一项;trim 不改变另一端(inPoint 跟随 start 移动)。 */
      readonly start?: number;
      readonly duration?: number;
    }
  | { readonly type: 'clip.split'; readonly clipId: string; readonly at: number; readonly newClipId: string }
  | { readonly type: 'clip.remove'; readonly clipId: string }
  | { readonly type: 'clip.duplicate'; readonly clipId: string; readonly newClipId: string }
  | { readonly type: 'clip.updateText'; readonly clipId: string; readonly text: Partial<TextSpec> }
  | { readonly type: 'clip.setKeyframe'; readonly clipId: string; readonly prop: KeyframeProp; readonly time: number; readonly value: number }
  | { readonly type: 'clip.removeKeyframe'; readonly clipId: string; readonly prop: KeyframeProp; readonly time: number }
  | { readonly type: 'clip.clearKeyframes'; readonly clipId: string; readonly prop?: KeyframeProp }
  | { readonly type: 'clip.setFilter'; readonly clipId: string; readonly preset?: string; readonly intensity?: number }
  | {
      readonly type: 'clip.properties';
      readonly clipId: string;
      /** 局部更新:仅提供的字段会被修改(undefined 值删除可选字段) */
      readonly speed?: number;
      readonly volume?: number;
      readonly fadeIn?: number;
      readonly fadeOut?: number;
      readonly fadeType?: 'black' | 'white';
    };

export type ApplyResult =
  | { readonly ok: true; readonly doc: ProjectDoc }
  | { readonly ok: false; readonly error: string };

export const COMMAND_LABELS: Record<Command['type'], string> = {
  'project.rename': '重命名工程',
  'asset.add': '导入素材',
  'track.add': '新建轨道',
  'track.remove': '删除轨道',
  'track.rename': '重命名轨道',
  'clip.add': '添加片段',
  'clip.move': '移动片段',
  'clip.trim': '调整片段',
  'clip.split': '分割片段',
  'clip.remove': '删除片段',
  'clip.duplicate': '复制片段',
  'clip.updateText': '编辑文字',
  'clip.properties': '调整片段属性',
  'clip.setKeyframe': '设置关键帧',
  'clip.removeKeyframe': '删除关键帧',
  'clip.clearKeyframes': '清除关键帧',
  'clip.setFilter': '设置滤镜',
};
