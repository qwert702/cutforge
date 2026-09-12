// Pro 授权网关客户端(开源,CE 内唯一与云端交互的边界模块)。
// 只包含请求封装与 token 管理;所有业务校验都在服务端。
// fetch 通过参数注入,便于测试与未来替换传输实现。

import { setEntitlement, type CapabilityId, type Entitlement } from './capabilities.ts';

export interface GatewayConfig {
  /** 云服务基地址,发布前替换为正式域名 */
  readonly baseUrl: string;
}

export const DEFAULT_GATEWAY: GatewayConfig = {
  baseUrl: 'https://cloud.cutforge.example',
};

const TOKEN_KEY = 'cutforge.pro.token.v1';

export function loadLocalEntitlement(): Entitlement | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entitlement;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number' || !Array.isArray(parsed.capabilities)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function persistEntitlement(entitlement: Entitlement | null): void {
  if (entitlement) localStorage.setItem(TOKEN_KEY, JSON.stringify(entitlement));
  else localStorage.removeItem(TOKEN_KEY);
  setEntitlement(entitlement);
}

export interface ActivateResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly entitlement?: Entitlement;
}

/** 激活 License Key:服务端校验并下发签名 token 与能力列表。 */
export async function activateLicense(
  config: GatewayConfig,
  licenseKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActivateResult> {
  const key = licenseKey.trim();
  if (!key) return { ok: false, error: '请输入授权码' };
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/v1/licenses/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, deviceId: deviceId() }),
    });
  } catch (error) {
    return { ok: false, error: `无法连接授权服务器:${error instanceof Error ? error.message : String(error)}` };
  }
  const body = (await response.json().catch(() => null)) as
    | { token?: string; expiresAt?: number; capabilities?: CapabilityId[]; error?: string }
    | null;
  if (!response.ok || !body?.token || typeof body.expiresAt !== 'number' || !Array.isArray(body.capabilities)) {
    return { ok: false, error: body?.error ?? `激活失败 (HTTP ${response.status})` };
  }
  const entitlement: Entitlement = { token: body.token, expiresAt: body.expiresAt, capabilities: body.capabilities };
  persistEntitlement(entitlement);
  return { ok: true, entitlement };
}

export function deactivateLicense(config: GatewayConfig, fetchImpl: typeof fetch = fetch): Promise<void> {
  const current = loadLocalEntitlement();
  persistEntitlement(null);
  if (!current) return Promise.resolve();
  return fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/v1/licenses/deactivate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` },
    body: JSON.stringify({ deviceId: deviceId() }),
  }).then(() => undefined, () => undefined);
}

/** 带授权的云端请求封装(素材库、云渲染等);未授权直接抛错。 */
export async function cloudRequest(
  config: GatewayConfig,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const current = loadLocalEntitlement();
  if (!current || current.expiresAt <= Date.now()) {
    throw new Error('需要有效的 Pro 订阅');
  }
  return fetchImpl(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${current.token}` },
  });
}

/** 稳定的设备标识(非追踪用途,仅授权绑定)。 */
function deviceId(): string {
  let id = localStorage.getItem('cutforge.device.id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('cutforge.device.id', id);
  }
  return id;
}
