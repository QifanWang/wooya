import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, WooyaConfig } from '../types.js';

const DEFAULT_MAX_LINES = 200;
const MAX_LINE_CHARS = 500;

function resolveInside(cfg: WooyaConfig, relPath: string): string {
  const root = path.resolve(cfg.sourcesDir);
  const abs = path.resolve(root, relPath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越出资料库范围');
  }
  return abs;
}

export function makeReadSourceTool(cfg: WooyaConfig): ToolDefinition {
  return {
    name: 'read_source',
    description:
      '读取资料库中某文件指定行范围的内容（输出带行号）。path 相对于 sources/，或使用 grep_search 返回的 sources/... 路径。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件相对路径，如 docs/spec.md' },
        startLine: { type: 'number', description: '起始行号，从 1 开始，默认 1' },
        endLine: { type: 'number', description: '结束行号（含），默认 startLine + 200' },
      },
      required: ['path'],
    },
    run: async args => {
      const raw = String(args.path ?? '').trim();
      if (!raw) throw new Error('缺少 path 参数');
      const relPath = raw.replace(/^sources\//, '').replace(/^sources[\\/]/, '');
      const abs = resolveInside(cfg, relPath);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        throw new Error(`文件不存在：sources/${relPath}`);
      }
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      const start = Math.max(1, Math.floor(Number(args.startLine ?? 1)) || 1);
      const end = Math.min(
        lines.length,
        Math.floor(Number(args.endLine ?? start + DEFAULT_MAX_LINES - 1)) || start + DEFAULT_MAX_LINES - 1,
      );
      const out: string[] = [];
      for (let i = start; i <= end; i++) {
        out.push(`${i}: ${(lines[i - 1] ?? '').slice(0, MAX_LINE_CHARS)}`);
      }
      if (end < lines.length) {
        out.push(`…（共 ${lines.length} 行，可用 startLine/endLine 继续读取）`);
      }
      return out.join('\n') || '（空文件）';
    },
  };
}
