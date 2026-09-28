// 动效预设:预设 = (片段时长 → 该片段受影响属性的关键帧序列)。
// 纯函数;产出 clip.setKeyframe 命令参数,由调用方包装成命令。
// 关键帧时间相对片段起点;全部走核心校验(范围/时长)。

import type { KeyframeProp } from '../core/types.ts';

export interface MotionKeyframe {
  readonly prop: KeyframeProp;
  readonly time: number;
  readonly value: number;
}

export interface MotionPreset {
  readonly id: string;
  readonly label: string;
  /** 生成关键帧序列(time 相对片段起点;fps 取整由核心命令层处理) */
  readonly keyframes: (duration: number) => readonly MotionKeyframe[];
  /** 应用后需要清除的属性(避免旧关键帧干扰) */
  readonly clears: readonly KeyframeProp[];
}

const kf = (prop: KeyframeProp, time: number, value: number) => ({ prop, time, value });

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: 'fade',
    label: '淡入',
    clears: ['opacity'],
    keyframes: (duration) => [kf('opacity', 0, 0), kf('opacity', Math.min(0.6, duration / 2), 1)],
  },
  {
    id: 'slide-left',
    label: '左侧滑入',
    clears: ['x', 'opacity'],
    keyframes: (duration) => [
      kf('x', 0, -0.25), kf('opacity', 0, 0),
      kf('x', Math.min(0.5, duration / 2), 0.5), kf('opacity', Math.min(0.5, duration / 2), 1),
    ],
  },
  {
    id: 'slide-right',
    label: '右侧滑入',
    clears: ['x', 'opacity'],
    keyframes: (duration) => [
      kf('x', 0, 1.25), kf('opacity', 0, 0),
      kf('x', Math.min(0.5, duration / 2), 0.5), kf('opacity', Math.min(0.5, duration / 2), 1),
    ],
  },
  {
    id: 'rise',
    label: '下方升起',
    clears: ['y', 'opacity'],
    keyframes: (duration) => [
      kf('y', 0, 1.3), kf('opacity', 0, 0),
      kf('y', Math.min(0.5, duration / 2), 0.5), kf('opacity', Math.min(0.5, duration / 2), 1),
    ],
  },
  {
    id: 'pop',
    label: '弹入(过冲)',
    clears: ['scale', 'opacity'],
    keyframes: (duration) => {
      const half = Math.min(0.4, duration / 2);
      return [
        kf('scale', 0, 0.3), kf('opacity', 0, 0),
        kf('scale', half, 1.25), kf('opacity', half, 1),
        kf('scale', Math.min(half * 2, duration), 1),
      ];
    },
  },
  {
    id: 'kenburns-in',
    label: '推近(Ken Burns)',
    clears: ['scale'],
    keyframes: (duration) => [kf('scale', 0, 1), kf('scale', duration, 1.3)],
  },
  {
    id: 'kenburns-out',
    label: '拉远(Ken Burns)',
    clears: ['scale'],
    keyframes: (duration) => [kf('scale', 0, 1.3), kf('scale', duration, 1)],
  },
  {
    id: 'drift',
    label: '缓慢横移',
    clears: ['x'],
    keyframes: (duration) => [kf('x', 0, 0.42), kf('x', duration, 0.58)],
  },
];

export function motionById(id: string): MotionPreset | undefined {
  return MOTION_PRESETS.find((m) => m.id === id);
}
