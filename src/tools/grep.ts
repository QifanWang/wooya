import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, WooyaConfig } from '../types.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.wooya']);
const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.cfg', '.ini',
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.rs', '.go', '.java', '.c', '.h',
  '.cpp', '.hpp', '.rb', '.php', '.html', '.css', '.rst', '.sh', '.sql',
]);
const MAX_HITS = 80;
const MAX_LINE_CHARS = 200;
const MAX_FILE_SIZE = 5_000_000;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function relPath(cfg: WooyaConfig, abs: string): string {
  return `sources/${path.relative(cfg.sourcesDir, abs).split(path.sep).join('/')}`;
}

function globToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

function parseRgOutput(stdout: string): Hit[] {
  const hits: Hit[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(.+?):(\d+):(.*)$/);
    if (m && hits.length < MAX_HITS) {
      hits.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, MAX_LINE_CHARS) });
    }
  }
  return hits;
}

function tryRipgrep(cfg: WooyaConfig, query: string, glob?: string): Hit[] | null {
  const args = ['-n', '-F', '-i', '-m', '50', '--no-heading', '--no-messages'];
  if (glob) args.push('--glob', glob);
  args.push('--', query, cfg.sourcesDir);
  const res = spawnSync('rg', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (res.error || (res.status !== 0 && res.status !== 1)) return null;
  return parseRgOutput(res.stdout);
}

function walkSearch(cfg: WooyaConfig, query: string, glob?: string): Hit[] {
  const hits: Hit[] = [];
  const needle = query.toLowerCase();
  const nameFilter = glob ? globToRegExp(glob) : null;

  const visit = (dir: string): void => {
    if (hits.length >= MAX_HITS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= MAX_HITS) return;
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (nameFilter && !nameFilter.test(entry.name)) continue;
      if (ext && !TEXT_EXT.has(ext)) continue;
      try {
        const stat = fs.statSync(abs);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = fs.readFileSync(abs, 'utf8');
        if (content.includes('\0')) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            hits.push({ file: relPath(cfg, abs), line: i + 1, text: lines[i].slice(0, MAX_LINE_CHARS) });
          }
        }
      } catch {
        continue;
      }
    }
  };

  visit(cfg.sourcesDir);
  return hits;
}

export function makeGrepTool(cfg: WooyaConfig): ToolDefinition {
  return {
    name: 'grep_search',
    description:
      '在资料库 sources/ 目录中按关键词检索（固定字符串、不区分大小写），返回 sources/<相对路径>:<行号>: 命中行。先用精确关键词，命中过多时换更具体的词或用 glob 限定文件类型。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要检索的关键词（固定字符串，不是正则）' },
        glob: { type: 'string', description: '可选，按文件名过滤，如 *.md' },
      },
      required: ['query'],
    },
    run: async args => {
      const query = String(args.query ?? '').trim();
      if (!query) throw new Error('缺少 query 参数');
      const glob = args.glob ? String(args.glob) : undefined;
      const hits = tryRipgrep(cfg, query, glob) ?? walkSearch(cfg, query, glob);
      if (!hits.length) return `未找到包含 "${query}" 的内容`;
      return hits.map(h => `${h.file}:${h.line}: ${h.text}`).join('\n');
    },
  };
}
