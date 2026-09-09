import { createRequire } from 'node:module';

export const VERSION = '0.1.2-rc.1';
export const PROVIDER = process.env.DSH_QWEN38_PROVIDER || 'qwen38';
export const MODEL = 'Qwen3.8-27B';

// 只复制摘要请求的模型描述，绝不改共享对象或普通聊天设置。
export function adaptModel(options, model) {
  if (options.purpose !== 'compaction' || options.provider !== PROVIDER || options.model !== MODEL) return model;
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
