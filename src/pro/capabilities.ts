// Pro 能力门控:CE 内所有付费能力的唯一开关单元。
// 能力由授权服务器在激活时下发;本地只做缓存与查询,不做任何业务逻辑。

export type CapabilityId =
  | 'pro.export.mp4'
  | 'pro.fx.pack.advanced'
  | 'pro.batch'
  | 'pro.library.premium'
  | 'pro.cloud.sync';

export interface Entitlement {
  readonly token: string;
  readonly expiresAt: number;
  readonly capabilities: readonly CapabilityId[];
}

type Listener = () => void;

let entitlement: Entitlement | null = null;
const listeners = new Set<Listener>();

export function setEntitlement(next: Entitlement | null): void {
  entitlement = next;
  listeners.forEach((fn) => fn());
}

export function getEntitlement(): Entitlement | null {
  return entitlement;
}

/** 查询能力是否可用;过期授权一律视为不可用。 */
export function isUnlocked(capability: CapabilityId, now = Date.now()): boolean {
  if (!entitlement) return false;
  if (entitlement.expiresAt <= now) return false;
  return entitlement.capabilities.includes(capability);
}

export function subscribeEntitlement(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
