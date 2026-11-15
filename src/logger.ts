import fs from 'node:fs';
import path from 'node:path';
import type { WooyaConfig } from './types.js';

export interface LogEntry {
  kind: string;
  [key: string]: unknown;
}

export function logEvent(cfg: WooyaConfig, verbose: boolean, entry: LogEntry): void {
  const line = JSON.stringify({ time: new Date().toISOString(), ...entry });
  try {
    fs.appendFileSync(path.join(cfg.rootDir, '.wooya', 'agent.log'), line + '\n');
  } catch {
    // 日志失败不影响主流程
  }
  if (verbose) console.error(`[wooya] ${line}`);
}
