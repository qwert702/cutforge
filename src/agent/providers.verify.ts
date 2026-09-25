// 多服务商存储的回归测试(localStorage 桩)。
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  addProvider,
  getActiveProvider,
  listProviders,
  loadActiveLlmConfig,
  removeProvider,
  setActiveProvider,
  updateProvider,
} from './providers.ts';

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

beforeEach(() => {
  store.clear();
});

describe('多服务商管理', () => {
  it('添加第一个服务商自动设为当前;loadActiveLlmConfig 接口兼容', () => {
    const provider = addProvider({ label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'k1', model: 'glm-4-flash' });
    assert.equal(getActiveProvider()?.id, provider.id);
    assert.deepEqual(loadActiveLlmConfig(), { baseUrl: provider.baseUrl, apiKey: 'k1', model: 'glm-4-flash' });
  });

  it('增删改与切换当前服务商', () => {
    const a = addProvider({ label: 'A', baseUrl: 'https://a', apiKey: 'ka', model: 'ma' });
    const b = addProvider({ label: 'B', baseUrl: 'https://b', apiKey: 'kb', model: 'mb' });
    assert.equal(getActiveProvider()?.id, a.id); // 第一个自动成为当前
    setActiveProvider(b.id);
    assert.equal(getActiveProvider()?.id, b.id);
    updateProvider(b.id, { apiKey: 'kb2' });
    assert.equal(getActiveProvider()?.apiKey, 'kb2');
    removeProvider(b.id);
    assert.equal(getActiveProvider()?.id, a.id); // 删除当前后回落
    assert.equal(listProviders().length, 1);
  });

  it('旧版单配置自动迁移为列表', () => {
    store.set('cutforge.llm.config.v1', JSON.stringify({ baseUrl: 'https://api.deepseek.com', apiKey: 'legacy', model: 'deepseek-chat' }));
    const provider = getActiveProvider();
    assert.equal(provider?.apiKey, 'legacy');
    assert.equal(provider?.label, 'DeepSeek');
    assert.equal(store.has('cutforge.llm.config.v1'), false); // 迁移后清理
  });

  it('删除全部服务商后 loadActiveLlmConfig 返回 null', () => {
    const a = addProvider({ label: 'A', baseUrl: 'https://a', apiKey: 'k', model: 'm' });
    removeProvider(a.id);
    assert.equal(loadActiveLlmConfig(), null);
  });
});
