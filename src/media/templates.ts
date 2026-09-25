// 一键成片模板:模板 = (视觉素材列表) → Command[]。
// 纯函数、确定性(uid 传入),产物走既有命令层(轨道/片段/文字/转场/关键帧),
// 整批一个撤销点。测试见 templates.verify.ts。

import type { Command } from '../core/commands.ts';
import { uid, type MediaAsset } from '../core/types.ts';

export interface StoryboardTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 每个素材占用时长(秒) */
  readonly clipDuration: number;
  build: (assets: readonly MediaAsset[], gen: IdGenerator) => Command[];
}

export interface IdGenerator {
  track: () => string;
  clip: () => string;
}

export const realIdGenerator = (): IdGenerator => ({ track: () => uid('track'), clip: () => uid('clip') });

const visualAssets = (assets: readonly MediaAsset[]): MediaAsset[] =>
  assets.filter((a) => a.kind === 'video' || a.kind === 'image');

function addVisualClip(
  commands: Command[],
  asset: MediaAsset,
  trackId: string,
  clipId: string,
  start: number,
  duration: number,
  extra?: Partial<Parameters<typeof Object.assign>[0]>,
): void {
  commands.push({
    type: 'clip.add',
    clip: {
      id: clipId,
      trackId,
      assetId: asset.id,
      start,
      duration,
      inPoint: 0,
      ...extra,
    },
  });
}

function addText(
  commands: Command[],
  gen: IdGenerator,
  trackId: string,
  start: number,
  duration: number,
  content: string,
  size: number,
): void {
  commands.push({
    type: 'clip.add',
    clip: {
      id: gen.clip(),
      trackId,
      assetId: '',
      start,
      duration,
      inPoint: 0,
      text: { content, size, color: '#ffffff' },
    },
  });
}

/** 交替缩放关键帧(相邻片段一推一拉,产生节奏感) */
function zoomPulse(commands: Command[], clipId: string, index: number, duration: number): void {
  const from = index % 2 === 0 ? 1 : 1.15;
  const to = index % 2 === 0 ? 1.15 : 1;
  commands.push({ type: 'clip.setKeyframe', clipId, prop: 'scale', time: 0, value: from });
  commands.push({ type: 'clip.setKeyframe', clipId, prop: 'scale', time: duration, value: to });
}

export const STORYBOARD_TEMPLATES: readonly StoryboardTemplate[] = [
  {
    id: 'travel',
    name: '旅行回忆',
    description: '每个素材快切 2.5 秒,交替推拉镜头 + 淡入淡出转场,轻快节奏。',
    clipDuration: 2.5,
    build: (assets, gen) => {
      const visuals = visualAssets(assets);
      const commands: Command[] = [];
      if (visuals.length === 0) return commands;
      const trackA = { id: gen.track(), kind: 'video' as const, name: '画面 1' };
      const trackB = { id: gen.track(), kind: 'video' as const, name: '画面 2' };
      commands.push({ type: 'track.add', track: trackA });
      commands.push({ type: 'track.add', track: trackB });
      visuals.forEach((asset, index) => {
        const track = index % 2 === 0 ? trackA : trackB;
        const clipId = gen.clip();
        const start = Math.floor(index / 2) * 2.5;
        commands.push({
          type: 'clip.add',
          clip: { id: clipId, trackId: track.id, assetId: asset.id, start, duration: 2.5, inPoint: 0, fadeIn: 0.35, fadeOut: 0.35 },
        });
        zoomPulse(commands, clipId, index, 2.5);
      });
      return commands;
    },
  },
  {
    id: 'product',
    name: '产品展示',
    description: '开场标题 → 逐个 3 秒特写推近 → 卖点字卡 → 黑场收尾,适合商品介绍。',
    clipDuration: 3,
    build: (assets, gen) => {
      const visuals = visualAssets(assets);
      const commands: Command[] = [];
      if (visuals.length === 0) return commands;
      const visualTrack = { id: gen.track(), kind: 'video' as const, name: '产品画面' };
      const titleTrack = { id: gen.track(), kind: 'video' as const, name: '字卡' };
      commands.push({ type: 'track.add', track: visualTrack });
      commands.push({ type: 'track.add', track: titleTrack });
      // 开场标题
      addText(commands, gen, titleTrack.id, 0, 2, '产品名称', 120);
      visuals.forEach((asset, index) => {
        const start = 2 + index * 3;
        const clipId = gen.clip();
        addVisualClip(commands, asset, visualTrack.id, clipId, start, 3);
        commands.push({ type: 'clip.setKeyframe', clipId, prop: 'scale', time: 0, value: 1 });
        commands.push({ type: 'clip.setKeyframe', clipId, prop: 'scale', time: 3, value: 1.25 });
        // 每个片段配一张卖点字卡
        addText(commands, gen, titleTrack.id, start + 0.5, 2, `卖点 ${index + 1}`, 64);
      });
      // 结尾黑场收尾(最后一个片段淡出)
      const last = commands.filter((c) => c.type === 'clip.add' && c.clip.trackId === visualTrack.id).at(-1);
      if (last && last.type === 'clip.add') {
        commands.push({ type: 'clip.properties', clipId: last.clip.id, fadeOut: 1, fadeType: 'black' });
      }
      return commands;
    },
  },
  {
    id: 'vlog',
    name: 'Vlog 开场',
    description: '大标题压屏 2 秒,素材 1.5 秒快切,整体 1 秒淡入开场。',
    clipDuration: 1.5,
    build: (assets, gen) => {
      const visuals = visualAssets(assets);
      const commands: Command[] = [];
      if (visuals.length === 0) return commands;
      const track = { id: gen.track(), kind: 'video' as const, name: 'Vlog' };
      const titleTrack = { id: gen.track(), kind: 'video' as const, name: '标题' };
      commands.push({ type: 'track.add', track });
      commands.push({ type: 'track.add', track: titleTrack });
      addText(commands, gen, titleTrack.id, 0, 2, '我的 Vlog', 140);
      visuals.forEach((asset, index) => {
        const clipId = gen.clip();
        addVisualClip(commands, asset, track.id, clipId, index * 1.5, 1.5, {
          fadeIn: index === 0 ? 0.7 : undefined,
        });
        commands.push({ type: 'clip.setKeyframe', clipId, prop: 'rotation', time: 0, value: index % 2 === 0 ? -2 : 2 });
        commands.push({ type: 'clip.setKeyframe', clipId, prop: 'rotation', time: 1.5, value: 0 });
      });
      return commands;
    },
  },
];

export function buildStoryboard(
  template: StoryboardTemplate,
  assets: readonly MediaAsset[],
): Command[] {
  return template.build(assets, realIdGenerator());
}
