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
const transportEntry = '...profileOptions(profile, reasoning, apiKey),';
assert.equal(source.split(transportEntry).length, 2, '上游连接参数边界改变，拒绝生成');
const edited = 'import { adaptModel, compactionTransport, assertCompatible } from "../src/适配策略.mjs";\nassertCompatible();\n' + source.replace(needle,
  'const model = adaptModel(options, this.modelOf(snapshot, options.provider, options.model));')
  .replace(transportEntry, transportEntry + '\n                    ...compactionTransport(options, profile),');
const standard = await readFile(join(presetRoot, 'presets/standard/agent.cordis.yml'), 'utf8');
const entry = "      name: '@deepseek-ai/dsh-compaction-basic'";
assert.equal(standard.split(entry).length, 2, '上游标准模式结构变化');
assert.ok(!standard.includes('modelPolicies:'), '源标准模式已被修改，拒绝覆盖其策略');
// 原生 modelPolicies 强制绑定服务商，因此只改原生摘要上限的这一处分支。
const compaction = await readFile(join(compactionRoot, 'lib/index.js'), 'utf8');
const capEntry = 'maxTokens: override?.maxTokens ?? config.maxTokens,';
assert.equal(compaction.split(capEntry).length, 2, '上游摘要上限边界改变，拒绝生成');
const autoEntry = 'if (this.config.auto) this._registerAutomaticCompaction();';
const catchStart = '\t\t\t\tif (error instanceof TargetPressureConfigError) {';
const catchEnd = '\t\t\t\tctx.logger.warn(`step compaction failed: ${message}; continuing the turn`);';
assert.equal(compaction.split(autoEntry).length, 2, '上游压缩注册入口改变');
assert.equal(compaction.split(catchStart).length, 2, '上游压缩错误入口改变');
assert.equal(compaction.split(catchEnd).length, 2, '上游压缩错误出口改变');
const oldCatch = compaction.slice(compaction.indexOf(catchStart), compaction.indexOf(catchEnd) + catchEnd.length);
const patchedCompaction = 'import { MODEL, assertCompatible } from "../src/适配策略.mjs";\nimport { assertCompactionSucceeded } from "../src/失败拦截.mjs";\nassertCompatible();\n' + compaction.replace(capEntry,
  'maxTokens: target.model === MODEL ? 16384 : (override?.maxTokens ?? config.maxTokens),')
  .replace(autoEntry, `ctx.on("agent/pre-step", ({ agent }, next) => {
      assertCompactionSucceeded(agent.session);
      return next();
    });
    ${autoEntry}`)
  .replace(oldCatch, '\t\t\t\tthrow new Error("上下文压缩失败，已停止对话。请先用 /compact 重新压缩，成功后再继续。", { cause: error });');
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
  changes: ['仅按模型标识匹配，摘要用途下复制模型描述并关闭思考', '仅按模型标识调整原生摘要上限为 16384', '摘要连接等待遵守原配置，并限制完整请求总时长', '压缩失败停止普通聊天，成功重试后恢复，会话重开不能绕过'],
}, null, 2) + '\n');
console.log('构建完成：官方固定版本来源、单个请求分支、标准模式摘要策略。');
