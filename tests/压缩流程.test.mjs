import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { harness, fakeService, textOf, QUESTION } from './压缩环境.mjs';

test('实际原生循环：自动压缩和继续对话使用插件策略', async () => {
  const server = await fakeService();
  const h = await harness({ profile: server.profile, baselineBudget: process.env.DSH_TEST_ORIGINAL_BUDGET === '1' });
  try {
    const before = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }));
    await h.agent.whenIdle();
    const summaries = h.agent.session.snapshotEvents().filter(e => e.type === 'compaction/summary');
    assert.ok(summaries.length >= 1, '必须由真实循环自动触发，不能直接调用 compactIfNeeded 冒充自动');
    assert.equal(summaries[0].data.maxTokens, 16384);
    const outgoing = server.state.requests.find(r => r.summary).body;
    assert.equal(outgoing.chat_template_kwargs.enable_thinking, false);
    assert.equal(outgoing.max_tokens ?? outgoing.max_completion_tokens, 16384);
    assert.ok(h.ctx.tokenMeter.measure(h.agent.session).totalTokens < before);
    const continuation = server.state.requests.find(r => !r.summary).body;
    assert.match(JSON.stringify(continuation.messages), /738291/);
    assert.match(textOf(h.agent.session), /周宁/);
  } finally { await h.close(); await server.close(); }
});

test('原生手动压缩及失败保护：空摘要、截断、服务错误、取消均保留历史', async () => {
  const server = await fakeService();
  try {
    for (const mode of ['ok', 'empty', 'truncate', 'error', 'wait']) {
      const h = await harness({ profile: server.profile, auto: false });
      const before = textOf(h.agent.session);
      const controller = new AbortController();
      server.state.mode = mode;
      const timer = mode === 'wait' ? setTimeout(() => controller.abort(new Error('合成取消测试')), 100) : undefined;
      try {
        if (mode === 'ok') {
          const result = await h.compact.compactNow(h.agent, controller.signal);
          assert.ok(result);
          assert.match(textOf(h.agent.session), /738291/);
          assert.ok(textOf(h.agent.session).length < before.length);
        } else {
          await assert.rejects(h.compact.compactNow(h.agent, controller.signal));
          assert.equal(textOf(h.agent.session), before, `${mode} 不得替换原历史`);
          assert.equal(h.agent.session.snapshotEvents().filter(e => e.type === 'compaction/summary').length, 0);
        }
      } finally { clearTimeout(timer); await h.close(); }
    }
  } finally { await server.close(); }
});
