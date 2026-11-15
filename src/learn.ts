import fs from 'node:fs';
import { DEFAULT_SYSTEM_PROMPT, socraticPrompt } from './agent/prompts.js';
import { slugify, uniqueDest } from './util.js';
import type { SessionState, WooyaConfig } from './types.js';

export function startLearn(session: SessionState, concept: string): string {
  session.mode = 'learn';
  session.learn = { concept, startedAt: new Date().toISOString(), transcript: [], toolTrace: [] };
  session.messages[0] = { role: 'system', content: socraticPrompt(concept) };
  return `进入苏格拉底问答模式（概念：${concept}）。agent 会持续提问，输入 /end 结束并存档，/clear 放弃且不存档。`;
}

function relatedSources(session: SessionState): string[] {
  const trace = session.learn?.toolTrace ?? [];
  return [
    ...new Set(
      trace
        .filter(t => t.name === 'read_source' && typeof t.args.path === 'string')
        .map(t => String(t.args.path).replace(/^sources\//, '')),
    ),
  ];
}

export function buildLearnArchive(cfg: WooyaConfig, session: SessionState): { content: string; dest: string } {
  const learn = session.learn!;
  const endedAt = new Date().toISOString();
  const sources = relatedSources(session);
  const dialogue = learn.transcript
    .map(e => `## ${e.speaker === 'agent' ? '导师' : '我'}\n\n${e.text}\n`)
    .join('\n');

  const frontmatter = [
    '---',
    `concept: ${JSON.stringify(learn.concept)}`,
    `startedAt: ${JSON.stringify(learn.startedAt)}`,
    `endedAt: ${JSON.stringify(endedAt)}`,
    sources.length
      ? `sources:\n${sources.map(s => `  - ${JSON.stringify(s)}`).join('\n')}`
      : 'sources: []',
    '---',
  ].join('\n');

  const content = `${frontmatter}\n\n# 学习问答：${learn.concept}\n\n> 用户回答均为原话，AI 未润色；「导师」部分为 AI 提问。\n\n${dialogue || '（本轮无问答内容）'}\n`;
  const dest = uniqueDest(cfg.outputsDir, `${endedAt.slice(0, 10)}-${slugify(learn.concept)}.md`);
  return { content, dest };
}

export function writeLearnArchive(cfg: WooyaConfig, dest: string, content: string): void {
  fs.mkdirSync(cfg.outputsDir, { recursive: true });
  fs.writeFileSync(dest, content);
}

export function finishLearn(session: SessionState): void {
  session.mode = 'default';
  session.learn = null;
  session.messages[0] = { role: 'system', content: DEFAULT_SYSTEM_PROMPT };
}
