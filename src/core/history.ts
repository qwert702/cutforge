// 撤销/重做栈:包装"当前文档",只有成功且真正改变文档的命令才产生历史点。

import type { Command } from './commands.ts';
import { applyCommand } from './reducer.ts';
import type { ProjectDoc } from './types.ts';

export interface EditorHistory {
  readonly past: readonly ProjectDoc[];
  readonly present: ProjectDoc;
  readonly future: readonly ProjectDoc[];
  /** 最近一条生效命令的标签,用于撤销列表展示 */
  readonly lastLabel: string | null;
}

const HISTORY_LIMIT = 100;

export function initHistory(present: ProjectDoc): EditorHistory {
  return { past: [], present, future: [], lastLabel: null };
}

export type DispatchResult =
  | { readonly ok: true; readonly doc: ProjectDoc }
  | { readonly ok: false; readonly error: string };

/** 应用一条命令并推进历史。文档未变化的命令不产生撤销点。 */
export function reduceWithHistory(
  history: EditorHistory,
  command: Command,
  label: string,
): { history: EditorHistory; result: DispatchResult } {
  return reduceAllWithHistory(history, [command], label);
}

/** 应用一组命令,整体作为一个撤销点;任一命令失败则整批不生效。 */
export function reduceAllWithHistory(
  history: EditorHistory,
  commands: readonly Command[],
  label: string,
): { history: EditorHistory; result: DispatchResult } {
  let doc = history.present;
  for (const command of commands) {
    const result = applyCommand(doc, command);
    if (!result.ok) return { history, result };
    doc = result.doc;
  }
  if (doc === history.present) return { history, result: { ok: true, doc } };
  return {
    history: {
      past: [...history.past, history.present].slice(-HISTORY_LIMIT),
      present: doc,
      future: [],
      lastLabel: label,
    },
    result: { ok: true, doc },
  };
}

export function undo(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    lastLabel: null,
  };
}

export function redo(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
    lastLabel: null,
  };
}

export const canUndo = (history: EditorHistory): boolean => history.past.length > 0;
export const canRedo = (history: EditorHistory): boolean => history.future.length > 0;
