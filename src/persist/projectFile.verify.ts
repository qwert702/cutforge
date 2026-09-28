// 工程文件导出/导入的往返回归测试(node 环境直接可跑)。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyProject, type MediaAsset, type ProjectDoc } from '../core/types.ts';
import { applyCommand } from '../core/reducer.ts';
import { assetAddCommands, exportProjectFile, importProjectFile, projectFileName } from './projectFile.ts';

function makeDocWithAsset(): { doc: ProjectDoc; blob: Blob } {
  const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer], { type: 'video/mp4' });
  const asset: MediaAsset = {
    id: 'asset_x', name: 'clip.mp4', kind: 'video', url: 'blob:inmemory',
    durationSeconds: 5, width: 1920, height: 1080,
  };
  let doc = emptyProject('导出测试');
  const withAsset = applyCommand(doc, { type: 'asset.add', asset });
  assert.ok(withAsset.ok);
  doc = withAsset.doc;
  const withTrack = applyCommand(doc, { type: 'track.add', track: { id: 't1', kind: 'video', name: '视频 1' } });
  assert.ok(withTrack.ok);
  doc = withTrack.doc;
  const withClip = applyCommand(doc, {
    type: 'clip.add',
    clip: { id: 'c1', trackId: 't1', assetId: 'asset_x', start: 0, duration: 2, inPoint: 0 },
  });
  assert.ok(withClip.ok);
  doc = withClip.doc;
  return { doc, blob };
}

describe('工程文件 .cforge', () => {
  it('导出 → 导入往返:文档与素材一致', async () => {
    const { doc, blob } = makeDocWithAsset();
    const file = await exportProjectFile(doc, new Map([['asset_x', blob]]));
    assert.ok(file.size > 10);
    const loaded = await importProjectFile(new File([file], 'test.cforge'));
    assert.equal(loaded.doc.name, '导出测试');
    assert.equal(loaded.doc.clips.length, 1);
    assert.equal(loaded.doc.clips[0].id, 'c1');
    const restored = loaded.media.get('asset_x');
    assert.ok(restored);
    assert.equal(restored.size, 8);
    const bytes = new Uint8Array(await restored.arrayBuffer());
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('导入命令可重放(asset.add 携带原 id)', async () => {
    const { doc, blob } = makeDocWithAsset();
    const file = await exportProjectFile(doc, new Map([['asset_x', blob]]));
    const loaded = await importProjectFile(new File([file], 't.cforge'));
    let restored = emptyProject();
    for (const command of assetAddCommands(loaded.doc)) {
      const result = applyCommand(restored, command);
      if (!result.ok) throw new Error(`asset.add 被拒绝:${result.error}`);
      restored = result.doc;
    }
    assert.equal(restored.assets[0].id, 'asset_x');
  });

  it('损坏文件给出可读错误', async () => {
    const garbage = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.cforge');
    await assert.rejects(() => importProjectFile(garbage), /无法读取工程文件/);
  });

  it('projectFileName 清洗非法字符', () => {
    assert.equal(projectFileName('a/b:c*d?"<>|'), 'a_b_c_d_____.cforge');
    assert.equal(projectFileName(''), '工程.cforge');
  });
});
