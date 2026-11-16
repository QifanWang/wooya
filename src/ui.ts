import * as readline from 'node:readline';

/** 等待指示器：仅在 TTY 下渲染，start/stop 可重复调用 */
export interface Spinner {
  start(text?: string): void;
  stop(): void;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createSpinner(enabled: boolean): Spinner {
  if (!enabled) {
    return { start() {}, stop() {} };
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;
  let text = '思考中…';

  const render = (): void => {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${FRAMES[frame++ % FRAMES.length]} ${text}`);
  };

  return {
    start(t?: string) {
      this.stop();
      if (t !== undefined) text = t;
      render();
      timer = setInterval(render, 100);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// <think> 渲染器
// ---------------------------------------------------------------------------

/** 思考内容展示策略：collapsed=折叠成一行（默认） / dim=灰色实时展示 / hide=隐藏 */
export type ThinkMode = 'collapsed' | 'dim' | 'hide';

export const THINK_MODES: ThinkMode[] = ['collapsed', 'dim', 'hide'];

export interface ThinkRendererSinks {
  /** 渲染给终端的文本：回答正文、灰色思考内容、折叠标记均经此输出 */
  out: (text: string) => void;
  /** 其中属于"回答正文"的部分，用于判断是否需要回退整体打印 */
  onAnswer?: (text: string) => void;
}

export interface ThinkRenderer {
  feed: (delta: string) => void;
  /** 流结束时调用：处理未闭合的思考段 */
  end: () => void;
}

const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

const gray = (s: string): string => `${GRAY}${s}${RESET}`;

/** 包一层 spinner 的通用助手：LLM / 工具之外的耗时操作（如收录资料）也可复用 */
export async function withSpinner<T>(enabled: boolean, text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = createSpinner(enabled);
  spinner.start(text);
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}

/**
 * <think> 状态机渲染器：容忍跨 delta 的半个标签。
 * - collapsed：思考期间不输出（spinner 继续转），关闭时打一行灰色折叠标记；
 * - dim：思考内容实时灰色输出，正文前后加标记行；
 * - hide：仅输出正文。
 */
export function makeThinkRenderer(mode: ThinkMode, sinks: ThinkRendererSinks): ThinkRenderer {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let hiding = false;
  let tail = '';
  let thinkChars = 0;

  // buf 末尾若恰好是 tag 的前缀（如 "<thi"），先扣住不处理，等下个 delta 拼上再判断
  const partialSuffixLen = (buf: string, tag: string): number => {
    const max = Math.min(tag.length - 1, buf.length);
    for (let len = max; len > 0; len--) {
      if (buf.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  };

  const emitAnswer = (text: string): void => {
    if (!text) return;
    sinks.out(text);
    sinks.onAnswer?.(text);
  };

  const closeThink = (unclosed: boolean): void => {
    if (mode === 'collapsed') {
      const state = unclosed ? '未闭合' : '已折叠';
      sinks.out(`${gray(`✻ 思考过程（${thinkChars} 字，${state}）`)}\n`);
    } else if (mode === 'dim') {
      sinks.out('\n');
    }
    // hide：不出声
  };

  return {
    feed(delta) {
      let buf = tail + delta;
      tail = '';
      for (;;) {
        if (hiding) {
          const end = buf.indexOf(CLOSE);
          if (end === -1) {
            const keep = partialSuffixLen(buf, CLOSE);
            const chunk = buf.slice(0, buf.length - keep);
            thinkChars += chunk.length;
            if (mode === 'dim') sinks.out(gray(chunk));
            tail = buf.slice(buf.length - keep);
            return;
          }
          const chunk = buf.slice(0, end);
          thinkChars += chunk.length;
          if (mode === 'dim' && chunk) sinks.out(`${gray(chunk)}\n`);
          buf = buf.slice(end + CLOSE.length);
          hiding = false;
          closeThink(false);
        } else {
          const start = buf.indexOf(OPEN);
          if (start === -1) {
            const keep = partialSuffixLen(buf, OPEN);
            emitAnswer(buf.slice(0, buf.length - keep));
            tail = buf.slice(buf.length - keep);
            return;
          }
          emitAnswer(buf.slice(0, start));
          buf = buf.slice(start + OPEN.length);
          hiding = true;
          thinkChars = 0;
          if (mode === 'dim') sinks.out(`${gray('· 思考 ·')}\n`);
        }
      }
    },
    end() {
      if (!hiding) return;
      if (mode === 'dim') sinks.out('\n');
      closeThink(true);
      hiding = false;
    },
  };
}

// ---------------------------------------------------------------------------
// 实时候选提示条（Claude Code 式：输入行下方一行灰色候选）
// ---------------------------------------------------------------------------

export interface HintBarOptions {
  /** 给出当前输入（至光标前）对应的候选列表 */
  getCandidates: (line: string) => string[];
  /** 当前提示词长度（用于计算光标列） */
  getPromptLength: () => number;
  /** 终端宽度（默认取 output.columns） */
  getColumns?: () => number;
  /** 输出流（默认 process.stdout，便于测试注入） */
  output?: NodeJS.WritableStream & { columns?: number; isTTY?: boolean };
}

export interface HintBar {
  /** 在提示词写出后调用，绘制/刷新提示行 */
  render(): void;
  /** 移除监听并清理 */
  detach(): void;
}

const MOVE_DOWN = '\x1b[1B';
const MOVE_UP = '\x1b[1A';
const CLEAR_LINE = '\x1b[2K';
const CLEAR_TAIL = '\x1b[0K';
const COL_START = '\r';
const toColumn = (col: number): string => `\x1b[${col + 1}G`;

/**
 * 在输入行下方渲染一行灰色候选提示。
 * 光标始终回到提示行上方的原位置，不干扰 readline 的行编辑。
 * 候选过多或终端过窄导致会换行时，自动截断或不渲染。
 */
export function attachHintBar(rl: readline.Interface, opts: HintBarOptions): HintBar {
  const out = opts.output ?? process.stdout;
  let drawn = false;
  let scheduled: ReturnType<typeof setImmediate> | null = null;
  let detached = false;

  const columns = (): number => {
    if (opts.getColumns) return opts.getColumns();
    return (out as { columns?: number }).columns ?? 80;
  };

  const restore = (col: number): void => {
    out.write(MOVE_UP + toColumn(col));
  };

  // 光标位于提示行上方时，整行擦除提示
  const erase = (col: number): void => {
    out.write(MOVE_DOWN + CLEAR_LINE + COL_START);
    restore(col);
    drawn = false;
  };

  const renderNow = (): void => {
    if (detached || !out.isTTY) return;
    const cols = columns();
    const col = opts.getPromptLength() + rl.cursor;
    const raw = opts.getCandidates(rl.line.slice(0, rl.cursor)).slice(0, 8).join('  ');
    const budget = cols - col - 2;
    const text = budget >= 8 ? (raw.length > budget ? `${raw.slice(0, budget - 1)}…` : raw) : '';
    if (!text) {
      if (drawn) erase(col);
      return;
    }
    const body = `${GRAY}${text}${RESET}`;
    if (drawn) {
      out.write(MOVE_DOWN + CLEAR_LINE + COL_START + body);
    } else {
      out.write(CLEAR_TAIL + COL_START + '\n' + body);
      drawn = true;
    }
    restore(col);
  };

  const onKeypress = (_ch: string, key?: readline.Key): void => {
    if (detached) return;
    // 回车后光标已落到下一行（原提示行位置），就地擦除，避免与下一条提示词重叠
    if (key && (key.name === 'enter' || key.name === 'return')) {
      if (drawn) {
        out.write(CLEAR_LINE + COL_START);
        drawn = false;
      }
      return;
    }
    if (scheduled === null) {
      scheduled = setImmediate(() => {
        scheduled = null;
        renderNow();
      });
    }
  };

  // Node ≥24 的新 readline 实现不再在 Interface 实例上转发 keypress，
  // 改为监听输入流本身（rl 内部已在输入流上 emit keypress）
  const input = (rl as unknown as { input?: NodeJS.ReadableStream }).input ?? process.stdin;
  input.on('keypress', onKeypress);

  return {
    render: renderNow,
    detach() {
      detached = true;
      if (scheduled !== null) {
        clearImmediate(scheduled);
        scheduled = null;
      }
      if (drawn) erase(opts.getPromptLength() + rl.cursor);
      (input as NodeJS.ReadableStream).removeListener('keypress', onKeypress);
      rl.removeListener?.('keypress', onKeypress);
    },
  };
}
