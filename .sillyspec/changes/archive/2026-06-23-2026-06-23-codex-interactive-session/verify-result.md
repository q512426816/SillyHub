---
author: qinyi
created_at: 2026-06-24 02:42:00
change: 2026-06-23-codex-interactive-session
risk_profile: high
verdict: PASS_WITH_NOTE
---

# 验证报告：/runtimes Codex Interactive Session

## 变更概述
让 `/runtimes` 的 Codex runtime 走与 Claude 同一 interactive session 链路：daemon provider driver 抽象（ClaudeSdkDriver + CodexAppServerDriver）+ Codex app-server JSON-RPC 长驻 driver + backend reopen 放开 + frontend 撤销 quick-chat 分流。跨 daemon/backend/frontend 三层，含安全敏感的审批 fail-closed 逻辑。

## 风险等级：高
触发条件：跨三层改动 + 权限/审批安全逻辑 + 长驻子进程。verify 强度：全量对照 design + 三层测试 + 安全闭环审查。

## 逐项验证结果

| Step | 项目 | 结论 |
|---|---|---|
| 1 | 状态检查 | ✅ currentStage=verify，主仓库代码已 apply |
| 2 | 加载规范锚定 | ✅ proposal/design/tasks/requirements/plan/decisions 齐全；D-001~D-010@v1 全 accepted，无 superseded/unresolved |
| 3 | 逐项检查任务 | ✅ task-01~10 全部实现，见下表 |
| 4 | 对照设计检查 | ✅ §5.1~§5.7 全部实现且一致；探针无未实现标记；偏差均为合理实现调整 |
| 5 | 任务蓝图验收 | ✅ 各 task AC 全部满足 |
| 6 | 运行测试 | ✅ 三层通过（2 pre-existing 基线失败，见下） |

## 任务完成证据

| task | 结论 | 测试证据 |
|---|---|---|
| task-01 driver 契约 + input queue | ✅ | driver.ts 8 类型，input-queue 泛型化去 SDK 依赖（D-009），22 tests |
| task-02 SessionManager provider 化 | ✅ | _getDriver 路由 + provider-neutral helper，11 tests，Claude 不回退 |
| task-03 ClaudeSdkDriver | ✅ | implements InteractiveDriver，49 tests，FR-10 不回退 |
| task-04 CodexAppServerDriver | ✅ | JSON-RPC 生命周期 + flat message + interrupt，15 tests，batch 不回归 |
| task-05 Codex 审批/对话/elicitation | ✅ | fail-closed 映射 + 空 profile + ask-only 对齐，37 tests |
| task-06 daemon 接入 | ✅ | provider executable + threadId 双写 + reopen exe-path 修复，14 tests |
| task-07 backend reopen | ✅ | gate {claude,codex} + 翻转 legacy 测试 + permission 回归，64 pytest |
| task-08 frontend interactive | ✅ | 撤销 quick-chat + create/inject/reopen，39 tests |
| task-09 frontend dialog | ✅ | AskUserDialogCard 零分支复用，56 tests |
| task-10 文档同步 | ✅ | 5 docs D-001~D-010 全覆盖 + quick-chat 收敛 |

## 测试结果（QA 独立确认，主仓库 apply 后）

| 层 | 结果 |
|---|---|
| daemon typecheck | ✅ 全绿 |
| daemon interactive/codex/bridge 测试 | 307 passed / 2 failed（pre-existing） |
| backend pytest（session/permission/reopen） | ✅ 64 passed |
| frontend typecheck | ✅ 全绿 |
| frontend vitest（dialog/panel） | ✅ 66 passed |
| backend ruff/mypy | ✅ 绿（execute task-07） |
| frontend eslint | ✅ 绿（execute task-09） |

## 安全审查结论（最高优先）
- **fail-closed 闭环正确**：未注入 hook / 异常 / 超时 / session 结束 / 中断时，Codex server request 返回 deny/cancel/空 profile，**绝不 auto accept 或回授 requested permissions**。
- **permissions response 用 `permissions` 字段**（非 decision），deny 返回空 profile `{fileSystem:null,network:null}`。
- **threadId 不伪造**（D-007）：缺 agent_session_id 时 reopen/recovery 明确失败。
- **child 释放**：close 幂等（SIGTERM→SIGKILL），consume finally 必调。
- **provider 路由不串**：_getDriver 按 provider，interrupt/consume 按 session provider 选 target。
- execute step-13 code review 发现的 2 个中危（reopen exe-path 缺失、catch 空 fail-closed）已修复并补测试。

## 已知问题（非本变更引入，pre-existing 基线）

以下 2 个测试在**主仓库 HEAD（无本变更 daemon 改动）同样失败**，经 baseline 对比确认非本变更引入：

1. `session-manager-pending-cleanup.test.ts` AC-09.6（同 turn 多 pending 并发审批 d2 期望 allow 得 deny）—— Claude 并发审批时序，task-02 逐行保留该逻辑未改。
2. `claude-sdk-driver.test.ts` resolveClaudeExecutable（Windows 路径 fixture `C:\nvm4w\nodejs\...`）—— 平台相关测试数据缺陷。

建议：单独 quick 修，不阻断本变更。

## design 偏差（合理实现调整，非违反）
- `InteractiveDriverStartOptions` provider-neutral，`ClaudeStartOptions`/`CodexStartOptions` 各自 extends（符合 design §5.1）。
- `SessionManagerDeps.drivers?` optional + 保留 `driver` 兼容入口（保 cli.ts/现有测试兼容）。
- `_buildCanUseToolCallback` 未改 thin wrapper，新增独立 `_requestPermission`/`_requestUserDialog` helper（务实，FR-10 零回归）。
- session-manager.ts 2 处必要补丁（thread_started 写 agentSessionId + codex sessionPermission 注入），闭合 task-02/04/05 真空。
- json-rpc.ts 不改（batch auto-accept 在 CodexAppServerDriver 层隔离）。

## 决策覆盖（decisions.md 全部当前版本）

本变更覆盖 decisions.md 全部当前版本决策：

- D-001@V1 使用 provider driver registry ✅（SessionManager.drivers + _getDriver 路由）
- D-002@V1 Codex interactive 使用 app-server stdio JSON-RPC ✅（CodexAppServerDriver 长驻）
- D-003@V1 backend 不新增 Codex session 表 ✅（复用 AgentSession/AgentRun/lease）
- D-004@V1 Codex 日志使用 flat message 契约 ✅（event_type/content/metadata/session_id）
- D-005@V1 /runtimes Codex 不再走 quick-chat ✅（task-08 撤销分流）
- D-006@V1 Codex permission/dialog 遵循 manual_approval 策略 ✅（ask-only allow-through + full-review 审批卡）
- D-007@V1 reopen 支持 Codex 但要求已有 thread id ✅（缺 threadId 不伪造）
- D-008@V1 permission/dialog hook 放在 SessionManager 层 ✅（requestPermission/requestUserDialog）
- D-009@V1 输入队列改为 provider-neutral UserTurnInput ✅（InputQueue 泛型化去 SDK 依赖）
- D-010@V1 Codex dialog payload 双向归一化 ✅（requestUserInput/MCP elicitation normalize/denormalize）

## 验证结论
**PASS_WITH_NOTE**：变更实现完整、与 design 一致、三层测试通过、安全闭环达标。唯一 NOTE 是 2 个 pre-existing 基线测试失败（已确认非本变更引入），建议单独修复。变更可进入 archive。
