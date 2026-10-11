---
author: qinyi
created_at: 2026-10-10T23:56:00
---
# 任务清单（Tasks）— 2026-10-10-all-engines-mcp-injection

> plan 阶段展开（W1 并行 4 任务 → W2 三引擎通道 → W3 翻值同步 → W4 端到端）。Wave 分组与全局约束见 plan.md。

- [x] task-01: SPIKE-00 pi 1.0 兼容总探——rpc 协议/vendored 扩展装载/MCP 消费形态三档实测 + 量化裁定留档 spike-pi-10-compat.md (depends_on: —)
- [x] task-02: SPIKE-01 codex app-server MCP 生效实测——per-session CODEX_HOME config.toml [mcp_servers.*] 工具面可见性 + 实验位评估，留档 spike-codex-mcp.md (depends_on: —)
- [x] task-03: SPIKE-02 cursor headless MCP 实测——审批行为 + 配置落点隔离调查，留档 spike-cursor-mcp.md (depends_on: —)
- [x] task-04: 谓词能力化——cli.ts isMainAgentSession 改经 getProviderCaps 查询 + providers.ts caps 暴露 + mcp-config.test.ts 注入矩阵单测（四引擎×stage×caps + 未知 provider） (depends_on: —)
- [x] task-05: pi 通道落地——按 task-01 形态结论实现 pi-settings MCP 写盘 + pi-rpc-driver 消费/1.0 适配/宿主版本检测降级 + pi-settings-mcp.test.ts (depends_on: task-01)
- [x] task-06: codex 通道落地——按 task-02 结论实现 codex-settings [mcp_servers.*] 托管段（含 args 数组/env 表序列化扩展）+ codex-app-server-driver 消费 + codex-settings-mcp.test.ts (depends_on: task-02)
- [x] task-07: cursor 通道落地或留档——按 task-03 结论实现 cursor-driver 消费，或 providers.ts 注释三要素留档 (depends_on: task-03)
- [x] task-08: caps 翻值同步——providers.ts 翻值 + 注释改写新证据 + gen-provider-caps.mjs 重跑产物同步 + test_provider_caps_alignment.py + daemon 既有 MCP/driver 测试回归 (depends_on: task-05,06,07)
- [x] task-09: 端到端验收——每翻值引擎平台会话 MCP 工具可见 + upload_file 实测上传成功，acceptance-e2e.md 留档 (depends_on: task-08)
