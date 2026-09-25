// 极简 OpenAI 兼容聊天补全客户端(fetch 实现,零依赖)。
// 任何暴露 /chat/completions 的服务都可用:OpenAI / GLM / DeepSeek / Kimi / Qwen / 本地网关。

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** JSON 字符串 */
  readonly arguments: string;
}

export interface ToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export type ChatMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly toolCalls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly content: string; readonly toolCallId: string };

interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

// ── 当前使用的服务商配置由 src/agent/providers.ts 统一管理 ──────────────────

function toWire(message: ChatMessage): WireMessage {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
    default:
      return { role: message.role, content: message.content };
  }
}

export interface CompletionResult {
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
  readonly finishReason: string;
}

export async function chatCompletion(
  config: LlmConfig,
  messages: readonly ChatMessage[],
  tools: readonly ToolSchema[],
): Promise<CompletionResult> {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(toWire),
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LLM 请求失败 (HTTP ${response.status}):${text.slice(0, 300)}`);
  }
  const body = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      finish_reason?: string;
    }>;
  };
  const choice = body.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: (choice?.message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    finishReason: choice?.finish_reason ?? 'stop',
  };
}
