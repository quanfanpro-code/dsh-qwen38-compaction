import { fileURLToPath } from 'node:url';
import AgentPresets, { SHIPPED_PRESET_ROOT } from '@deepseek-ai/dsh-agent-presets';
import { assertCompatible } from './适配策略.mjs';

export const name = 'qwen38-compaction-presets';
export const inject = AgentPresets.inject;
export const Config = AgentPresets.Config;

export function apply(ctx, config) {
  assertCompatible();
  // 同一 standard 标识仍可恢复旧对话，其他模式继续由原目录提供。
  return ctx.plugin(AgentPresets, { ...config, includeShippedRoot: false,
    roots: [
      { path: fileURLToPath(new URL('../dist/presets/', import.meta.url)), trust: 'system' },
      ...(config.includeShippedRoot === false ? [] : [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }]),
      ...(config.roots ?? []),
    ],
  });
}
