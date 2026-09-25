// 统一设置中心:模型服务(多服务商管理/连接测试)、快捷键、关于。
import { useEffect, useReducer, useState } from 'react';
import {
  addProvider,
  getActiveProvider,
  listProviders,
  removeProvider,
  setActiveProvider,
  subscribeProviders,
  testProvider,
  updateProvider,
  type LlmProvider,
  type TestResult,
} from '../../agent/providers.ts';

const PROVIDER_PRESETS: readonly { label: string; baseUrl: string; model: string; hint?: string }[] = [
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: '有免费额度' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
];

type Tab = 'models' | 'shortcuts' | 'about';

export function SettingsCenter(props: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('models');
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal settings-center">
        <div className="panel-title">
          设置
          <button type="button" className="btn btn-small" onClick={props.onClose}>关闭</button>
        </div>
        <div className="settings-tabs">
          {([['models', '模型服务'], ['shortcuts', '快捷键'], ['about', '关于']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`settings-tab ${tab === id ? 'settings-tab-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'models' && <ModelsTab />}
        {tab === 'shortcuts' && <ShortcutsTab />}
        {tab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}

function useProviders(): readonly LlmProvider[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeProviders(force), []);
  return listProviders();
}

function ModelsTab() {
  const providers = useProviders();
  const activeId = getActiveProvider()?.id ?? null;
  const [editing, setEditing] = useState<LlmProvider | 'new' | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'pending'>>({});

  const runTest = async (provider: LlmProvider) => {
    setTesting(provider.id);
    setTestResults((prev) => ({ ...prev, [provider.id]: 'pending' }));
    const result = await testProvider(provider);
    setTestResults((prev) => ({ ...prev, [provider.id]: result }));
    setTesting(null);
  };

  if (editing) {
    return (
      <ProviderForm
        initial={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSave={(input, id) => {
          if (id) updateProvider(id, input);
          else addProvider(input);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="settings-body">
      <div className="settings-hint">配置任意 OpenAI 兼容服务;Key 只保存在本机浏览器。勾选的服务即为 AI 剪辑使用的服务。</div>
      <div className="provider-list">
        {providers.length === 0 && <div className="media-empty">还没有配置模型服务,点击下方按钮添加。</div>}
        {providers.map((provider) => {
          const result = testResults[provider.id];
          return (
            <div key={provider.id} className={`provider-row ${provider.id === activeId ? 'provider-active' : ''}`}>
              <label className="provider-active-check" title="设为当前使用">
                <input type="radio" name="active-provider" checked={provider.id === activeId} onChange={() => setActiveProvider(provider.id)} />
                <span className="provider-label">{provider.label}</span>
              </label>
              <span className="provider-model">{provider.model}</span>
              <span className="provider-key">Key {maskKey(provider.apiKey)}</span>
              {result === 'pending' && <span className="provider-test">测试中…</span>}
              {result && result !== 'pending' && (
                <span className={`provider-test ${result.ok ? 'provider-test-ok' : 'provider-test-fail'}`}>
                  {result.ok ? `✓ ${result.latencyMs}ms` : `✗ ${result.error}`}
                </span>
              )}
              <span className="provider-actions">
                <button type="button" className="btn btn-small" disabled={testing === provider.id} onClick={() => void runTest(provider)}>测试</button>
                <button type="button" className="btn btn-small" onClick={() => setEditing(provider)}>编辑</button>
                <button type="button" className="btn btn-small context-menu-danger" onClick={() => removeProvider(provider.id)}>删除</button>
              </span>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>＋ 添加服务商</button>
    </div>
  );
}

function ProviderForm(props: {
  initial: LlmProvider | null;
  onSave: (input: Omit<LlmProvider, 'id'>, id?: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(props.initial?.label ?? '');
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? '');
  const [model, setModel] = useState(props.initial?.model ?? '');

  return (
    <div className="settings-body">
      {props.initial === null && (
        <div className="chat-settings-presets">
          {PROVIDER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="btn btn-small"
              title={preset.hint ?? preset.baseUrl}
              onClick={() => {
                setLabel(preset.label);
                setBaseUrl(preset.baseUrl);
                setModel(preset.model);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <label className="inspector-row">
        名称
        <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如:智谱 GLM" />
      </label>
      <label className="inspector-row">
        接口地址 (OpenAI 兼容)
        <input className="settings-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="inspector-row">
        API Key
        <input className="settings-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>
      <label className="inspector-row">
        模型
        <input className="settings-input" value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="proposal-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={!baseUrl.trim() || !apiKey.trim() || !model.trim()}
          onClick={() => props.onSave({ label: label.trim() || '自定义服务', baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }, props.initial?.id)}
        >
          保存
        </button>
        <button type="button" className="btn btn-small" onClick={props.onCancel}>取消</button>
      </div>
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function ShortcutsTab() {
  return (
    <div className="settings-body">
      <div className="onboarding-shortcuts onboarding-shortcuts-column">
        <span><kbd>空格</kbd> 播放 / 暂停</span>
        <span><kbd>S</kbd> 在播放头分割选中片段</span>
        <span><kbd>Del</kbd> / <kbd>Backspace</kbd> 删除选中片段</span>
        <span><kbd>Ctrl+Z</kbd> 撤销</span>
        <span><kbd>Ctrl+Shift+Z</kbd> / <kbd>Ctrl+Y</kbd> 重做</span>
        <span>拖动片段移动(自动吸附)</span>
        <span>拖片段左右边缘裁剪</span>
        <span>双击轨道名重命名轨道</span>
        <span>右键片段更多操作</span>
        <span>把文件拖进窗口导入素材</span>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="settings-body settings-about">
      <div>CutForge v0.4.0(工作代号)</div>
      <div className="settings-hint">Agent 优先的开源 AI 视频编辑器 —— 社区版(AGPL-3.0)</div>
      <div className="settings-links">
        <a href="https://github.com/qwert702/cutforge" target="_blank" rel="noreferrer">GitHub 仓库</a>
        <a href="https://qwert702.github.io/cutforge/" target="_blank" rel="noreferrer">在线版</a>
      </div>
      <div className="settings-hint">工程与素材保存在本机;无遥测、无上传。第三方组件遵循其各自许可。</div>
    </div>
  );
}
