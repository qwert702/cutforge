// 提案引擎的回归测试(纯逻辑,不触碰编辑器 store)。
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  applyCommandToProposal,
  approveProposal,
  beginProposalIfNeeded,
  getProposal,
  isProposalMode,
  rejectProposal,
  setProposalMode,
} from './proposal.ts';
import { applyCommand } from '../core/reducer.ts';
import { emptyProject, uid, type MediaAsset, type ProjectDoc } from '../core/types.ts';

// localStorage 桩(模式开关在浏览器外不可用)
const store = new Map<string, string>();
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  });
}

function makeDoc(): ProjectDoc {
  const asset: MediaAsset = {
    id: 'asset_a', name: 'a.mp4', kind: 'video', url: 'blob:a',
    durationSeconds: 10, width: 1920, height: 1080,
  };
  let doc = emptyProject();
  const withAsset = applyCommand(doc, { type: 'asset.add', asset });
  assert.ok(withAsset.ok);
  doc = withAsset.doc;
  const withTrack = applyCommand(doc, { type: 'track.add', track: { id: 'track_v1', kind: 'video', name: '视频 1' } });
  assert.ok(withTrack.ok);
  return withTrack.doc;
}

beforeEach(() => {
  rejectProposal();
  store.clear();
});

describe('提案模式开关', () => {
  it('默认开启,可关闭', () => {
    assert.equal(isProposalMode(), true);
    setProposalMode(false);
    assert.equal(isProposalMode(), false);
    setProposalMode(true);
  });
});

describe('提案草稿', () => {
  it('命令应用进草稿并记录;拒绝的命令进 rejected', () => {
    const base = makeDoc();
    beginProposalIfNeeded(base);
    const ok1 = applyCommandToProposal(
      { type: 'clip.add', clip: { id: 'c1', trackId: 'track_v1', assetId: 'asset_a', start: 0, duration: 2, inPoint: 0 } },
      '添加片段',
    );
    assert.equal(ok1.ok, true);
    const ok2 = applyCommandToProposal(
      { type: 'clip.add', clip: { id: 'c2', trackId: 'track_v1', assetId: 'asset_a', start: 1, duration: 2, inPoint: 0 } },
      '注定重叠',
    );
    assert.equal(ok2.ok, false);
    const proposal = getProposal();
    assert.equal(proposal?.entries.length, 1);
    assert.equal(proposal?.rejected.length, 1);
    assert.equal(proposal?.draftDoc.clips.length, 1); // 草稿只含被接受的
    assert.equal(base.clips.length, 0); // 真实文档未被触碰
  });

  it('跨工具轮次累积:后续命令继续同一提案', () => {
    beginProposalIfNeeded(makeDoc());
    applyCommandToProposal(
      { type: 'clip.add', clip: { id: 'c1', trackId: 'track_v1', assetId: 'asset_a', start: 0, duration: 2, inPoint: 0 } },
      '添加片段',
    );
    const again = beginProposalIfNeeded(emptyProject()); // 第二次 begin 应沿用现有提案
    assert.equal(again.entries.length, 1);
  });

  it('批准返回整组命令并清空;没有条目时返回 null', () => {
    beginProposalIfNeeded(makeDoc());
    assert.equal(approveProposal(), null); // 空提案
    applyCommandToProposal(
      { type: 'clip.add', clip: { id: 'c1', trackId: 'track_v1', assetId: 'asset_a', start: 0, duration: 2, inPoint: 0 } },
      '添加片段',
    );
    applyCommandToProposal({ type: 'clip.remove', clipId: 'c1' }, '删除片段');
    const commands = approveProposal();
    assert.equal(commands?.length, 2);
    assert.equal(getProposal(), null);
    // 命令重放到真实文档得到预期结果(确定性)
    let doc = makeDoc();
    for (const command of commands) {
      const result = applyCommand(doc, command);
      assert.equal(result.ok, true);
      doc = result.doc;
    }
    assert.equal(doc.clips.length, 0);
  });

  it('拒绝清空提案', () => {
    beginProposalIfNeeded(makeDoc());
    applyCommandToProposal(
      { type: 'clip.add', clip: { id: uid('clip'), trackId: 'track_v1', assetId: 'asset_a', start: 0, duration: 2, inPoint: 0 } },
      '添加片段',
    );
    rejectProposal();
    assert.equal(getProposal(), null);
  });
});
