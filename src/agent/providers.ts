// 多模型服务商管理:统一的 LLM 接入设置。
// 存储:localStorage `cutforge.llm.providers.v1` = { providers: LlmProvider[], activeId }
// 旧版单配置(`cutforge.llm.config.v1`)在首次读取时自动迁移。
// 该模块只管存储与选择;发请求仍由 llm.ts 的 chatCompletion 完成。

import type { LlmConfig } from './llm.ts';

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

const STORE_KEY = 'cutforge.llm.providers.v1';
const LEGACY_KEY = 'cutforge.llm.config.v1';

interface ProviderStore {
  readonly providers: readonly LlmProvider[];
  readonly activeId: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function readStore(): ProviderStore {
  let parsed: ProviderStore | null = null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) parsed = JSON.parse(raw) as ProviderStore;
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.providers)) {
    parsed = migrateLegacy() ?? { providers: [], activeId: null };
  }
  return parsed;
}

/** 旧版单配置 → providers 列表(只迁移一次,迁移后删除旧键)。 */
function migrateLegacy(): ProviderStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as Partial<LlmConfig>;
    if (!legacy.baseUrl || !legacy.apiKey || !legacy.model) return null;
    const provider: LlmProvider = {
      id: uid(),
      label: labelFromUrl(legacy.baseUrl),
      baseUrl: legacy.baseUrl,
      apiKey: legacy.apiKey,
      model: legacy.model,
    };
    const store: ProviderStore = { providers: [provider], activeId: provider.id };
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    localStorage.removeItem(LEGACY_KEY);
    return store;
  } catch {
    return null;
  }
}

function persist(store: ProviderStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* 忽略 */
  }
  emit();
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function labelFromUrl(baseUrl: string): string {
  if (baseUrl.includes('bigmodel')) return '智谱 GLM';
  if (baseUrl.includes('deepseek')) return 'DeepSeek';
  if (baseUrl.includes('moonshot')) return 'Kimi';
  if (baseUrl.includes('dashscope') || baseUrl.includes('aliyuncs')) return '通义 Qwen';
  if (baseUrl.includes('openai.com')) return 'OpenAI';
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '自定义服务';
  }
}

// ── 读取 ────────────────────────────────────────────────────────────────────

export function listProviders(): readonly LlmProvider[] {
  return readStore().providers;
}

export function getActiveProvider(): LlmProvider | null {
  const store = readStore();
  return store.providers.find((p) => p.id === store.activeId) ?? store.providers[0] ?? null;
}

/** 兼容旧接口:当前使用的服务商,没有则 null。 */
export function loadActiveLlmConfig(): LlmConfig | null {
  const provider = getActiveProvider();
  if (!provider) return null;
  return { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model };
}

export function subscribeProviders(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── 修改 ────────────────────────────────────────────────────────────────────

export function addProvider(input: Omit<LlmProvider, 'id'>): LlmProvider {
  const store = readStore();
  const provider: LlmProvider = { ...input, id: uid() };
  persist({
    providers: [...store.providers, provider],
    activeId: store.activeId ?? provider.id, // 第一个自动设为当前
  });
  return provider;
}

export function updateProvider(id: string, patch: Partial<Omit<LlmProvider, 'id'>>): void {
  const store = readStore();
  persist({
    providers: store.providers.map((p) => (p.id === id ? { ...p, ...patch, id } : p)),
    activeId: store.activeId,
  });
}

export function removeProvider(id: string): void {
  const store = readStore();
  const providers = store.providers.filter((p) => p.id !== id);
  persist({
    providers,
    activeId: store.activeId === id ? (providers[0]?.id ?? null) : store.activeId,
  });
}

export function setActiveProvider(id: string): void {
  const store = readStore();
  if (!store.providers.some((p) => p.id === id)) return;
  persist({ providers: store.providers, activeId: id });
}

// ── 连接测试 ────────────────────────────────────────────────────────────────

export interface TestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

/** 发一条最小补全请求验证连通性与 Key。 */
export async function testProvider(provider: Pick<LlmProvider, 'baseUrl' | 'apiKey' | 'model'>): Promise<TestResult> {
  const started = performance.now();
  try {
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, latencyMs, error: `HTTP ${response.status}${text ? `:${text.slice(0, 120)}` : ''}` };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
  }
}
