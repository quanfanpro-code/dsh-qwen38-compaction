import { createRequire } from 'node:module';

import { getGlobalDispatcher } from 'undici';

export const VERSION = '0.1.2-rc.1';
export const MODEL = 'Qwen3.8-27B';

// 只为摘要请求覆盖连接等待时间，沿用现有连接与代理，不修改全局配置。
export function compactionTransport(options, profile) {
  if (options.purpose !== 'compaction' || options.model !== MODEL) return {};
  const timeoutMs = profile.timeoutMs ?? 600000;
  const deadline = AbortSignal.timeout(timeoutMs);
  return {
    timeoutMs,
    fetch: (input, init = {}) => globalThis.fetch(input, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
      dispatcher: {
        dispatch(request, handler) {
          return getGlobalDispatcher().dispatch({ ...request, headersTimeout: timeoutMs, bodyTimeout: timeoutMs }, handler);
        },
      },
    }),
  };
}

// 只复制摘要请求的模型描述，绝不改共享对象或普通聊天设置。
export function adaptModel(options, model) {
  if (options.purpose !== 'compaction' || options.model !== MODEL) return model;
  if (model.api !== 'openai-completions') throw new Error('Qwen 压缩插件仅支持当前已验证的 OpenAI 兼容聊天协议。');
  return { ...model, reasoning: true, compat: { ...model.compat,
    thinkingFormat: 'chat-template',
    chatTemplateKwargs: { ...model.compat?.chatTemplateKwargs, enable_thinking: false },
  } };
}

export function assertCompatible() {
  const require = createRequire(import.meta.url);
  for (const name of ['dsh-llm-pi-ai', 'dsh-compaction-basic', 'dsh-agent-presets']) {
    const actual = require(`@deepseek-ai/${name}/package.json`).version;
    if (actual !== VERSION) throw new Error(`Qwen 压缩插件需要 ${name} ${VERSION}，当前为 ${actual}。请停用插件或使用匹配版本。`);
  }
}
