---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-10-all-engines-mcp-injection

## Spike 前置验证（如需要）

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| SPIKE-00（task-01） | pi 1.0 升级兼容：① --mode rpc 事件流/session-dir/fork 协议兼容性 ② vendored ask-user/subagent 扩展装载 ③ MCP 消费形态三档（原生配置键 / pi-mcp-adapter / 均不可用）与 PI_CODING_AGENT_DIR 相互作用 | 三项实测通过 + 形态结论落档 spike-pi-10-compat.md | 触发量化截断阈值（rpc 全量重写 / ≥2 vendored 扩展重写 / 三形态全不可用任一）→ task-05 收窄为 pi.mcp 维持 false + 注释适配留档（D-004） |
| SPIKE-01（task-02） | codex app-server 协议模式下 per-session CODEX_HOME config.toml [mcp_servers.*] 是否生效（工具进 thread 工具面） | 实测生效证据落档 spike-codex-mcp.md | 不生效且 initialize capabilities 实验位不通 → task-06 收窄为 codex.mcp 维持 false 留档（D-006） |
| SPIKE-02（task-03） | cursor headless MCP 工具审批行为 + 配置落点隔离（全局禁写/项目级污染/per-process 参数） | 可行结论 + 落点方案落档 spike-cursor-mcp.md | 确认不可用 → task-07 收窄为 cursor.mcp 维持 false + providers.ts 注释三要素留档（D-003） |

## Wave 1（并行，无依赖）

> batch: task-01+task-02
> batch: task-03
> batch: task-04

- task-01
- task-02
- task-03
- task-04

## Wave 2（依赖 Wave 1：task-05←task-01，task-06←task-02，task-07←task-03）

- task-05
- task-06
- task-07

## Wave 3（依赖 Wave 2 全部：三通道定稿后统一翻值）

- task-08

## Wave 4（依赖 Wave 3：翻值产物同步后端到端）

- task-09

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | SPIKE-00 pi 1.0 兼容总探 | W1 | P0 | — | FR-03, D-004@v1, D-005@v1 | 三项实测 + 形态结论①/②/③ + 量化裁定留档 |
| task-02 | SPIKE-01 codex app-server MCP 生效实测 | W1 | P0 | — | FR-04, D-006@v1 | config.toml [mcp_servers.*] 生效性 + 实验位评估留档 |
| task-03 | SPIKE-02 cursor headless MCP 实测 | W1 | P1 | — | FR-05, D-003@v1 | 审批行为 + 落点隔离调查留档 |
| task-04 | 谓词能力化 + 注入矩阵单测 | W1 | P0 | — | FR-01, FR-02, D-001@v1, D-002@v1 | cli.ts getProviderCaps 查询替代硬拒；providers.ts caps 暴露；mcp-config.test.ts 四引擎×stage×caps 矩阵 + 未知 provider 用例 |
| task-05 | pi 通道落地 + 写盘单测 | W2 | P0 | task-01 | FR-03, FR-06, D-005@v1 | 按 SPIKE-00 形态结论实现；pi-settings MCP 写盘 + pi-rpc-driver 消费/1.0 适配/版本检测降级 + pi-settings-mcp.test.ts |
| task-06 | codex 通道落地 + 写盘单测 | W2 | P0 | task-02 | FR-04, D-006@v1 | 按 SPIKE-01 结论实现；codex-settings [mcp_servers.*] 托管段 + 序列化能力扩展（args 数组/env 表）+ codex-app-server-driver 消费 + codex-settings-mcp.test.ts |
| task-07 | cursor 通道落地或留档 | W2 | P1 | task-03 | FR-05, D-003@v1 | SPIKE-02 可行→cursor-driver 消费实现；不可行→注释三要素留档 |
| task-08 | caps 翻值同步 + 全量回归 | W3 | P0 | task-05,06,07 | FR-07, FR-08, D-007@v1 | providers.ts 翻值 + 注释改写新证据 + gen-provider-caps 重跑 + 对齐守护测试 + daemon 既有 MCP/driver 测试回归 |
| task-09 | 端到端验收留档 | W4 | P0 | task-08 | FR-09, D-001@v1 | 每翻值引擎平台会话 MCP 工具可见 + upload_file 实测上传成功，acceptance-e2e.md 留档 |

## 关键路径

task-01 → task-05 → task-08 → task-09（pi 通道最长：形态分叉最多、适配面最大，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- 分身谓词 isWorkerSession（sillyhub-daemon/src/cli.ts:1118-1120）维持 claude-only 不动（D-002，循既有 D-008@v1）
- MCP 配置禁止写宿主全局资产：~/.pi（含 ~/.pi/agent）、~/.codex、~/.cursor 一律禁写；只落 per-session 隔离目录（PI_CODING_AGENT_DIR / CODEX_HOME / cursor 实测落点）
- daemon 侧 MCP SDK `@modelcontextprotocol/sdk ^1.29.0` 锁 1.x 线不动（与 backend `mcp>=1.29,<2` 联动条款，known-issues）
- frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py 为生成产物，禁止手写（唯一更新途径 gen-provider-caps.mjs）
- 谓词判定禁止对 PROVIDER_CAPS 直接下标——必须经 getProviderCaps（未知 provider 默认拒绝）
- backend 零端点/schema/协议改动；frontend 零手写 UI 改动；daemon↔backend WS/HTTP 契约零变化
- pi 扩展禁止在 session_start 等启动期事件里同步 await dialog（ql-20260911-027 已知坑——dialog 只能在 turn 进行中发起；绑定 task-05 形态②③实现）
- daemon ESM import 必须带 .js 扩展名；Windows 自 spawn 路径必须 resolveWindowsCmdShim（conventions 已知坑）
- 宿主 pi<1.0 时会话不注入 MCP 并 warn（含版本号），其余功能不受影响——机制支持与运行时版本两层门控分离
- 单点回退承诺：任一通道回退 = PROVIDER_CAPS 对应 mcp 键回 false + 重跑 gen-provider-caps，无其他残留状态

## 全局验收标准

1. 所有单元测试通过（mcp-config 注入矩阵 / pi-settings-mcp / codex-settings-mcp / test_provider_caps_alignment）
2. daemon 既有 MCP 契约与 driver 测试零回归（mcp-server.test.ts、mcp-config.test.ts、各 driver 既有测试）
3. （brownfield）未翻值引擎与 claude 链路行为与现状逐字节一致；宿主 pi<1.0 降级不注入
4. SPIKE 留档三份（spike-pi-10-compat.md / spike-codex-mcp.md / spike-cursor-mcp.md）含实测证据与量化裁定
5. 端到端：每翻值引擎平台会话 upload_file 实测上传成功，acceptance-e2e.md 留档

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-04, task-09 | AC：谓词矩阵单测 + 端到端 upload_file |
| D-002@v1 | task-04 | AC：分身 mission_worker 不注入断言 |
| D-003@v1 | task-03, task-07, task-08 | AC：spike-cursor-mcp.md + providers.ts 注释三要素 |
| D-004@v1 | task-01, task-05, task-08 | AC：spike-pi-10-compat.md 量化裁定 + 版本检测降级用例 |
| D-005@v1 | task-05 | AC：形态结论落档 + per-session 隔离用例 |
| D-006@v1 | task-02, task-06, task-08 | AC：spike-codex-mcp.md + 托管段往返单测 |
| D-007@v1 | task-08 | AC：test_provider_caps_alignment.py 全绿 + 产物 diff 仅脚本生成 |
| D-008@v1 | task-04 | rejected 留痕：driver 选项层实现路径 |
| D-009@v1 | task-09 | rejected 留痕：全引擎一并收口 |
| D-010@v1 | task-05 | rejected 留痕：pi 1.0 原生 MCP 优先 |
