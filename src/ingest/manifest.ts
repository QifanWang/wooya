import fs from 'node:fs';
import path from 'node:path';
import type { SourceMeta, WooyaConfig } from '../types.js';

function manifestPath(cfg: WooyaConfig): string {
  return path.join(cfg.rootDir, '.wooya', 'manifest.json');
}

export function readManifest(cfg: WooyaConfig): SourceMeta[] {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(cfg), 'utf8')) as SourceMeta[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveManifest(cfg: WooyaConfig, list: SourceMeta[]): void {
  const file = manifestPath(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
}
