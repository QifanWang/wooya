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

export interface ChatOptions {
  /** 流式回调：模型正文增量到达时逐段触发（仅 content，不含工具调用） */
  onDelta?: (delta: string) => void;
}

export async function chatCompletion(
  cfg: WooyaConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  opts: ChatOptions = {},
): Promise<LlmResult> {
  const client = createClient(cfg);
  const base: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: cfg.model,
    messages: toApiMessages(messages),
    max_tokens: cfg.maxTokens,
    ...(tools.length ? { tools: toApiTools(tools) } : {}),
  };

  if (!opts.onDelta) {
    const res = await client.chat.completions.create(base);
    return toResult(
      res.choices[0]?.message?.content ?? null,
      parseToolCalls(res.choices[0]?.message?.tool_calls ?? []),
      res.choices[0]?.finish_reason,
      res.usage?.prompt_tokens,
      res.usage?.completion_tokens,
    );
  }

  const stream = await createStream(client, base);
  let content = '';
  let finishReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  // index → 累积中的工具调用（流式下 id/name/arguments 分片到达）
  const pending = new Map<number, { id?: string; name?: string; args: string }>();

  for await (const chunk of stream) {
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      completionTokens = chunk.usage.completion_tokens;
    }
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      content += delta.content;
      opts.onDelta(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const slot = pending.get(tc.index) ?? { args: '' };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      pending.set(tc.index, slot);
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  const toolCalls: ToolCall[] = [...pending.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, slot]) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(slot.args || '{}') as Record<string, unknown>;
      } catch {
        args = { _raw: slot.args };
      }
      return {
        id: slot.id ?? `call_${idx}`,
        type: 'function' as const,
        function: { name: slot.name ?? '', args },
      };
    });

  return toResult(content ? stripThink(content) : null, toolCalls, finishReason, promptTokens, completionTokens);
}

async function createStream(
  client: OpenAI,
  base: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>> {
  try {
    return await client.chat.completions.create({
      ...base,
      stream: true,
      stream_options: { include_usage: true },
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
  } catch (err) {
    // 部分 OpenAI 兼容服务不支持 stream_options，去掉后重试一次
    if ((err as { status?: number }).status === 400) {
      return await client.chat.completions.create({
        ...base,
        stream: true,
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);
    }
    throw err;
  }
}

function parseToolCalls(raw: OpenAI.Chat.ChatCompletionMessageToolCall[]): ToolCall[] {
  return raw
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
}

function toResult(
  content: string | null,
  toolCalls: ToolCall[],
  finishReason?: string,
  promptTokens?: number,
  completionTokens?: number,
): LlmResult {
  return { content, toolCalls, finishReason, promptTokens, completionTokens };
}
