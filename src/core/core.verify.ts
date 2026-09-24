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
    id: uid('clip'),
    trackId: 'track_v1',
    assetId: 'asset_a',
    start: 0,
    duration: 2,
    inPoint: 0,
    ...partial,
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

describe('文字片段', () => {
  const textClip = (partial: Partial<Clip> = {}): Clip => ({
    id: uid('clip'),
    trackId: 'track_v1',
    assetId: '',
    start: 0,
    duration: 2,
    inPoint: 0,
    ...partial,
    text: partial.text ?? { content: '你好世界', size: 72, color: '#ffffff' },
  });

  it('文字片段可以上视频轨,无需素材', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(textClip())));
    assert.equal(doc.clips[0].text?.content, '你好世界');
  });

  it('文字片段不能上音频轨、不能引用素材、内容不能为空', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, { type: 'track.add', track: { id: 'track_a1', kind: 'audio', name: '音频 1' } }));
    expectError(applyCommand(doc, addClip(textClip({ trackId: 'track_a1' }))));
    expectError(applyCommand(doc, addClip(textClip({ assetId: 'asset_a' }))));
    expectError(applyCommand(doc, addClip(textClip({ text: { content: '  ', size: 72, color: '#fff' } }))));
  });

  it('updateText 改内容与样式,媒体片段被拒绝', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(textClip({ id: 't1' }))));
    doc = expectOk(applyCommand(doc, {
      type: 'clip.updateText', clipId: 't1', text: { content: '新标题', size: 96, color: '#ff0000' },
    }));
    assert.deepEqual([doc.clips[0].text?.content, doc.clips[0].text?.size], ['新标题', 96]);
    // 媒体片段
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 3 }))));
    expectError(applyCommand(doc, { type: 'clip.updateText', clipId: doc.clips[1].id, text: { content: 'x' } }));
  });
});

describe('变速', () => {
  it('speed 影响源时长校验:2 倍速 2 秒需要 4 秒源', () => {
    const doc = makeDoc();
    expectError(applyCommand(doc, addClip(clip({ duration: 2, inPoint: 7, speed: 2 })))); // 7+4 > 10
    expectOk(applyCommand(doc, addClip(clip({ duration: 2, inPoint: 6, speed: 2 })))); // 6+4 = 10
  });

  it('speed 越界被拒绝,clip.properties 可设置并回读', () => {
    let doc = makeDoc();
    expectError(applyCommand(doc, addClip(clip({ speed: 8 }))));
    doc = expectOk(applyCommand(doc, addClip(clip({ start: 0, duration: 2 }))));
    doc = expectOk(applyCommand(doc, { type: 'clip.properties', clipId: doc.clips[0].id, speed: 0.5 }));
    assert.equal(doc.clips[0].speed, 0.5);
  });
});

describe('音量与淡入淡出', () => {
  it('音量 0-2 合法,越界拒绝', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({}))));
    doc = expectOk(applyCommand(doc, { type: 'clip.properties', clipId: doc.clips[0].id, volume: 0 }));
    assert.equal(doc.clips[0].volume, 0);
    doc = expectOk(applyCommand(doc, { type: 'clip.properties', clipId: doc.clips[0].id, volume: 2 }));
    assert.equal(doc.clips[0].volume, 2);
    expectError(applyCommand(doc, { type: 'clip.properties', clipId: doc.clips[0].id, volume: 3 }));
  });

  it('淡入淡出不能超过时长一半', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ duration: 4 }))));
    const id = doc.clips[0].id;
    expectError(applyCommand(doc, { type: 'clip.properties', clipId: id, fadeIn: 2.5 }));
    doc = expectOk(applyCommand(doc, { type: 'clip.properties', clipId: id, fadeIn: 1, fadeOut: 1, fadeType: 'white' }));
    assert.deepEqual([doc.clips[0].fadeIn, doc.clips[0].fadeOut, doc.clips[0].fadeType], [1, 1, 'white']);
  });

  it('trim 缩短时长后超限的淡出会被拒绝', () => {
    let doc = makeDoc();
    doc = expectOk(applyCommand(doc, addClip(clip({ duration: 4 }))));
    const id = doc.clips[0].id;
    doc = expectOk(applyCommand(doc, { type: 'clip.properties', clipId: id, fadeIn: 2 }));
    expectError(applyCommand(doc, { type: 'clip.trim', clipId: id, duration: 3 })); // 2 > 3/2
  });
});
