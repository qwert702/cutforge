// 模板命令生成的回归测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Command } from '../core/commands.ts';
import { applyCommand } from '../core/reducer.ts';
import { emptyProject, uid, type MediaAsset } from '../core/types.ts';
import { buildStoryboard, STORYBOARD_TEMPLATES } from './templates.ts';

function fakeAsset(kind: 'video' | 'image'): MediaAsset {
  return { id: uid('asset'), name: `${kind}.file`, kind, url: 'blob:x', durationSeconds: kind === 'video' ? 30 : null, width: 1920, height: 1080 };
}

/** 把命令重放到含全部素材的空工程,验证产物合法(重叠/越界等都会被拒绝)。 */
function replay(commands: readonly Command[]): { ok: boolean; error?: string } {
  let doc = emptyProject();
  for (const asset of allAssets) {
    const result = applyCommand(doc, { type: 'asset.add', asset });
    assert.ok(result.ok);
    doc = result.doc;
  }
  for (const command of commands) {
    const result = applyCommand(doc, command);
    if (!result.ok) return { ok: false, error: `${command.type}: ${result.error}` };
    doc = result.doc;
  }
  return { ok: true };
}

const allAssets: MediaAsset[] = [];

describe('一键成片模板', () => {
  it('三个模板生成的命令都能完整重放通过(无重叠/无越界)', () => {
    allAssets.length = 0;
    const assets = [fakeAsset('video'), fakeAsset('video'), fakeAsset('image'), fakeAsset('video')];
    allAssets.push(...assets);
    for (const template of STORYBOARD_TEMPLATES) {
      const result = replay(buildStoryboard(template, assets));
      assert.equal(result.ok, true, `${template.id} 重放失败:${result.error}`);
    }
  });

  it('旅行回忆:交替双轨 + 每片段 2 个缩放关键帧 + 淡入淡出', () => {
    const assets = [fakeAsset('video'), fakeAsset('video'), fakeAsset('video')];
    const commands = buildStoryboard(STORYBOARD_TEMPLATES[0], assets);
    const keyframeCommands = commands.filter((c) => c.type === 'clip.setKeyframe' && c.prop === 'scale');
    const fadeClips = commands.filter((c) => c.type === 'clip.add' && c.clip.fadeIn);
    assert.equal(keyframeCommands.length, 6); // 3 片段 × 2
    assert.equal(fadeClips.length, 3);
  });

  it('产品展示:开场标题 + 每片段卖点字卡 + 结尾淡出', () => {
    const assets = [fakeAsset('video'), fakeAsset('video')];
    const commands = buildStoryboard(STORYBOARD_TEMPLATES[1], assets);
    const textClips = commands.filter((c) => c.type === 'clip.add' && c.clip.text);
    const fadeOuts = commands.filter((c) => c.type === 'clip.properties' && c.fadeOut);
    assert.equal(textClips.length, 3); // 开场标题 + 2 张卖点字卡
    assert.equal(fadeOuts.length, 1);
  });

  it('无视觉素材(纯音频)时返回空命令', () => {
    const audio: MediaAsset = { id: uid('asset'), name: 'a.mp3', kind: 'audio', url: 'blob:x', durationSeconds: 10, width: null, height: null };
    for (const template of STORYBOARD_TEMPLATES) {
      assert.deepEqual(buildStoryboard(template, [audio]), []);
    }
  });

  it('多片段时长不超过素材可用源时长(视频截取 2.5s ≤ 30s)', () => {
    const assets = [fakeAsset('video')];
    const commands = buildStoryboard(STORYBOARD_TEMPLATES[0], assets);
    const adds = commands.filter((c) => c.type === 'clip.add' && c.clip.assetId === assets[0].id) as Extract<Command, { type: 'clip.add' }>[];
    for (const add of adds) {
      assert.ok(add.clip.inPoint + add.clip.duration * (add.clip.speed ?? 1) <= 30);
    }
  });
});
