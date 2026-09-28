// 动效预设的回归测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyCommand } from '../core/reducer.ts';
import { emptyProject, type MediaAsset, type ProjectDoc } from '../core/types.ts';
import { buildStoryboard, STORYBOARD_TEMPLATES } from './templates.ts';
import { MOTION_PRESETS, motionById } from './motions.ts';

function makeDoc(): ProjectDoc {
  const asset: MediaAsset = {
    id: 'asset_a', name: 'a.mp4', kind: 'video', url: 'blob:a',
    durationSeconds: 30, width: 1920, height: 1080,
  };
  let doc = emptyProject();
  const withAsset = applyCommand(doc, { type: 'asset.add', asset });
  assert.ok(withAsset.ok);
  doc = withAsset.doc;
  const withTrack = applyCommand(doc, { type: 'track.add', track: { id: 'track_v1', kind: 'video', name: '视频 1' } });
  assert.ok(withTrack.ok);
  return withTrack.doc;
}

function mustApply(doc: ProjectDoc, command: Parameters<typeof applyCommand>[1]): ProjectDoc {
  const result = applyCommand(doc, command);
  if (!result.ok) throw new Error(`${command.type} 被拒绝:${result.error}`);
  return result.doc;
}

/** 把动效关键帧转成真实命令并重放(与 Inspector 的应用路径一致)。 */
function applyMotion(doc: ProjectDoc, clipId: string, motionId: string, duration: number): ProjectDoc {
  const preset = motionById(motionId);
  assert.ok(preset, `预设 ${motionId} 存在`);
  let next = doc;
  for (const prop of preset.clears) {
    const result = applyCommand(next, { type: 'clip.clearKeyframes', clipId, prop });
    if (result.ok) next = result.doc;
  }
  for (const kf of preset.keyframes(duration)) {
    next = mustApply(next, { type: 'clip.setKeyframe', clipId, prop: kf.prop, time: kf.time, value: kf.value });
  }
  return next;
}

describe('动效预设', () => {
  it('全部预设的关键帧可被核心校验接受(含最小片段)', () => {
    for (const preset of MOTION_PRESETS) {
      for (const duration of [1, 2.5, 8]) {
        let doc = makeDoc();
        const added = applyCommand(doc, {
          type: 'clip.add',
          clip: { id: 'c1', trackId: 'track_v1', assetId: 'asset_a', start: 0, duration, inPoint: 0 },
        });
        assert.ok(added.ok, `clip.add 被拒绝:${added.ok ? '' : 'error'}`);
        doc = added.doc;
        const motionDoc = applyMotion(doc, 'c1', preset.id, duration);
        const count = motionDoc.clips[0].keyframes?.length ?? 0;
        assert.ok(count > 0, `${preset.id}@${duration}s 应产生关键帧`);
      }
    }
  });

  it('推近 Ken Burns:首尾两个 scale 关键帧', () => {
    const kb = motionById('kenburns-in');
    const kfs = kb!.keyframes(4);
    assert.deepEqual(kfs.map((k) => [k.prop, k.time, k.value]), [
      ['scale', 0, 1],
      ['scale', 4, 1.3],
    ]);
  });

  it('弹入:三帧过冲曲线(scale)', () => {
    const pop = motionById('pop');
    const kfs = pop!.keyframes(2).filter((k) => k.prop === 'scale');
    assert.deepEqual(kfs.map((k) => k.value), [0.3, 1.25, 1]);
  });

  it('与模板命令叠加重放:模板片段 + 动效不冲突', () => {
    const assets: MediaAsset[] = [
      { id: 'v1', name: 'v.mp4', kind: 'video', url: 'blob:v', durationSeconds: 30, width: 1920, height: 1080 },
    ];
    let doc = emptyProject();
    const withAsset = applyCommand(doc, { type: 'asset.add', asset: assets[0] });
    assert.ok(withAsset.ok);
    doc = withAsset.doc;
    for (const command of buildStoryboard(STORYBOARD_TEMPLATES[0], assets)) {
      const result = applyCommand(doc, command);
      if (result.ok) doc = result.doc;
    }
    const firstClip = doc.clips.find((c) => c.assetId === 'v1');
    assert.ok(firstClip);
    const motionDoc = applyMotion(doc, firstClip.id, 'slide-left', firstClip.duration);
    assert.ok(motionDoc.clips.some((c) => c.keyframes?.length));
  });
});
