// 滤镜预设的回归测试。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FILTER_PRESETS, filterCssFor } from './filters.ts';

describe('滤镜预设', () => {
  it('所有预设强度 0 都返回空串(无滤镜)', () => {
    for (const preset of FILTER_PRESETS) {
      assert.equal(filterCssFor(preset.id, 0), '', `${preset.id} at 0`);
    }
  });

  it('所有预设强度 1 都产生非空且含 filter 函数的字符串', () => {
    const fns = ['contrast', 'saturate', 'brightness', 'grayscale', 'sepia', 'hue-rotate', 'blur'];
    for (const preset of FILTER_PRESETS) {
      const css = filterCssFor(preset.id, 1);
      assert.ok(css.length > 0, `${preset.id} should produce css`);
      assert.ok(fns.some((fn) => css.includes(fn)), `${preset.id} uses a known filter fn`);
    }
  });

  it('未知预设与缺省强度安全降级', () => {
    assert.equal(filterCssFor('not-exist', 1), '');
    assert.equal(filterCssFor('cinema', undefined).length > 0, true); // 缺省强度 = 1
  });

  it('强度单调:越大字符串中的数值越极端(以黑白为例)', () => {
    assert.ok(filterCssFor('bw', 0.5).includes('50%'));
    assert.ok(filterCssFor('bw', 1).includes('100%'));
  });
});
