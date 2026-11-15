import { readManifest } from '../ingest/manifest.js';
import type { ToolDefinition, WooyaConfig } from '../types.js';

export function makeListSourcesTool(cfg: WooyaConfig): ToolDefinition {
  return {
    name: 'list_sources',
    description: '列出资料库中已收录的全部资料及其元数据（类型、来源、路径、收录时间）。',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const list = readManifest(cfg);
      if (!list.length) return '资料库为空，尚无任何收录资料。';
      return list
        .map(
          s =>
            `- ${s.id} [${s.type}] ${s.title}\n` +
            `  来源: ${s.origin}${s.sha ? `（SHA ${s.sha.slice(0, 10)}）` : ''}\n` +
            `  路径: sources/${s.path}\n` +
            `  收录: ${s.ingestedAt}`,
        )
        .join('\n');
    },
  };
}
