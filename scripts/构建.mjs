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
const compactionRoot = upstream('dsh-compaction-basic');
for (const path of [adapterRoot, presetRoot, compactionRoot]) assert.equal(JSON.parse(await readFile(join(path, 'package.json'), 'utf8')).version, version);
const source = await readFile(join(adapterRoot, 'lib/index.js'), 'utf8');
const needle = 'const model = this.modelOf(snapshot, options.provider, options.model);';
assert.equal(source.split(needle).length, 2, '上游请求边界改变或含旧补丁，拒绝生成');
const edited = 'import { adaptModel, assertCompatible } from "../src/适配策略.mjs";\nassertCompatible();\n' + source.replace(needle,
  'const model = adaptModel(options, this.modelOf(snapshot, options.provider, options.model));');
const standard = await readFile(join(presetRoot, 'presets/standard/agent.cordis.yml'), 'utf8');
const entry = "      name: '@deepseek-ai/dsh-compaction-basic'";
assert.equal(standard.split(entry).length, 2, '上游标准模式结构变化');
assert.ok(!standard.includes('modelPolicies:'), '源标准模式已被修改，拒绝覆盖其策略');
// 原生 modelPolicies 强制绑定服务商，因此只改原生摘要上限的这一处分支。
const compaction = await readFile(join(compactionRoot, 'lib/index.js'), 'utf8');
const capEntry = 'maxTokens: override?.maxTokens ?? config.maxTokens,';
assert.equal(compaction.split(capEntry).length, 2, '上游摘要上限边界改变，拒绝生成');
const patchedCompaction = 'import { MODEL, assertCompatible } from "../src/适配策略.mjs";\nassertCompatible();\n' + compaction.replace(capEntry,
  'maxTokens: target.model === MODEL ? 16384 : (override?.maxTokens ?? config.maxTokens),');
const patchedPreset = standard.replace(entry, "      name: 'dsh-qwen38-compaction/compaction'");
await mkdir(join(root, 'dist/presets/standard'), { recursive: true });
await writeFile(join(root, 'dist/adapter.mjs'), edited, 'utf8');
await writeFile(join(root, 'dist/compaction.mjs'), patchedCompaction, 'utf8');
await writeFile(join(root, 'dist/presets/standard/agent.cordis.yml'), patchedPreset, 'utf8');
await copyFile(join(presetRoot, 'presets/standard/preset.yml'), join(root, 'dist/presets/standard/preset.yml'));
await copyFile(join(adapterRoot, 'LICENSE'), join(root, 'dist/UPSTREAM-LICENSE'));
await writeFile(join(root, 'dist/provenance.json'), JSON.stringify({ version,
  repository: 'https://github.com/deepseek-ai/deepseek-harness',
  sourceAdapterSha256: createHash('sha256').update(source).digest('hex'),
  sourceStandardSha256: createHash('sha256').update(standard).digest('hex'),
  sourceCompactionSha256: createHash('sha256').update(compaction).digest('hex'),
  changes: ['仅按模型标识匹配，摘要用途下复制模型描述并关闭思考', '仅按模型标识调整原生摘要上限为 16384'],
}, null, 2) + '\n');
console.log('构建完成：官方固定版本来源、单个请求分支、标准模式摘要策略。');
