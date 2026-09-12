// 编辑器全局状态:一个极小的外部 store(useSyncExternalStore 消费)。
// 播放头/选区/缩放不进撤销栈;工程文档的所有变更走 core 的命令层。

import { useSyncExternalStore } from 'react';
import type { Command } from '../../core/commands.ts';
import {
  canRedo,
  canUndo,
  initHistory,
  redo as redoHistory,
  reduceAllWithHistory,
  undo as undoHistory,
  type EditorHistory,
} from '../../core/history.ts';
import { projectDuration } from '../../core/select.ts';
import { emptyProject, type ProjectDoc } from '../../core/types.ts';

export interface EditorState {
  readonly history: EditorHistory;
  readonly selection: readonly string[];
  readonly playhead: number;
  readonly playing: boolean;
  readonly zoom: number; // 每秒多少像素
  readonly message: string | null;
}

let state: EditorState = {
  history: initHistory(emptyProject()),
  selection: [],
  playhead: 0,
  playing: false,
  zoom: 80,
  message: null,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
function setState(patch: Partial<EditorState>): void {
  state = { ...state, ...patch };
  emit();
}

export const editorStore = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(): EditorState {
    return state;
  },

  dispatch(command: Command, label: string): { ok: boolean; error?: string } {
    return this.dispatchAll([command], label);
  },

  /** 一组命令整体作为一个撤销点;任一失败整批不生效。 */
  dispatchAll(commands: readonly Command[], label: string): { ok: boolean; error?: string } {
    const { history, result } = reduceAllWithHistory(state.history, commands, label);
    if (!result.ok) {
      setState({ message: result.error ?? '操作失败' });
      return { ok: false, error: result.error };
    }
    setState({ history, message: null });
    return { ok: true };
  },

  undo(): void {
    if (!canUndo(state.history)) return;
    setState({ history: undoHistory(state.history), selection: [] });
  },
  redo(): void {
    if (!canRedo(state.history)) return;
    setState({ history: redoHistory(state.history), selection: [] });
  },

  selectOnly(clipId: string): void {
    setState({ selection: [clipId] });
  },
  toggleSelect(clipId: string): void {
    const selection = state.selection.includes(clipId)
      ? state.selection.filter((id) => id !== clipId)
      : [...state.selection, clipId];
    setState({ selection });
  },
  clearSelection(): void {
    setState({ selection: [] });
  },

  seek(time: number): void {
    setState({ playhead: Math.max(0, time) });
  },
  /** 播放循环推进播放头;返回是否已到结尾自动暂停。 */
  tick(deltaSeconds: number): boolean {
    const end = projectDuration(state.history.present);
    const next = state.playhead + deltaSeconds;
    if (next >= end) {
      setState({ playhead: end, playing: false });
      return false;
    }
    setState({ playhead: next });
    return true;
  },
  setPlaying(playing: boolean): void {
    setState({ playing });
  },
  setZoom(zoom: number): void {
    setState({ zoom: Math.min(400, Math.max(12, zoom)) });
  },
  clearMessage(): void {
    setState({ message: null });
  },
};

export function useEditor(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.get, editorStore.get);
}

export function useProject(): ProjectDoc {
  return useEditor().history.present;
}
