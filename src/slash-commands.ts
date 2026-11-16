import * as readline from 'node:readline';
import { entryModels, loadRegistry } from './providers.js';
import type { WooyaConfig } from './types.js';

export const TOP_COMMANDS = ['/add', '/sources', '/provider', '/model', '/learn', '/end', '/think', '/clear', '/help', '/exit'];
const PROVIDER_OPS = ['add', 'use', 'model', 'remove'];
const PROVIDER_MODEL_OPS = ['add', 'remove', 'default'];
const THINK_MODE_CHOICES = ['collapsed', 'dim', 'hide'];

/** 按输入位置给出候选：顶层命令 / 子命令 / provider 名 / 模型 id / think 模式（空输入 → 顶层命令） */
export function commandCandidates(cfg: WooyaConfig, line: string): string[] {
  const providerNames = (): string[] => Object.keys(loadRegistry().providers).sort();
  const endsSpace = /\s$/.test(line);
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const pos = endsSpace ? tokens.length : tokens.length - 1;
  const arg = (i: number): string => tokens[i] ?? '';
  if (tokens.length === 0) return TOP_COMMANDS;
  // 正在输入第一个 token（如 "/p"、"/prov"）：对顶层命令做前缀匹配
  if (pos === 0) return TOP_COMMANDS.filter(c => c.startsWith(arg(0)));
  if (arg(0) === '/provider') {
    if (pos === 1) return PROVIDER_OPS;
    if (arg(1) === 'model') {
      if (pos === 2) return providerNames();
      if (pos === 3) return PROVIDER_MODEL_OPS;
      return [];
    }
    if (pos === 2) return providerNames();
    if (pos === 3 && arg(1) === 'use') return ['--save'];
    return [];
  }
  if (arg(0) === '/model' && pos === 1) {
    const reg = loadRegistry();
    const entry = cfg.providerName ? reg.providers[cfg.providerName] : undefined;
    return entry ? [...entryModels(entry), '--save'] : ['--save'];
  }
  if (arg(0) === '/think' && pos === 1) return THINK_MODE_CHOICES;
  return [];
}

/** 会话内命令 Tab 补全（Node ≥24 多候选需双击 Tab 才列出，实时提示由提示条负责） */
export function makeCompleter(cfg: WooyaConfig): readline.Completer {
  return line => {
    if (!line.startsWith('/')) return [[], line];
    const endsSpace = /\s$/.test(line);
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const word = endsSpace ? '' : tokens[tokens.length - 1] ?? '';
    const hits = commandCandidates(cfg, line).filter(c => c.startsWith(word) && c !== word);
    return [hits, word];
  };
}
