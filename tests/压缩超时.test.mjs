import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';
import * as plugin from '../dist/adapter.mjs';
import { harness, fakeService, textOf } from './压缩环境.mjs';

test('连接默认等待时间较短时，压缩遵守服务商配置，普通聊天保持原状', async () => {
  const previous = getGlobalDispatcher();
  const dispatcher = new Agent({ headersTimeout: 100, bodyTimeout: 100 });
  setGlobalDispatcher(dispatcher);
  const server = createServer(async (req, res) => {
    for await (const part of req) {}
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"index":0,"delta":{"content":"摘要完成"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(plugin, { providers: { renamed: {
      api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      headers: { Authorization: 'Bearer synthetic' }, timeoutMs: 5000,
      models: [{ id: 'Qwen3.8-27B', contextWindow: 114688, maxTokens: 16384 }],
    } } });
    const run = async purpose => {
      const chunks = [];
      for await (const chunk of ctx.llm.stream({ provider: 'renamed', model: 'Qwen3.8-27B', purpose,
        messages: [createUserMessage({ content: [{ type: 'text', text: '合成请求' }] })] })) chunks.push(chunk);
      return chunks;
    };
    assert.equal((await run('agent')).at(-1).reason.kind, 'error');
    const result = await run('compaction');
    assert.equal(result.at(-1).reason.kind, 'stop');
    assert.equal(getGlobalDispatcher(), dispatcher, '不得替换全局连接或代理');
  } finally {
    await ctx.fiber.dispose();
    setGlobalDispatcher(previous);
    await dispatcher.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('压缩响应持续拖延超过总时限后结束，不能写入半截摘要', async () => {
  const server = await fakeService();
  // 持续返回少量文本，检验总时限，不是无响应等待时限。
  server.state.mode = 'drip';
  const h = await harness({ profile: { ...server.profile, timeoutMs: 150 }, chars: 24000, auto: false });
  const before = textOf(h.agent.session);
  const outer = AbortSignal.timeout(2000);
  const started = Date.now();
  try {
    await assert.rejects(h.compact.compactNow(h.agent, outer));
    assert.ok(Date.now() - started < 1500, '应由插件总时限结束，不能依赖外部兜底');
    assert.equal(textOf(h.agent.session), before);
    assert.equal(h.agent.session.snapshotEvents().filter(e => e.type === 'compaction/summary').length, 0);
  } finally { await h.close(); await server.close(); }
});
