// AI 聊天面板:BYO Key(OpenAI 兼容接口),Agent 工具调用直接操作时间线。
// 循环:用户消息 → 模型 → (工具调用 ⇄ 工具结果)* → 最终回答。
// 每次派发命令都走编辑器的命令层,可撤销;失败结果会回传给模型自我纠正。

import { useRef, useState, useSyncExternalStore } from 'react';
import {
  chatCompletion,
  loadLlmConfig,
  saveLlmConfig,
  type ChatMessage,
  type LlmConfig,
  type ToolCall,
} from '../../agent/llm.ts';
import { AGENT_TOOL_SCHEMAS, currentAgentDoc, describeProject, executeTool } from '../../agent/tools.ts';
import {
  approveProposal,
  getProposal,
  isProposalMode,
  rejectProposal,
  setProposalMode,
  subscribeProposal,
  type Proposal,
} from '../../agent/proposal.ts';
import { editorStore, useProject } from '../hooks/useEditorStore.ts';

interface ChatEntry {
  readonly role: 'user' | 'assistant' | 'error';
  readonly text: string;
}

const SYSTEM_PROMPT = [
  '你是 CutForge 的剪辑助手,通过工具操作一个真实的多轨视频时间线。',
  '规则:',
  '1. 操作前先用 list_project 了解素材与片段的 id 和位置;',
  '2. 只通过工具修改时间线,不要编造 id;',
  '3. 操作被拒绝时,阅读错误原因(常见:片段重叠、超出素材时长)并调整参数重试;',
  '4. 完成后用一句话总结你做了什么。',
].join('\n');

const MAX_TOOL_ROUNDS = 8;

export function ChatPanel() {
  const doc = useProject();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<LlmConfig | null>(loadLlmConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [proposalMode, setProposalModeState] = useState(() => isProposalMode());
  const proposal = useSyncExternalStore(subscribeProposal, getProposal, getProposal);
  const listRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const append = (entry: ChatEntry) => setEntries((prev) => [...prev, entry]);

  const scrollToEnd = () => {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const llm = loadLlmConfig();
    if (!llm) {
      setShowSettings(true);
      append({ role: 'error', text: '请先在上方设置里填写模型接口与 API Key。' });
      return;
    }
    setInput('');
    setBusy(true);
    append({ role: 'user', text });
    scrollToEnd();

    const messages: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}${proposalMode ? '\n当前为提案模式:你的改动会先进入提案,由用户预览并批准后生效。' : ''}\n\n当前工程状态:\n${describeProject(currentAgentDoc())}` },
      { role: 'user', content: text },
    ];
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const result = await chatCompletion(llm, messages, AGENT_TOOL_SCHEMAS);
        if (result.toolCalls.length === 0) {
          append({ role: 'assistant', text: result.content ?? '(空回复)' });
          break;
        }
        messages.push({
          role: 'assistant',
          content: result.content,
          toolCalls: result.toolCalls as readonly ToolCall[],
        });
        for (const call of result.toolCalls) {
          // 工具作用于当前文档(提案模式下为草稿);随后同步最新状态给下一轮
          const toolResult = executeTool(call.name, call.arguments, currentAgentDoc());
          messages.push({ role: 'tool', content: toolResult, toolCallId: call.id });
          append({ role: 'assistant', text: `🔧 ${call.name} → ${toolResult}` });
          scrollToEnd();
        }
        if (round === MAX_TOOL_ROUNDS - 1) {
          append({ role: 'error', text: '达到工具调用轮次上限,已停止。' });
        }
      }
      if (getProposal() && getProposal()!.entries.length > 0) {
        append({ role: 'assistant', text: `📋 提案已就绪(共 ${getProposal()!.entries.length} 项变更),请在下方预览并批准。` });
      }
    } catch (error) {
      append({ role: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  };

  return (
    <div className="chat-panel">
      <div className="panel-title chat-title">
        AI 剪辑
        <span className="chat-mode">
          <input
            id="proposal-mode"
            type="checkbox"
            checked={proposalMode}
            title="开启后 AI 的改动先进入提案预览,你批准后才真正生效"
            onChange={(e) => {
              setProposalMode(e.target.checked);
              setProposalModeState(e.target.checked);
            }}
          />
          <label htmlFor="proposal-mode">提案模式</label>
        </span>
        <button type="button" className="btn btn-small" onClick={() => setShowSettings(!showSettings)}>
          设置
        </button>
      </div>
      {showSettings && (
        <SettingsForm
          initial={config}
          onSave={(next) => {
            saveLlmConfig(next);
            setConfig(next);
            setShowSettings(false);
          }}
        />
      )}
      <div className="chat-list" ref={listRef}>
        {entries.length === 0 && (
          <div className="chat-hint">
            {config ? (
              <>
                试试:「把素材 a 加到时间线开头」「在 3 秒处分割第一个片段」
                「给第一个片段加 1 秒淡入」。
                <br />
                Agent 与手工编辑共用同一套命令,所有修改都可以 Ctrl+Z 撤销。
              </>
            ) : (
              <>
                <b>三步开始 AI 剪辑:</b>
                <br />
                ① 点上方「设置」,选一个 AI 服务(推荐智谱,有免费额度)并填入 API Key;
                <br />
                ② 点左侧「🎬 加载示例工程」生成素材;
                <br />
                ③ 直接说「把示例铺到时间线,加一个标题,每个片段加淡入淡出」。
                <br />
                <span className="chat-hint-dim">没有 Key 也完全可以用:手动剪辑 + 导出全部功能不受影响。</span>
              </>
            )}
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={`chat-entry chat-entry-${entry.role}`}>{entry.text}</div>
        ))}
      </div>
      {proposal && (proposal.entries.length > 0 || proposal.rejected.length > 0) && (
        <ProposalCard proposal={proposal} />
      )}
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          placeholder={config ? '描述你想做的剪辑…' : '先配置模型接口…'}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => void send()}>
          {busy ? '…' : '发送'}
        </button>
      </div>
    </div>
  );
}

/** 常用服务商预设:点击即填好接口与模型,用户只需填 Key。 */
const LLM_PRESETS: readonly { label: string; baseUrl: string; model: string; hint?: string }[] = [
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: '有免费额度' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '通义 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
];

/** 提案卡片:展示待批准的变更清单,批准 = 一次撤销点应用到真实工程。 */
function ProposalCard(props: { proposal: Proposal }) {
  const { proposal } = props;
  const [error, setError] = useState<string | null>(null);

  const approve = () => {
    // 先尝试派发到真实工程,成功才清空提案;失败保留提案供用户重试/拒绝
    const commands = proposal.entries.map((entry) => entry.command);
    const result = editorStore.dispatchAll(commands, '应用 AI 提案');
    if (result.ok) {
      approveProposal();
      editorStore.notify('提案已应用,Ctrl+Z 可撤销');
    } else {
      setError(`应用失败:${result.error}(工程可能已被手动修改;可拒绝后重新让 AI 生成)`);
    }
  };

  return (
    <div className="proposal-card">
      <div className="proposal-head">
        📋 提案 · {proposal.entries.length} 项变更
        <span className="proposal-badge">预览中(未生效)</span>
      </div>
      <div className="proposal-list">
        {proposal.entries.map((entry, i) => (
          <div key={i} className="proposal-entry">{entry.label}</div>
        ))}
        {proposal.rejected.map((r, i) => (
          <div key={`r${i}`} className="proposal-entry proposal-entry-rejected">
            ✕ {r.label} —— {r.error}
          </div>
        ))}
      </div>
      {error && <div className="proposal-error">{error}</div>}
      <div className="proposal-actions">
        <button type="button" className="btn btn-small btn-primary" onClick={approve}>
          ✓ 批准应用
        </button>
        <button type="button" className="btn btn-small" onClick={() => rejectProposal()}>
          ✕ 拒绝
        </button>
      </div>
    </div>
  );
}

function SettingsForm(props: { initial: LlmConfig | null; onSave: (config: LlmConfig) => void }) {  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4');
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? '');
  const [model, setModel] = useState(props.initial?.model ?? 'glm-4-flash');
  return (
    <div className="chat-settings">
      <div className="chat-settings-presets">
        {LLM_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="btn btn-small"
            title={preset.hint ?? preset.baseUrl}
            onClick={() => {
              setBaseUrl(preset.baseUrl);
              setModel(preset.model);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label>
        接口地址 (OpenAI 兼容)
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label>
        API Key
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="在服务商控制台创建" />
      </label>
      <label>
        模型
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="chat-settings-hint">Key 只保存在本机浏览器,请求直接发给你选择的服务商,不经过任何第三方。</div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => baseUrl.trim() && apiKey.trim() && model.trim() && props.onSave({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })}
      >
        保存并开始使用
      </button>
    </div>
  );
}
