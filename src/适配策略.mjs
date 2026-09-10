import { createRequire } from 'node:module';

import { getGlobalDispatcher } from 'undici';

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

// 不绑定特定 DSH 版本：只确认上游包可解析。正确性由构建时的结构锚点校验保证，
// 上游结构变化时构建脚本会拒绝生成，而不是在这里按版本号拦截运行。
export function assertCompatible() {
  const require = createRequire(import.meta.url);
  for (const name of ['dsh-llm-pi-ai', 'dsh-compaction-basic', 'dsh-agent-presets']) {
    require(`@deepseek-ai/${name}/package.json`);
  }
}
