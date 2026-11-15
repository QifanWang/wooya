import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProviderEntry {
  baseUrl: string;
  apiKey: string;
  /** 该 endpoint 提供的模型清单（由 /provider 维护） */
  models?: string[];
  defaultModel?: string;
  maxTokens?: number;
  /** 旧版单模型字段：读取时兼容，写回时迁移为 models + defaultModel */
  model?: string;
}

export interface ProviderRegistry {
  providers: Record<string, ProviderEntry>;
  active?: string;
}

export function entryModels(entry: ProviderEntry): string[] {
  if (entry.models?.length) return entry.models;
  return entry.model ? [entry.model] : [];
}

export function entryDefaultModel(entry: ProviderEntry): string | undefined {
  return entry.defaultModel ?? entry.model ?? entryModels(entry)[0];
}

export function registryFilePath(): string {
  return path.join(os.homedir(), '.wooya', 'providers.json');
}

export function loadRegistry(): ProviderRegistry {
  try {
    const raw = JSON.parse(fs.readFileSync(registryFilePath(), 'utf8')) as ProviderRegistry;
    if (raw && typeof raw.providers === 'object' && raw.providers !== null) {
      return { providers: raw.providers, active: raw.active };
    }
  } catch {
    // 文件不存在或损坏时从空注册表开始
  }
  return { providers: {} };
}

export function saveRegistry(reg: ProviderRegistry): void {
  const file = registryFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
}
