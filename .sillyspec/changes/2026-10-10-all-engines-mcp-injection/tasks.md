---
author: qinyi
created_at: 2026-10-10T23:56:00
---
# 任务清单（Tasks）— 2026-10-10-all-engines-mcp-injection

> 初版清单（brainstorm 产出）。plan 阶段按 design.md §总体方案 Wave 分组展开为唯一真相。

## Wave 1 — SPIKE 前置（可并行，产截断结论）

- [ ] task-01: SPIKE-00 pi 1.0 兼容总探——宿主装 pi 1.0+ 实测三项：--mode rpc 事件流/session-dir/fork 协议兼容性、vendored ask-user/subagent 扩展装载、MCP 消费形态（原生配置 vs pi-mcp-adapter vs 均不可用）与 PI_CODING_AGENT_DIR 相互作用；留档 spike-pi-10-compat.md 并给出形态结论（①/②/③）——验证：留档含三项实测证据
- [ ] task-02: SPIKE-01 codex app-server MCP 生效实测——per-session CODEX_HOME config.toml 写 [mcp_servers.*] 后 app-server 模式工具面可见性；留档 spike-codex-mcp.md——验证：留档含生效/不生效证据
- [ ] task-03: SPIKE-02 cursor headless MCP 实测——headless 审批行为 + 配置落点隔离（全局/项目级/per-process）调查；留档 spike-cursor-mcp.md——验证：留档含可行/不可行结论与证据

## Wave 2 — 公共谓词（依赖 Wave 1 结论定翻值预期，代码本身可先行）

- [ ] task-04: cli.ts isMainAgentSession 谓词能力化（查 PROVIDER_CAPS[provider].mcp）+ providers.ts 向装配处暴露 caps 查询——验证：mcp-config.test.ts 注入矩阵用例绿（四引擎 × stage ∈ {'',orchestrator,mission_worker} × caps 组合断言）

## Wave 3 — 各引擎消费通道（按 Wave 1 形态结论实现，可并行；截断通道转为注释留档任务）

- [ ] task-05: pi-settings.ts MCP 配置写入（形态按 task-01）+ pi-rpc-driver PiStartOptions 消费与 1.0 协议适配 + 宿主版本检测降级（FR-03/FR-06）——验证：pi-settings-mcp.test.ts 全绿
- [ ] task-06: codex-settings.ts [mcp_servers.*] 托管段差量替换 + codex-app-server-driver start 消费（FR-04）——验证：codex-settings-mcp.test.ts 全绿
- [ ] task-07: cursor-driver 按 task-03 结论实现消费或更新忽略注释为实测留档（FR-05）——验证：caps 断言/注释三要素齐

## Wave 4 — 翻值同步与回归

- [ ] task-08: providers.ts caps 翻值（按 Wave 1 实测结论）+ 注释改写为新证据引用 + gen-provider-caps.mjs 重跑（FR-07）——验证：test_provider_caps_alignment.py 全绿
- [ ] task-09: daemon 既有 MCP 契约与 driver 测试回归（FR-08）——验证：tests/mcp-server.test.ts、tests/mcp-config.test.ts、各 driver 既有测试全绿

## Wave 5 — 端到端验收

- [ ] task-10: 每翻值引擎平台真实会话端到端：MCP 工具可见 + upload_file 上传成功（FR-09），验收记录留档 acceptance-e2e.md——验证：留档含每引擎实测证据
