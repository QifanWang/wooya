import OpenAI from 'openai';
import type { WooyaConfig, ChatMessage, ToolCall, ToolDefinition } from '../types.js';

export interface LlmResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
}

function stripThink(content: string): string {
  let out = content.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
  if (out.includes('<think>') && !out.includes('</think>')) {
    out = '（模型推理未完成即被截断，可调大 provider 配置中的 maxTokens 后重试）';
  }
  return out;
}

function toApiMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: m.content ?? '',
        tool_call_id: m.tool_call_id ?? '',
        name: m.name,
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant' as const,
        content: m.content ?? null,
        tool_calls: m.tool_calls.map(c => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.function.name, arguments: JSON.stringify(c.function.args) },
        })),
      };
    }
    return { role: m.role, content: m.content ?? '' } as OpenAI.Chat.ChatCompletionMessageParam;
  });
}

function toApiTools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function createClient(cfg: WooyaConfig): OpenAI {
  if (!cfg.apiKey) {
    throw new Error('未配置 API key，请先在会话中运行 /provider add <name> <base-url> 登记 provider');
  }
  return new OpenAI({
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    maxRetries: 3,
    timeout: 120_000,
  });
}

export async function chatCompletion(
  cfg: WooyaConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<LlmResult> {
  const client = createClient(cfg);
  const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: cfg.model,
    messages: toApiMessages(messages),
    max_tokens: cfg.maxTokens,
    ...(tools.length ? { tools: toApiTools(tools) } : {}),
  };
  const res = await client.chat.completions.create(params);
  const msg = res.choices[0]?.message;

  const toolCalls: ToolCall[] = (msg?.tool_calls ?? [])
    .filter(c => c.type === 'function')
    .map(c => {
      const fn = (c as { id: string; function: { name: string; arguments: string } }).function;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(fn.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: fn.arguments };
      }
      return { id: c.id, type: 'function', function: { name: fn.name, args } };
    });

  return {
    content: msg?.content ? stripThink(msg.content) : null,
    toolCalls,
    finishReason: res.choices[0]?.finish_reason,
    promptTokens: res.usage?.prompt_tokens,
    completionTokens: res.usage?.completion_tokens,
  };
}
