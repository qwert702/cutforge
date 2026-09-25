// AI 提案引擎:Agent 的改动先应用到草稿副本并记录命令,
// 用户批准后由调用方把整组命令一次性派发到真实工程(单个撤销点)。
// 引擎本身是纯函数集合 + 一个可订阅的当前提案状态,不直接触碰编辑器 store。

import type { Command } from '../core/commands.ts';
import { applyCommand } from '../core/reducer.ts';
import type { ProjectDoc } from '../core/types.ts';

export interface ProposalEntry {
  readonly command: Command;
  readonly label: string;
}

export interface Proposal {
  readonly id: string;
  readonly baseDoc: ProjectDoc;
  readonly draftDoc: ProjectDoc;
  readonly entries: readonly ProposalEntry[];
  /** 被核心校验拒绝的命令(连同原因),供卡片折叠展示 */
  readonly rejected: readonly { readonly label: string; readonly error: string }[];
}

type Listener = () => void;

let active: Proposal | null = null;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((fn) => fn());

// ── 模式开关(提案模式 = Agent 改动先落草稿) ──────────────────────────────

const MODE_KEY = 'cutforge.proposal.mode.v1';

export function isProposalMode(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) !== '0';
  } catch {
    return true; // 无法读写(如测试环境)时默认开启
  }
}

export function setProposalMode(enabled: boolean): void {
  try {
    localStorage.setItem(MODE_KEY, enabled ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  emit();
}

// ── 当前提案状态 ────────────────────────────────────────────────────────────

export function getProposal(): Proposal | null {
  return active;
}

export function subscribeProposal(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let counter = 0;

/** 若没有进行中的提案则从 baseDoc 开启一个;否则沿用(跨工具轮次累积)。 */
export function beginProposalIfNeeded(baseDoc: ProjectDoc): Proposal {
  if (!active) {
    counter += 1;
    active = {
      id: `proposal_${counter}`,
      baseDoc,
      draftDoc: baseDoc,
      entries: [],
      rejected: [],
    };
    emit();
  }
  return active;
}

export interface ProposalApplyResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** 把一条命令应用到当前提案草稿;成功则记录,失败则进 rejected 并原样告知。 */
export function applyCommandToProposal(command: Command, label: string): ProposalApplyResult {
  if (!active) return { ok: false, error: '没有进行中的提案' };
  const result = applyCommand(active.draftDoc, command);
  if (!result.ok) {
    active = { ...active, rejected: [...active.rejected, { label, error: result.error ?? '未知错误' }] };
    emit();
    return { ok: false, error: result.error };
  }
  active = {
    ...active,
    draftDoc: result.doc,
    entries: [...active.entries, { command, label }],
  };
  emit();
  return { ok: true };
}

/** 批准:返回待派发的整组命令并结束提案(调用方负责 dispatchAll,形成单个撤销点)。 */
export function approveProposal(): readonly Command[] | null {
  if (!active || active.entries.length === 0) return null;
  const commands = active.entries.map((entry) => entry.command);
  active = null;
  emit();
  return commands;
}

/** 拒绝:丢弃提案。 */
export function rejectProposal(): void {
  if (!active) return;
  active = null;
  emit();
}
