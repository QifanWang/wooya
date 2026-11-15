#!/usr/bin/env node
import * as readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { configFilePath, initConfig, loadConfig } from './config.js';
import { entryDefaultModel, entryModels, loadRegistry, saveRegistry } from './providers.js';
import { buildTools } from './tools/index.js';
import { newSession, runAgentTurn } from './agent/loop.js';
import { DEFAULT_SYSTEM_PROMPT } from './agent/prompts.js';
import { addSource } from './ingest/index.js';
import { readManifest } from './ingest/manifest.js';
import { buildLearnArchive, finishLearn, startLearn, writeLearnArchive } from './learn.js';
import type { SessionState, WooyaConfig } from './types.js';

const HELP = `Wooya — 本地学习资料 agent

用法：
  wooya init [目录]        初始化资料目录（sources/、outputs/、.wooya/config.json）
  wooya add <目标>         收录网页 / GitHub 仓库 / 本地文件
  wooya ask "<问题>"       单发提问（双轨回答）
  wooya                    进入交互会话
  --verbose                输出运行日志到终端

会话内命令：
  /add <目标>       收录资料
  /sources          列出已收录资料
  /provider         查看 / 登记 / 切换 API provider
                    （add <name> <base-url> | use <name> [--save] |
                      model <name> add|remove|default <model-id> | remove <name>）
  /model [<id>] [--save]
                    查看当前 provider 的模型列表并切换；--save 写入 .wooya/config.json 作为默认
  /learn <概念>     进入苏格拉底问答
  /end              结束当前学习问答并存档
  /clear            清空会话
  /help             查看命令
  /exit             退出

配置：
  API provider 通过 /provider 登记（key 存 ~/.wooya/providers.json），
  模型通过 /model 切换；数据目录 .wooya/config.json 可绑定 provider 与默认模型`;

function handleSlash(
  cfg: WooyaConfig,
  session: SessionState,
  line: string,
  tools: ReturnType<typeof buildTools>,
  ask: (q: string) => Promise<string>,
): Promise<'handled' | 'exit' | 'unhandled'> {
  return (async () => {
    if (line === '/exit' || line === '/quit') return 'exit';
    if (line === '/help') { console.log(HELP); return 'handled'; }
    if (line === '/clear') {
      session.messages = [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }];
      session.mode = 'default';
      session.learn = null;
      console.log('会话已清空。');
      return 'handled';
    }
    if (line === '/sources') {
      const listTool = tools.find(t => t.name === 'list_sources');
      console.log(listTool ? await listTool.run({}) : '工具不可用');
      return 'handled';
    }
    if (line === '/provider') {
      const reg = loadRegistry();
      const names = Object.keys(reg.providers);
      if (!names.length) {
        console.log('尚未登记任何 provider。用法：/provider add <name> <base-url>');
        return 'handled';
      }
      for (const n of names) {
        const e = reg.providers[n];
        const mark = n === cfg.providerName ? '*' : ' ';
        const dm = entryDefaultModel(e);
        const count = entryModels(e).length;
        const desc = [dm ? `默认模型 ${dm}` : '', count > 1 ? `${count} 个模型` : ''].filter(Boolean).join('，');
        console.log(`${mark} ${n}  ${e.baseUrl}${desc ? `  ${desc}` : ''}`);
      }
      console.log(`\n当前生效：${cfg.providerName ?? '（无，使用内置默认）'}；切换：/provider use <name> [--save]`);
      return 'handled';
    }
    if (line.startsWith('/provider add')) {
      const parts = line.slice(13).trim().split(/\s+/).filter(Boolean);
      const [name, baseUrl] = parts;
      if (!name || !baseUrl || !/^https?:\/\//i.test(baseUrl)) {
        console.log('用法：/provider add <name> <base-url>');
        return 'handled';
      }
      const key = (await ask('API key: ')).trim();
      if (!key) { console.log('已取消：key 不能为空。'); return 'handled'; }
      const modelsRaw = (await ask('模型列表（逗号分隔，可回车跳过）: ')).trim();
      const models = modelsRaw ? modelsRaw.split(/[,，;；]/).map(s => s.trim()).filter(Boolean) : [];
      let defaultModel: string | undefined;
      if (models.length) {
        defaultModel = (await ask(`默认模型（回车取 ${models[0]}）: `)).trim() || models[0];
        if (!models.includes(defaultModel)) models.unshift(defaultModel);
      }
      const reg = loadRegistry();
      const wasEmpty = Object.keys(reg.providers).length === 0;
      reg.providers[name] = {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey: key,
        ...(models.length ? { models, defaultModel } : {}),
      };
      if (wasEmpty || !reg.active) reg.active = name;
      saveRegistry(reg);
      console.log(`已登记 provider：${name}${reg.active === name ? '（已设为全局默认）' : ''}`);
      if (reg.active === name && !cfg.providerName) {
        cfg.providerName = name;
        cfg.baseUrl = reg.providers[name].baseUrl;
        cfg.apiKey = key;
        if (defaultModel) { cfg.model = defaultModel; cfg.modelSource = 'provider'; }
        console.log('已同时应用到当前会话。');
      }
      return 'handled';
    }
    if (line.startsWith('/provider model')) {
      const parts = line.slice(15).trim().split(/\s+/).filter(Boolean);
      const [name, op, id] = parts;
      if (!name || !op || !id || !['add', 'remove', 'default'].includes(op)) {
        console.log('用法：/provider model <name> add|remove|default <model-id>');
        return 'handled';
      }
      const reg = loadRegistry();
      const entry = reg.providers[name];
      if (!entry) { console.log(`未登记的 provider：${name}`); return 'handled'; }
      const models = entryModels(entry);
      if (op === 'add') {
        if (models.includes(id)) { console.log(`${id} 已在列表中。`); return 'handled'; }
        models.push(id);
        console.log(`已添加模型：${id}`);
      } else if (op === 'remove') {
        if (!models.includes(id)) { console.log(`${id} 不在列表中。`); return 'handled'; }
        models.splice(models.indexOf(id), 1);
        console.log(`已移除模型：${id}`);
      } else {
        if (!models.includes(id)) models.push(id);
        entry.defaultModel = id;
        console.log(`已设为默认模型：${id}`);
      }
      delete entry.model;
      if (models.length) entry.models = models; else delete entry.models;
      if (entry.defaultModel && !models.includes(entry.defaultModel)) entry.defaultModel = models[0];
      if (!entry.defaultModel && models.length) entry.defaultModel = models[0];
      saveRegistry(reg);
      if (cfg.providerName === name) {
        if (op === 'default') { cfg.model = id; cfg.modelSource = 'provider'; }
        if (op === 'remove' && cfg.model === id) {
          cfg.model = entryDefaultModel(entry) ?? cfg.model;
          console.log(`当前会话模型已随之切换为：${cfg.model}`);
        }
      }
      return 'handled';
    }
    if (line.startsWith('/provider use')) {
      const parts = line.slice(14).trim().split(/\s+/).filter(Boolean);
      const name = parts.find(p => p !== '--save');
      const save = parts.includes('--save');
      if (!name) { console.log('用法：/provider use <name> [--save]'); return 'handled'; }
      const reg = loadRegistry();
      const entry = reg.providers[name];
      if (!entry) { console.log(`未登记的 provider：${name}（先用 /provider add 登记）`); return 'handled'; }
      cfg.providerName = name;
      cfg.baseUrl = entry.baseUrl;
      cfg.apiKey = entry.apiKey;
      const dm = entryDefaultModel(entry);
      cfg.model = dm ?? 'gpt-4o-mini';
      cfg.modelSource = dm ? 'provider' : 'default';
      if (save) {
        reg.active = name;
        saveRegistry(reg);
        const file = configFilePath(cfg);
        let raw: Record<string, unknown> = {};
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { raw = {}; }
        raw.provider = name;
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
        console.log(`已切换并绑定：全局默认 → ${name}，本资料库 → ${name}（写入 .wooya/config.json）`);
      } else {
        console.log(`当前会话已切换到 ${name}（--save 可保存为默认）`);
      }
      return 'handled';
    }
    if (line.startsWith('/provider remove')) {
      const name = line.slice(17).trim();
      if (!name) { console.log('用法：/provider remove <name>'); return 'handled'; }
      const reg = loadRegistry();
      if (!reg.providers[name]) { console.log(`未登记的 provider：${name}`); return 'handled'; }
      if (reg.active === name) { console.log(`${name} 是全局默认 provider，先用 /provider use <其他> 再删除。`); return 'handled'; }
      delete reg.providers[name];
      saveRegistry(reg);
      console.log(`已删除 provider：${name}`);
      return 'handled';
    }
    if (line.startsWith('/provider')) {
      console.log('用法：/provider | /provider add <name> <base-url> | /provider use <name> [--save]');
      console.log('      /provider model <name> add|remove|default <model-id> | /provider remove <name>');
      return 'handled';
    }
    if (line === '/model') {
      console.log(`当前模型：${cfg.model}（来源：${cfg.modelSource}）`);
      const reg = loadRegistry();
      const entry = cfg.providerName ? reg.providers[cfg.providerName] : undefined;
      if (entry) {
        const models = entryModels(entry);
        const dm = entryDefaultModel(entry);
        if (models.length) {
          console.log(`${cfg.providerName} 可用模型：`);
          for (const m of models) {
            const cur = m === cfg.model ? '*' : ' ';
            const def = m === dm ? '（默认）' : '';
            console.log(`${cur} ${m}${def}`);
          }
        } else {
          console.log(`（${cfg.providerName} 未登记模型列表，可用 /provider model ${cfg.providerName} add <id> 维护）`);
        }
      }
      console.log('切换：/model <model-id> [--save]');
      return 'handled';
    }
    if (line.startsWith('/model')) {
      const parts = line.slice(6).trim().split(/\s+/).filter(Boolean);
      const save = parts.includes('--save');
      const modelId = parts.filter(p => p !== '--save').join(' ').trim();
      if (!modelId) { console.log('用法：/model <model-id> [--save]'); return 'handled'; }
      const prevSource = cfg.modelSource;
      cfg.model = modelId;
      cfg.modelSource = save ? 'config' : 'session';
      if (cfg.providerName) {
        const reg = loadRegistry();
        const entry = reg.providers[cfg.providerName];
        const models = entry ? entryModels(entry) : [];
        if (models.length && !models.includes(modelId)) {
          console.log(`提示：${modelId} 不在 ${cfg.providerName} 的模型列表中，可用 /provider model ${cfg.providerName} add ${modelId} 登记`);
        }
      }
      if (save) {
        const file = configFilePath(cfg);
        let raw: Record<string, unknown> = {};
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { raw = {}; }
        raw.model = modelId;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
        const note = prevSource === 'config' ? '' : '（数据目录配置将优先于 provider 默认模型）';
        console.log(`已切换并保存默认模型：${modelId}${note}`);
      } else {
        console.log(`已切换当前会话模型：${modelId}（--save 可保存为默认）`);
      }
      return 'handled';
    }
    if (line.startsWith('/add')) {
      const target = line.slice(4).trim();
      if (!target) { console.log('用法：/add <url|repo|file>'); return 'handled'; }
      try { console.log(await addSource(cfg, target)); }
      catch (err) { console.log(`收录失败：${err instanceof Error ? err.message : String(err)}`); }
      return 'handled';
    }
    if (line.startsWith('/learn')) {
      const concept = line.slice(6).trim();
      if (!concept) { console.log('用法：/learn <概念>'); return 'handled'; }
      if (session.mode === 'learn') { console.log('已在学习问答中，先 /end 结束当前问答。'); return 'handled'; }
      console.log(startLearn(session, concept));
      return 'handled';
    }
    if (line === '/end') {
      if (session.mode !== 'learn' || !session.learn) { console.log('当前不在学习问答模式。'); return 'handled'; }
      const { content, dest } = buildLearnArchive(cfg, session);
      console.log('\n以下内容将存档：\n');
      console.log(content);
      const ok = await ask('确认写入？(y/N) ');
      if (ok.trim().toLowerCase() === 'y') {
        writeLearnArchive(cfg, dest, content);
        console.log(`已存档：${dest}`);
      } else {
        console.log('已取消存档。');
      }
      finishLearn(session);
      return 'handled';
    }
    return 'unhandled';
  })();
}

async function repl(cfg: WooyaConfig, verbose: boolean): Promise<void> {
  const tools = buildTools(cfg);
  const session = newSession(DEFAULT_SYSTEM_PROMPT);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  const lineQueue: string[] = [];
  let notify: (() => void) | null = null;
  rl.on('line', l => {
    lineQueue.push(l);
    notify?.();
    notify = null;
  });
  rl.on('close', () => {
    closed = true;
    notify?.();
    notify = null;
  });
  const ask = (q: string): Promise<string> =>
    new Promise(res => {
      if (lineQueue.length > 0) {
        res(lineQueue.shift()!);
        return;
      }
      if (closed) {
        res('');
        return;
      }
      notify = () => res(lineQueue.length > 0 ? lineQueue.shift()! : '');
      process.stdout.write(q);
    });
  const showPrompt = () => ask(session.mode === 'learn' ? 'learn> ' : 'wooya> ');

  console.log(`Wooya 已就绪 · 资料库 ${cfg.sourcesDir} · 模型 ${cfg.model}`);
  if (!cfg.apiKey) console.log('提示：尚未配置 API key，请先运行 /provider add <name> <base-url> 登记并启用 provider。');
  console.log('输入 /help 查看命令，/exit 退出。\n');

  for (;;) {
    const line = (await showPrompt()).trim();
    if (closed) break;
    if (!line) continue;
    const slash = await handleSlash(cfg, session, line, tools, ask);
    if (slash === 'exit') break;
    if (slash === 'handled') continue;
    try {
      const answer = await runAgentTurn(cfg, session, tools, line, verbose);
      console.log(`\n${answer}\n`);
      session.learn?.transcript.push(
        { speaker: 'user', text: line },
        { speaker: 'agent', text: answer },
      );
    } catch (err) {
      console.log(`出错：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  rl.close();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose') || argv.includes('-v');
  const args = argv.filter(a => a !== '--verbose' && a !== '-v');
  const cmd = args[0];

  if (!cmd || cmd === 'repl') {
    await repl(loadConfig(), verbose);
    return;
  }
  if (cmd === 'init') {
    const root = initConfig(args[1]);
    console.log(`已在 ${root} 初始化资料目录（sources/、outputs/、.wooya/config.json）。`);
    return;
  }
  if (cmd === 'ask') {
    const question = args.slice(1).join(' ').trim();
    if (!question) { console.error('用法：wooya ask "<问题>"'); process.exitCode = 1; return; }
    const cfg = loadConfig();
    const session = newSession(DEFAULT_SYSTEM_PROMPT);
    console.log(await runAgentTurn(cfg, session, buildTools(cfg), question, verbose));
    return;
  }
  if (cmd === 'add') {
    const target = args[1];
    if (!target) { console.error('用法：wooya add <url|repo|file>'); process.exitCode = 1; return; }
    console.log(await addSource(loadConfig(), target));
    return;
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  console.error(`未知命令：${cmd}\n\n${HELP}`);
  process.exitCode = 1;
}

main().catch(err => {
  console.error(`出错：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
