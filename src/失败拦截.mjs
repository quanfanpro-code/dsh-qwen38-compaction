// 直接使用已有会话记录，失败状态随会话恢复，不另存一份锁。
export function assertCompactionSucceeded(session) {
  for (let seq = session.seq - 1; seq >= 0; seq--) {
    const event = session.eventAt(seq);
    if (event.type === 'compaction/end') {
      if (event.data.error !== undefined) throw new Error('上次上下文压缩失败，已停止对话。请先用 /compact 重新压缩，成功后再继续。');
      return;
    }
    if (event.type === 'compaction/start') {
      throw new Error('上次上下文压缩未完成，已停止对话。请先用 /compact 重新压缩，成功后再继续。');
    }
  }
}
