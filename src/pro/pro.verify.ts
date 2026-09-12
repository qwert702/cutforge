// Pro 边界模块的回归测试(fetch 注入,不发真实请求)。

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { isUnlocked, setEntitlement, type Entitlement } from './capabilities.ts';
import { activateLicense, cloudRequest, persistEntitlement, type GatewayConfig } from './gateway.ts';

// gateway.ts 引用了 localStorage(浏览器 API),在 Node 测试环境补最小桩;
// crypto.randomUUID 在 Node 24 已原生存在,无需桩。
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

const config: GatewayConfig = { baseUrl: 'https://gateway.test' };

// 各测试之间清空模块态与本地持久化态,避免相互污染
beforeEach(() => {
  store.clear();
  setEntitlement(null);
});

const entitlement: Entitlement = {
  token: 'tok',
  expiresAt: Date.now() + 60_000,
  capabilities: ['pro.library.premium'],
};

describe('能力门控', () => {
  it('未激活/过期/未包含 三种情况都不可用', () => {
    setEntitlement(null);
    assert.equal(isUnlocked('pro.library.premium'), false);
    setEntitlement({ ...entitlement, expiresAt: Date.now() - 1 });
    assert.equal(isUnlocked('pro.library.premium'), false);
    setEntitlement(entitlement);
    assert.equal(isUnlocked('pro.library.premium'), true);
    assert.equal(isUnlocked('pro.export.mp4'), false);
  });
});

describe('授权激活', () => {
  it('成功激活:下发能力并持久化', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ token: 'tok-1', expiresAt: Date.now() + 3600_000, capabilities: ['pro.batch'] }), {
        status: 200,
      })) as typeof fetch;
    const result = await activateLicense(config, ' ABC-123 ', fetchImpl);
    assert.equal(result.ok, true);
    assert.deepEqual(result.entitlement?.capabilities, ['pro.batch']);
    assert.equal(isUnlocked('pro.batch'), true);
  });

  it('服务端拒绝:返回错误且不落地', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: '授权码无效' }), { status: 403 })) as typeof fetch;
    const result = await activateLicense(config, 'BAD', fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.error, '授权码无效');
    assert.equal(isUnlocked('pro.batch'), false);
  });

  it('网络失败:给出可读错误', async () => {
    const fetchImpl = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    const result = await activateLicense(config, 'ABC', fetchImpl);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /ECONNREFUSED/);
  });
});

describe('云端请求', () => {
  it('无授权时直接抛错,不发请求', async () => {
    setEntitlement(null);
    let called = false;
    const fetchImpl = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
    await assert.rejects(cloudRequest(config, '/v1/library/items', {}, fetchImpl), /Pro 订阅/);
    assert.equal(called, false);
  });

  it('有授权时附带 Bearer token', async () => {
    persistEntitlement(entitlement);
    let auth: string | undefined;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return new Response('{}');
    }) as typeof fetch;
    await cloudRequest(config, '/v1/library/items', {}, fetchImpl);
    assert.equal(auth, 'Bearer tok');
  });
});
