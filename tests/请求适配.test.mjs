import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm';

// 使用实际模型适配器和 HTTP 请求，防止“内存参数正确，发送时被 SDK 丢掉”。
const plugin = process.env.DSH_TEST_ORIGINAL === '1'
  ? await import('@deepseek-ai/dsh-llm-pi-ai')
  : await import('../dist/adapter.mjs');

test('真实请求：只对目标摘要关闭思考，普通聊天和其他目标不受污染', async () => {
  const received = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    received.set(body.messages.at(-1).content, body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '摘要完成' }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const ctx = new Context();
  try {
    await ctx.plugin(LlmRuntime);
    const profile = {
      api: 'openai-completions', baseURL: `http://127.0.0.1:${server.address().port}/v1`,
      headers: { Authorization: 'Bearer synthetic-test-key' },
      compat: { chatTemplateKwargs: { keep: 'kept', enable_thinking: true } },
      models: [{ id: 'Qwen3.8-27B', contextWindow: 114688, maxTokens: 16384 }, { id: 'other-model', contextWindow: 114688 }],
    };
    const adapterFiber = await ctx.plugin(plugin, { providers: { qwen38: profile, other: structuredClone(profile) } });
    const cases = [
      ['compact', 'qwen38', 'Qwen3.8-27B', 'compaction'],
      ['normal', 'qwen38', 'Qwen3.8-27B', 'agent'],
      ['provider', 'other', 'Qwen3.8-27B', 'compaction'],
      ['model', 'qwen38', 'other-model', 'compaction'],
    ];
    await Promise.all(cases.map(async ([id, provider, model, purpose]) => {
      const content = [];
      for await (const chunk of ctx.llm.stream({ provider, model, purpose, maxTokens: 16384,
        messages: [createUserMessage({ content: [{ type: 'text', text: id }] })] })) content.push(chunk);
      assert.equal(content.at(-1).reason.kind, 'stop');
    }));
    assert.equal(received.size, 4);
    assert.equal(received.get('compact').chat_template_kwargs?.enable_thinking, false);
    assert.equal(received.get('compact').chat_template_kwargs.keep, 'kept');
    for (const id of ['normal', 'provider', 'model']) {
      assert.notEqual(received.get(id).chat_template_kwargs?.enable_thinking, false, id);
    }
    for await (const chunk of ctx.llm.stream({ provider: 'qwen38', model: 'Qwen3.8-27B', purpose: 'agent',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'after' }] })] })) {}
    assert.deepEqual(received.get('after').chat_template_kwargs, received.get('normal').chat_template_kwargs);
    await adapterFiber.dispose();
    await ctx.plugin(await import('@deepseek-ai/dsh-llm-pi-ai'), { providers: { qwen38: profile } });
    for await (const chunk of ctx.llm.stream({ provider: 'qwen38', model: 'Qwen3.8-27B', purpose: 'compaction',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'disabled' }] })] })) {}
    assert.notEqual(received.get('disabled').chat_template_kwargs?.enable_thinking, false, '停用插件后恢复原生行为');
  } finally {
    await ctx.fiber.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
