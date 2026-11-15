import { chatCompletion } from './llm.js';
import { logEvent } from '../logger.js';
import type { ChatMessage, SessionState, ToolDefinition, WooyaConfig } from '../types.js';

const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_AGENT_TURNS = 12;
const HISTORY_KEEP = 60;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（结果过长已截断，请缩小检索范围或用 startLine/endLine 分段读取）`;
}

export function newSession(systemPrompt: string): SessionState {
  return {
    messages: [{ role: 'system', content: systemPrompt }],
    mode: 'default',
    learn: null,
  };
}

function trimHistory(session: SessionState): void {
  const msgs = session.messages;
  if (msgs.length <= HISTORY_KEEP + 1) return;
  const tail = msgs.slice(msgs.length - HISTORY_KEEP);
  while (tail.length > 0 && tail[0].role === 'tool') tail.shift();
  session.messages = [msgs[0], ...tail];
}

export async function runAgentTurn(
  cfg: WooyaConfig,
  session: SessionState,
  tools: ToolDefinition[],
  userInput: string,
  verbose: boolean,
): Promise<string> {
  session.messages.push({ role: 'user', content: userInput });

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn++) {
    const started = Date.now();
    const res = await chatCompletion(cfg, session.messages, tools);
    logEvent(cfg, verbose, {
      kind: 'llm',
      turn,
      ms: Date.now() - started,
      finishReason: res.finishReason,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      toolCalls: res.toolCalls.map(c => c.function.name),
    });

    if (res.toolCalls.length > 0) {
      session.messages.push({ role: 'assistant', content: res.content ?? '', tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const t0 = Date.now();
        const tool = tools.find(t => t.name === call.function.name);
        let result: string;
        if (!tool) {
          result = `错误：未知工具 ${call.function.name}`;
        } else {
          try {
            result = await tool.run(call.function.args);
          } catch (err) {
            result = `工具执行出错：${err instanceof Error ? err.message : String(err)}（请调整参数后重试）`;
          }
        }
        if (session.mode === 'learn') {
          session.learn?.toolTrace.push({ name: call.function.name, args: call.function.args });
        }
        logEvent(cfg, verbose, {
          kind: 'tool',
          name: call.function.name,
          args: call.function.args,
          ms: Date.now() - t0,
        });
        session.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: truncate(result, MAX_TOOL_RESULT_CHARS),
        });
      }
      continue;
    }

    let answer = res.content ?? '（空回答）';
    if (res.finishReason === 'length') {
      answer += '\n\n（注意：本次回答因 max_tokens 上限被截断，可在 provider 配置中调大 maxTokens）';
    }
    session.messages.push({ role: 'assistant', content: answer });
    trimHistory(session);
    return answer;
  }

  session.messages.push({ role: 'user', content: '请基于以上信息直接给出最终回答，不要再调用工具。' });
  const res = await chatCompletion(cfg, session.messages, []);
  let answer = res.content ?? '（空回答）';
  if (res.finishReason === 'length') {
    answer += '\n\n（注意：本次回答因 max_tokens 上限被截断，可在 provider 配置中调大 maxTokens）';
  }
  session.messages.push({ role: 'assistant', content: answer });
  trimHistory(session);
  return answer;
}
