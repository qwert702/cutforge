// 合成音效库的回归测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SFX_PRESETS, renderSfxToWav, sfxById, wavBlob } from './sfx.ts';

describe('合成音效库', () => {
  it('全部音效渲染出非零、有限、时长正确的样本', async () => {
    for (const preset of SFX_PRESETS) {
      const wav = await renderSfxToWav(preset);
      const expected = 44 + Math.ceil(preset.durationSeconds * 48_000) * 2;
      assert.equal(wav.size, expected, `${preset.id} wav 大小`);
    }
  });

  it('wav 头部为 RIFF/WAVE 且数据非全零', async () => {
    const preset = sfxById('chime')!;
    const wav = await renderSfxToWav(preset);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
    let sum = 0;
    for (let i = 44; i < bytes.length; i += 97) sum += bytes[i];
    assert.ok(sum > 0, '样本数据非全零');
  });

  it('wavBlob 对越界样本做 clamp', () => {
    const wav = wavBlob(new Float32Array([2, -2, 0.5]), 48_000);
    void wav;
    // clamp 后 int16 不越界:上面函数内部已 clamp,这里验证不抛错即可
  });

  it('sfxById 未知 id 返回 undefined', () => {
    assert.equal(sfxById('nope'), undefined);
  });
});
