import { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import yaml from 'js-yaml';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import { BasicCompactionEngine } from '../dist/compaction.mjs';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm';
import * as plugin from '../dist/adapter.mjs';
import { MODEL } from '../src/适配策略.mjs';

export const FACTS = '任务：整理虚构项目晨星的清单；金额为 738291 元；交付日期为 2030-12-17；不要发送邮件；纠正：联系人是周宁，不是张伟；待办：核对三份附件。';
export const QUESTION = '请复述晨星项目的金额、交付日期、禁止事项、纠正后的联系人和待办。不要使用工具。';
export const textOf = session => session.deriveMessages().map(m => m.content.filter(b => b.type === 'text').map(b => b.text).join('')).join('\n');

export async function standardPolicy() {
  const source = await readFile(new URL('../dist/presets/standard/agent.cordis.yml', import.meta.url), 'utf8');
  const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: text => ({ expression: text }) }));
  const rows = yaml.load(source, { schema });
  const row = rows.find(r => r.id === 'compaction').config.find(r => r.id === 'compaction-basic');
  if (row.name !== 'dsh-qwen38-compaction/compaction') throw new Error('标准模式未加载插件压缩组件');
  return structuredClone(row.config ?? {});
}

export function seedHistory(chars = 12000, provider = 'renamed-provider', model = MODEL) {
  const session = Session.create(SessionId(`seed-${randomUUID()}`));
  for (let turn = 1; turn <= 4; turn++) {
    session.append('turn/start', { turn });
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `${turn === 1 ? FACTS : '沿用先前任务，无新事实。'}\n以下仅为合成填充，无新事实：\n${'Synthetic filler record. No new facts. '.repeat(Math.ceil(chars / 38))}` }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    session.append('step/start', { turn, step: 1 });
    if (turn === 1) session.append('request/header', { header: { config: { provider, model, maxTokens: 16384 } }, reason: 'initial' });
    session.append('assistant/message', { stream: [], turn, step: 1, message: createAssistantMessage({ content: [{ type: 'text', text: '已记录，无其他变更。' }], source: { provider, model } }) }, { surfaceOp: 'append' });
    session.append('step/end', { turn, step: 1 });
    session.append('turn/end', { turn, reason: { kind: 'completed' } });
  }
  return session.snapshotEvents();
}

export async function harness({ profile, chars = 100000, auto = true, provider = 'renamed-provider', model = MODEL } = {}) {
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(TokenMeter);
  await ctx.plugin(plugin, { providers: { [provider]: profile } });
  const policy = await standardPolicy();
  const compact = new BasicCompactionEngine(ctx, { ...policy, auto });
  const handle = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId(`acceptance-${randomUUID()}`), seed: seedHistory(chars, provider, model), agentOptions: { provider, model, maxTokens: 1024 } });
  return { ctx, agent: handle.agent, compact, close: () => ctx.fiber.dispose() };
}

export async function fakeService() {
  const state = { mode: 'ok', requests: [] };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const summary = JSON.stringify(body.messages.at(-1)).includes('acting as a compaction engine');
    state.requests.push({ summary, body });
    if (summary && state.mode === 'wait') return;
    if (summary && state.mode === 'error') { res.writeHead(503); res.end('synthetic failure'); return; }
    const text = summary && state.mode === 'empty' ? '' : FACTS;
    const reason = summary && state.mode === 'truncate' ? 'length' : 'stop';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: reason }], usage: { prompt_tokens: Math.ceil(JSON.stringify(body.messages).length / 4), completion_tokens: 80, total_tokens: Math.ceil(JSON.stringify(body.messages).length / 4) + 80 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, profile: { api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    headers: { Authorization: 'Bearer synthetic-test-key' }, timeoutMs: 5000,
    models: [{ id: MODEL, contextWindow: 114688, maxTokens: 16384 }] },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
