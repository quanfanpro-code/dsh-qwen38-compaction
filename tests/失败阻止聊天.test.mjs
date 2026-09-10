import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { harness, fakeService, textOf, QUESTION } from './压缩环境.mjs';

async function chat(h) {
  h.agent.followup(createUserMessage({ content: [{ type: 'text', text: QUESTION }], source: { kind: 'user' } }));
  await h.agent.whenIdle();
}

test('自动压缩失败不得向模型发送普通聊天', async () => {
  const server = await fakeService();
  const h = await harness({ profile: server.profile });
  try {
    server.state.mode = 'empty';
    const before = textOf(h.agent.session);
    await chat(h);
    assert.ok(h.agent.session.snapshotEvents().some(e => e.type === 'compaction/end' && e.data.error));
    assert.equal(server.state.requests.filter(r => !r.summary).length, 0, '压缩失败必须停止，不能继续普通聊天');
    assert.equal(textOf(h.agent.session), before);
    const end = h.agent.session.snapshotEvents().findLast(e => e.type === 'turn/end');
    assert.match(end.data.reason.error.message, /压缩.*失败/);
  } finally { await h.close(); await server.close(); }
});

test('手动失败和取消后，重开对话仍阻止聊天，压缩成功才恢复', async () => {
  const server = await fakeService();
  try {
    for (const mode of ['empty', 'wait']) {
      let h = await harness({ profile: server.profile, auto: false, chars: 24000 });
      try {
        server.state.mode = mode;
        await assert.rejects(h.compact.compactNow(h.agent, AbortSignal.timeout(mode === 'wait' ? 100 : 5000)));
        const seed = h.agent.session.snapshotEvents();
        await h.close();
        h = await harness({ profile: server.profile, auto: false, seed });
        server.state.mode = 'ok';
        const before = textOf(h.agent.session);
        const count = server.state.requests.length;
        await chat(h);
        assert.equal(server.state.requests.length, count, '重开不能绕过失败记录，也不能偷偷重试');
        assert.equal(textOf(h.agent.session), before);
        assert.ok(await h.compact.compactNow(h.agent, AbortSignal.timeout(5000)));
        await chat(h);
        assert.equal(server.state.requests.filter(r => !r.summary).length, mode === 'empty' ? 1 : 2);
      } finally { await h.close(); }
    }
  } finally { await server.close(); }
});
