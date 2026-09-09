# 第三方源码说明

本插件以 MIT 协议发布。

构建产物 dist/adapter.mjs 派生自 DeepSeek 的 @deepseek-ai/dsh-llm-pi-ai 0.1.2-rc.1，dist/compaction.mjs 派生自 @deepseek-ai/dsh-compaction-basic 同版本，标准模式文件派生自 @deepseek-ai/dsh-agent-presets 同版本。原作者版权为 Copyright (c) 2026 DeepSeek，采用 MIT 协议；完整原许可证随制品放在 dist/UPSTREAM-LICENSE。

官方仓库：https://github.com/deepseek-ai/deepseek-harness

构建脚本从锁定依赖读取原版，拒绝不匹配的请求边界和已被修改的标准模式。修改仅为一次请求中的模型副本适配，以及目标摘要输出上限。源文件 SHA-256 记录于 dist/provenance.json，依赖包完整性记录于 package-lock.json。

这是第三方社区插件，不是 DeepSeek 或 Qwen 官方发布或背书的产品。
