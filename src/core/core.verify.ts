// 时间线核心的回归测试。运行:npm test(node --import tsx --test)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Command } from './commands.ts';
import { canRedo, canUndo, initHistory, redo, reduceWithHistory, undo } from './history.ts';
import { applyCommand } from './reducer.ts';
import { clipsOnTrack, findFreeStart, projectDuration } from './select.ts';
import { emptyProject, uid, type Clip, type MediaAsset, type ProjectDoc } from './types.ts';

function makeDoc(): ProjectDoc {
  const asset: MediaAsset = {
    id: 'asset_a',
    name: 'a.mp4',
    kind: 'video',
    url: 'blob:a',
    durationSeconds: 10,
    width: 1920,
    height: 1080,
  };
  let doc = emptyProject();
  doc = expectOk(applyCommand(doc, { type: 'asset.add', asset }));
  doc = expectOk(applyCommand(doc, { type: 'track.add', track: { id: 'track_v1', kind: 'video', name: '视频 1' } }));
  return doc;
}

function expectOk<T extends { ok: boolean; error?: string; doc?: ProjectDoc }>(result: T): ProjectDoc {
  assert.equal(result.ok, true, `expected ok, got error: ${'error' in result ? result.error : ''}`);
  return (result as { doc: ProjectDoc }).doc;
}

function expectError<T extends { ok: boolean }>(result: T): void {
  assert.equal(result.ok, false, 'expected the command to be rejected');
}

function clip(partial: Partial<Clip> & { assetId?: string }): Clip {
  return {
    id: partial.id ?? uid('clip'),
    trackId: partial.trackId ?? 'track_v1',
    assetId: partial.assetId ?? 'asset_a',
    start: partial.start ?? 0,
    duration: partial.duration ?? 2,
    inPoint: partial.inPoint ?? 0,
  };
}

const addClip = (c: Clip): Command => ({ type: 'clip.add', clip: c });

describe('clip.add / 不变式', () => {
  it('正常添加片段,projectDuration 取最大结束点', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 1, duration: 3 }))));
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 4, duration: 2.5 }))));
    assert.equal(projectDuration(doc), 6.5);
    assert.equal(clipsOnTrack(doc, 'track_v1').length, 2);
  });

  it('拒绝同轨重叠', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 0, duration: 4 }))));
    expectError(applyCommand(doc, addClip(clip({ start: 2, duration: 4 }))));
    // 首尾相接不算重叠
    expectOk(applyCommand(doc, addClip(clip({ start: 4, duration: 2 }))));
  });

  it('拒绝超出素材源时长', () => {
    const doc = makeDoc();
    expectError(applyCommand(doc, addClip(clip({ start: 0, duration: 6, inPoint: 5 }))));
  });

  it('拒绝音频素材上视频轨类型不兼容(音频素材只能上音频轨)', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, {
      type: 'asset.add',
      asset: { id: 'asset_snd', name: 's.mp3', kind: 'audio', url: 'blob:s', durationSeconds: 5, width: null, height: null },
    }));
    expectError(applyCommand(doc, addClip(clip({ assetId: 'asset_snd' }))));
  });
});

describe('clip.trim', () => {
  it('左切时 inPoint 跟随移动,右切不动 inPoint', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 2, duration: 4, inPoint: 1 }))));
    // 左边切掉 1 秒:start 2→3,duration 4→3,inPoint 1→2
    doc = expectOk(applyCommand(doc, { type: 'clip.trim', clipId: doc.clips[0].id, start: 3 }));
    assert.equal(doc.clips[0].inPoint, 2);
    assert.equal(doc.clips[0].duration, 3);
    // 右边缩短 1 秒:inPoint 不变
    doc = expectOk(applyCommand(doc, { type: 'clip.trim', clipId: doc.clips[0].id, duration: 2 }));
    assert.equal(doc.clips[0].inPoint, 2);
    assert.equal(doc.clips[0].duration, 2);
  });

  it('trim 不得撞上邻居', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 0, duration: 2 }))));
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 2, duration: 4, inPoint: 1 }))));
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 6, duration: 2 }))));
    const second = doc.clips[1].id;
    // 左切撞上前一个邻居
    expectError(applyCommand(doc, { type: 'clip.trim', clipId: second, start: 1.5 }));
    // 右侧拉长撞上后一个邻居
    expectError(applyCommand(doc, { type: 'clip.trim', clipId: second, duration: 5 }));
    // 正常收缩不受限
    expectOk(applyCommand(doc, { type: 'clip.trim', clipId: second, duration: 3 }));
  });
});

describe('clip.split', () => {
  it('分割后两段时长、inPoint 正确且不再重叠', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 1, duration: 6, inPoint: 2 }))));
    const id = doc.clips[0].id;
    doc = expectOk(applyCommand(doc, { type: 'clip.split', clipId: id, at: 4, newClipId: 'clip_right' }));
    const [left, right] = clipsOnTrack(doc, 'track_v1');
    assert.deepEqual([left.duration, left.inPoint], [3, 2]);
    assert.deepEqual([right.start, right.duration, right.inPoint], [4, 3, 5]);
    assert.equal(projectDuration(doc), 7);
  });

  it('拒绝在片段外分割', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 1, duration: 3 }))));
    expectError(applyCommand(doc, { type: 'clip.split', clipId: doc.clips[0].id, at: 4, newClipId: 'x' }));
    expectError(applyCommand(doc, { type: 'clip.split', clipId: doc.clips[0].id, at: 0.5, newClipId: 'x' }));
  });
});

describe('clip.move / duplicate / track.remove', () => {
  it('move 换轨:类型不符被拒绝', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, { type: 'track.add', track: { id: 'track_a1', kind: 'audio', name: '音频 1' } }));
    doc = expectOk(applyCommand(doc, addClip(clip({}))));
    expectError(applyCommand(doc, { type: 'clip.move', clipId: doc.clips[0].id, start: 0, trackId: 'track_a1' }));
  });

  it('duplicate 放到原片段后第一个空闲位置', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 0, duration: 2 }))));
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 3, duration: 2 }))));
    doc = expectOk(applyCommand(doc, { type: 'clip.duplicate', clipId: doc.clips[0].id, newClipId: 'dup1' }));
    const copy = doc.clips.find((c) => c.id === 'dup1');
    // 2-3 的空档放不下 2 秒,落到第二个片段结束点
    assert.equal(copy?.start, 5);
  });

  it('findFreeStart 跳过占用区间', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 1, duration: 3 }))));
    assert.equal(findFreeStart(doc, 'track_v1', 2, 0), 4);
  });

  it('删除轨道级联删除其片段', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, { type: 'track.add', track: { id: 'track_v2', kind: 'video', name: '视频 2' } }));
    doc = expectOk(applyCommand(doc, addClip(clip({ trackId: 'track_v2' }))));
    doc = expectOk(applyCommand(doc, { type: 'track.remove', trackId: 'track_v2' }));
    assert.equal(doc.clips.length, 0);
    assert.equal(doc.tracks.length, 1);
  });
});

describe('撤销 / 重做', () => {
  it('成功命令入历史,失败命令不入,undo/redo 对称', () => {
    let history = initHistory(makeDoc());
    ({ history } = reduceWithHistory(history, addClip(clip({ start: 0, duration: 2 })), '添加片段'));
    const beforeFailed = history;
    // 与第一个片段重叠 → 被拒绝,历史保持原引用
    const failed = reduceWithHistory(history, addClip(clip({ start: 0, duration: 2 })), '注定失败');
    assert.equal(failed.history, beforeFailed);
    assert.equal(failed.result.ok, false);
    assert.ok(canUndo(history));
    assert.ok(!canRedo(history));
    history = undo(history);
    assert.equal(history.present.clips.length, 0);
    assert.ok(canRedo(history));
    history = redo(history);
    assert.equal(history.present.clips.length, 1);
  });

  it('undo 保留文档快照且历史限量', () => {
    let history = initHistory(makeDoc());
    for (let i = 0; i < 130; i += 1) {
      const start = i * 2;
      ({ history } = reduceWithHistory(history, addClip(clip({ id: `c${i}`, start, duration: 1 })), 'add'));
    }
    assert.equal(history.past.length, 100);
  });
});

describe('时间取整', () => {
  it('add/move 的秒数按工程 fps 取整,消除浮点误差', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 0.1 + 0.2, duration: 1 }))));
    assert.equal(doc.clips[0].start, 0.3);
  });
});
