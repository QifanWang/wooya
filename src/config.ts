import fs from 'node:fs';
import path from 'node:path';
import { entryDefaultModel, loadRegistry } from './providers.js';
import type { WooyaConfig } from './types.js';

const CONFIG_DIR = '.wooya';
const CONFIG_FILE = 'config.json';

interface FileConfig {
  provider?: string;
  sourcesDir?: string;
  outputsDir?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
}

export function findRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_DIR, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function initConfig(targetDir: string = process.cwd()): string {
  const root = path.resolve(targetDir);
  fs.mkdirSync(path.join(root, CONFIG_DIR), { recursive: true });
  fs.mkdirSync(path.join(root, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
  const file = path.join(root, CONFIG_DIR, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify({ sourcesDir: 'sources', outputsDir: 'outputs' }, null, 2) + '\n',
    );
  }
  return root;
}

export function loadConfig(startDir?: string): WooyaConfig {
  const root = findRoot(startDir);
  if (!root) {
    throw new Error('未找到 .wooya/config.json，请先在资料目录运行 `wooya init`');
  }
  let raw: FileConfig = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, CONFIG_DIR, CONFIG_FILE), 'utf8'));
  } catch {
    raw = {};
  }
  const registry = loadRegistry();
  const providerName = raw.provider ?? registry.active ?? null;
  const entry = providerName ? registry.providers[providerName] : undefined;

  const baseUrl = entry?.baseUrl ?? raw.baseUrl ?? 'https://api.openai.com/v1';
  const apiKey = entry?.apiKey ?? raw.apiKey ?? '';
  const model = raw.model ?? (entry ? entryDefaultModel(entry) : undefined) ?? 'gpt-4o-mini';
  const maxTokens = entry?.maxTokens ?? raw.maxTokens ?? 4096;
  const modelSource: WooyaConfig['modelSource'] = raw.model
    ? 'config'
    : entry && entryDefaultModel(entry)
      ? 'provider'
      : 'default';
  return {
    rootDir: root,
    sourcesDir: path.resolve(root, raw.sourcesDir ?? 'sources'),
    outputsDir: path.resolve(root, raw.outputsDir ?? 'outputs'),
    baseUrl,
    apiKey,
    model,
    maxTokens,
    modelSource,
    providerName: entry ? providerName : null,
  };
}

export function configFilePath(cfg: WooyaConfig): string {
  return path.join(cfg.rootDir, CONFIG_DIR, CONFIG_FILE);
}
