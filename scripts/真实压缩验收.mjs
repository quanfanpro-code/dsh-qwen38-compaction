import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { harness, QUESTION, textOf } from '../tests/压缩环境.mjs';
import { MODEL } from '../src/适配策略.mjs';

// 只读本机配置。凭据只留在进程内，不写日志或验收文件。
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const settings = yaml.load(await readFile(join(dshHome, 'settings.yaml'), 'utf8'));
const profile = structuredClone(Object.values(settings['llm-pi-ai']?.providers ?? {}).find(p => p.models?.some(m => m.id === MODEL)));
assert.ok(profile, '未找到当前 Qwen 服务配置');
if (profile.apiKeyEnv) {
  const credentials = yaml.load(await readFile(join(dshHome, '.credentials.yaml'), 'utf8'));
  const key = process.env[profile.apiKeyEnv] || credentials.refs?.[profile.apiKeyEnv];
  assert.equal(typeof key, 'string', '凭据引用不可用');
  profile.headers = { ...profile.headers, Authorization: `Bearer ${key.trim()}` };
  delete profile.apiKeyEnv;
}
assert.ok(profile.models.some(model => model.id === MODEL));
const results = [];
for (const mode of ['自动', '手动']) {
  const h = await harness({ profile, chars: mode === '自动' ? 100000 : 24000, auto: mode === '自动' });
  const started = Date.now();
  const before = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
  console.log(`${mode}压缩开始：合成材料，压缩前估计 ${before} tokens。`);
  try {
    if (mode === '手动') assert.ok(await h.compact.compactNow(h.agent, AbortSignal.timeout(600000)));
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }));
    await h.agent.whenIdle();
    const events = h.agent.session.snapshotEvents();
    const summaries = events.filter(e => e.type === 'compaction/summary');
    assert.ok(summaries.length > 0, '未产生成功摘要，不能验收通过');
    const answer = events.filter(e => e.type === 'assistant/message').at(-1).data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const checks = { amount: /738[，,]?291/.test(answer), date: /2030.{0,3}12.{0,3}17/.test(answer),
      restriction: /邮件/.test(answer) && /不|禁止|勿/.test(answer), correction: /周宁/.test(answer), todo: /三|3/.test(answer) && /附件/.test(answer) };
    assert.ok(Object.values(checks).every(Boolean), `压缩后关键内容核对失败：${JSON.stringify(checks)}`);
    assert.match(textOf(h.agent.session), /738[，,]?291/);
    const after = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    assert.ok(after < before, '上下文未缩小');
    const result = { mode, before, after, elapsedMs: Date.now() - started, checks,
      summaries: summaries.map(e => ({ maxTokens: e.data.maxTokens, usage: e.data.usage })) };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally { await h.close(); }
}
await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
await writeFile(new URL('../.local/真实验收结果.json', import.meta.url), JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2));
console.log('真实 Qwen 服务验收通过：自动、手动、继续对话、五项事实核对。');
