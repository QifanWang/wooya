import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { htmlToMarkdown, extractTitle } from './html.js';
import { readManifest, saveManifest } from './manifest.js';
import { slugify, uniqueDest } from '../util.js';
import type { SourceMeta, WooyaConfig } from '../types.js';

const execFileP = promisify(execFile);

const REPO_PATTERN = /github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

type SourceKind = 'file' | 'repo' | 'url';

export function detectKind(target: string): SourceKind {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return 'file';
  if (REPO_PATTERN.test(target)) return 'repo';
  if (/^https?:\/\//i.test(target)) return 'url';
  throw new Error(`无法识别目标：${target}（支持：本地文件路径、GitHub 仓库 URL、网页 URL）`);
}

// 异步执行：git clone 可能长达数分钟，同步 spawn 会阻塞事件循环，令 spinner 停摆
async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = ((e.stderr || '') + (e.stdout || '')).trim().slice(0, 300) || e.message || String(err);
    throw new Error(`git ${args[0]} 失败：${detail}`);
  }
}

function toRel(cfg: WooyaConfig, abs: string): string {
  return path.relative(cfg.sourcesDir, abs).split(path.sep).join('/');
}

export async function addSource(cfg: WooyaConfig, rawTarget: string): Promise<string> {
  const target = rawTarget.trim();
  const kind = detectKind(target);
  const origin = kind === 'file' ? path.resolve(target) : target;
  const manifest = readManifest(cfg);
  const dup = manifest.find(s => s.origin === origin);
  if (dup) {
    return `该来源已收录：${dup.id}（收录时间 ${dup.ingestedAt}），未重复收录。`;
  }

  fs.mkdirSync(cfg.sourcesDir, { recursive: true });
  const now = new Date().toISOString();
  let meta: SourceMeta;

  if (kind === 'file') {
    const abs = origin;
    const dest = uniqueDest(cfg.sourcesDir, path.basename(abs));
    fs.copyFileSync(abs, dest);
    meta = {
      id: slugify(path.basename(abs, path.extname(abs))),
      type: 'file',
      origin: abs,
      title: path.basename(abs),
      ingestedAt: now,
      path: toRel(cfg, dest),
    };
  } else if (kind === 'repo') {
    const m = target.match(REPO_PATTERN)!;
    const repoName = `${m[1]}-${m[2]}`;
    const slug = slugify(repoName);
    const dest = path.join(cfg.sourcesDir, slug);
    if (fs.existsSync(dest)) {
      throw new Error(`目录已存在：sources/${slug}，请先处理冲突`);
    }
    await git(['clone', '--depth', '1', target, dest]);
    const sha = await git(['rev-parse', 'HEAD'], dest);
    meta = { id: slug, type: 'repo', origin: target, title: repoName, ingestedAt: now, sha, path: slug };
  } else {
    const res = await fetch(target, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
    const html = await res.text();
    const title = extractTitle(html) ?? target;
    const dest = uniqueDest(cfg.sourcesDir, `${slugify(title)}.md`);
    fs.writeFileSync(
      dest,
      `# ${title}\n\n` +
        `> 来源：${target}\n` +
        `> 收录时间：${now}\n` +
        `> 注：正文由 HTML 简易转换，格式可能不完整。\n\n` +
        `${htmlToMarkdown(html)}\n`,
    );
    meta = { id: slugify(title), type: 'url', origin: target, title, ingestedAt: now, path: toRel(cfg, dest) };
  }

  manifest.push(meta);
  saveManifest(cfg, manifest);
  const shaLine = meta.sha ? `\ncommit SHA：${meta.sha}` : '';
  return `已收录 [${meta.type}] ${meta.title}\n位置：sources/${meta.path}${shaLine}`;
}
