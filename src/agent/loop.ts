import { chatCompletion } from './llm.js';
import { createSpinner, makeThinkRenderer, type ThinkMode } from '../ui.js';
import { logEvent } from '../logger.js';
import type { ChatMessage, SessionState, ToolDefinition, WooyaConfig } from '../types.js';

export interface RunTurnOptions {
  /** 流式回调：可见输出（回答正文、灰色思考内容、折叠标记）逐段到达时触发 */
  onDelta?: (text: string) => void;
  /** 其中属于"回答正文"的部分（判断是否需要回退整体打印用） */
  onAnswerDelta?: (text: string) => void;
  /** <think> 展示策略，默认 collapsed（折叠） */
  thinkMode?: ThinkMode;
}

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
  opts: RunTurnOptions = {},
): Promise<string> {
  session.messages.push({ role: 'user', content: userInput });

  // verbose 模式下日志与 spinner 互相干扰，禁用 spinner
  const spinner = createSpinner(process.stdout.isTTY === true && !verbose);
  // 思考段折叠期间 spinner 继续转，首个可见输出出现时才停
  let streamed = false;
  const renderer = makeThinkRenderer(opts.thinkMode ?? 'collapsed', {
    out: text => {
      if (!streamed) {
        streamed = true;
        spinner.stop();
      }
      opts.onDelta?.(text);
    },
    onAnswer: text => opts.onAnswerDelta?.(text),
  });
  const chat = async (msgs: ChatMessage[], defs: ToolDefinition[]) => {
    spinner.start('思考中…');
    streamed = false;
    const res = await chatCompletion(cfg, msgs, defs, { onDelta: delta => renderer.feed(delta) });
    renderer.end();
    spinner.stop();
    return res;
  };

  for (let turn = 1; turn <= MAX_AGENT_TURNS; turn++) {
    const started = Date.now();
    const res = await chat(session.messages, tools);
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
        spinner.start(`调用工具 ${call.function.name} …`);
        if (!tool) {
          result = `错误：未知工具 ${call.function.name}`;
        } else {
          try {
            result = await tool.run(call.function.args);
          } catch (err) {
            result = `工具执行出错：${err instanceof Error ? err.message : String(err)}（请调整参数后重试）`;
          }
        }
        spinner.stop();
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
  const res = await chat(session.messages, []);
  let answer = res.content ?? '（空回答）';
  if (res.finishReason === 'length') {
    answer += '\n\n（注意：本次回答因 max_tokens 上限被截断，可在 provider 配置中调大 maxTokens）';
  }
  session.messages.push({ role: 'assistant', content: answer });
  trimHistory(session);
  return answer;
}
