// AI 聊天面板:BYO Key(OpenAI 兼容接口),Agent 工具调用直接操作时间线。
// 循环:用户消息 → 模型 → (工具调用 ⇄ 工具结果)* → 最终回答。
// 每次派发命令都走编辑器的命令层,可撤销;失败结果会回传给模型自我纠正。

import { useRef, useState } from 'react';
import {
  chatCompletion,
  loadLlmConfig,
  saveLlmConfig,
  type ChatMessage,
  type LlmConfig,
  type ToolCall,
} from '../../agent/llm.ts';
import { AGENT_TOOL_SCHEMAS, describeProject, executeTool } from '../../agent/tools.ts';
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
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n当前工程状态:\n${describeProject(docRef.current)}` },
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
          // 工具直接操作编辑器 store;随后同步最新文档给下一轮
          const toolResult = executeTool(call.name, call.arguments, editorStore.get().history.present);
          messages.push({ role: 'tool', content: toolResult, toolCallId: call.id });
          append({ role: 'assistant', text: `🔧 ${call.name} → ${toolResult}` });
          scrollToEnd();
        }
        if (round === MAX_TOOL_ROUNDS - 1) {
          append({ role: 'error', text: '达到工具调用轮次上限,已停止。' });
        }
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
            试试:「把素材 a 加到时间线开头」「在 3 秒处分割第一个片段」。
            <br />
            Agent 与手工编辑共用同一套命令,所有修改都可以 Ctrl+Z 撤销。
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={`chat-entry chat-entry-${entry.role}`}>{entry.text}</div>
        ))}
      </div>
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

function SettingsForm(props: { initial: LlmConfig | null; onSave: (config: LlmConfig) => void }) {
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState(props.initial?.apiKey ?? '');
  const [model, setModel] = useState(props.initial?.model ?? 'gpt-5-mini');
  return (
    <div className="chat-settings">
      <label>
        接口地址 (OpenAI 兼容)
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
      </label>
      <label>
        API Key
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </label>
      <label>
        模型
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <div className="chat-settings-hint">配置只保存在本机浏览器,请求直接发给你填写的接口。</div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => baseUrl.trim() && apiKey.trim() && model.trim() && props.onSave({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })}
      >
        保存
      </button>
    </div>
  );
}
