import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// 构建只生成本项目 dist，不修改上游包或用户 DSH 安装目录。
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const version = '0.1.2-rc.1';
const upstream = name => dirname(require.resolve(`@deepseek-ai/${name}/package.json`));
const adapterRoot = upstream('dsh-llm-pi-ai');
const presetRoot = upstream('dsh-agent-presets');
for (const path of [adapterRoot, presetRoot]) assert.equal(JSON.parse(await readFile(join(path, 'package.json'), 'utf8')).version, version);
const source = await readFile(join(adapterRoot, 'lib/index.js'), 'utf8');
const needle = 'const model = this.modelOf(snapshot, options.provider, options.model);';
assert.equal(source.split(needle).length, 2, '上游请求边界改变或含旧补丁，拒绝生成');
const edited = 'import { adaptModel, assertCompatible } from "../src/适配策略.mjs";\nassertCompatible();\n' + source.replace(needle,
  'const model = adaptModel(options, this.modelOf(snapshot, options.provider, options.model));');
const standard = await readFile(join(presetRoot, 'presets/standard/agent.cordis.yml'), 'utf8');
const entry = "      name: '@deepseek-ai/dsh-compaction-basic'";
assert.equal(standard.split(entry).length, 2, '上游标准模式结构变化');
assert.ok(!standard.includes('modelPolicies:'), '源标准模式已被修改，拒绝覆盖其策略');
const patchedPreset = standard.replace(entry, entry + `\n      config:\n        modelPolicies:\n          - provider: !!js process.env.DSH_QWEN38_PROVIDER || 'qwen38'\n            model: Qwen3.8-27B\n            maxTokens: 16384`);
await mkdir(join(root, 'dist/presets/standard'), { recursive: true });
await writeFile(join(root, 'dist/adapter.mjs'), edited, 'utf8');
await writeFile(join(root, 'dist/presets/standard/agent.cordis.yml'), patchedPreset, 'utf8');
await copyFile(join(presetRoot, 'presets/standard/preset.yml'), join(root, 'dist/presets/standard/preset.yml'));
await copyFile(join(adapterRoot, 'LICENSE'), join(root, 'dist/UPSTREAM-LICENSE'));
await writeFile(join(root, 'dist/provenance.json'), JSON.stringify({ version,
  repository: 'https://github.com/deepseek-ai/deepseek-harness',
  sourceAdapterSha256: createHash('sha256').update(source).digest('hex'),
  sourceStandardSha256: createHash('sha256').update(standard).digest('hex'),
  changes: ['摘要用途下复制模型描述并关闭思考', 'standard 的目标摘要上限为 16384'],
}, null, 2) + '\n');
console.log('构建完成：官方固定版本来源、单个请求分支、标准模式摘要策略。');
