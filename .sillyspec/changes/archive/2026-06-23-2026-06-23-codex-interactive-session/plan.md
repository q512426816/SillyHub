---
author: qinyi
created_at: 2026-06-23 21:46:45
plan_level: full
---

# 实现计划

## Wave 1（基础契约，无依赖）

- [x] task-01: 建立 provider-neutral interactive driver 契约与输入队列（覆盖：FR-01, FR-02, FR-10, D-001@v1, D-009@v1）

## Wave 2（依赖 Wave 1）

- [x] task-02: SessionManager 接入 provider driver registry、provider-neutral hook 与恢复路由（覆盖：FR-01, FR-02, FR-03, FR-06, FR-08, FR-09, FR-10, D-001@v1, D-006@v1, D-008@v1, D-009@v1）
- [x] task-03: ClaudeSdkDriver 兼容 provider-neutral 输入并保留现有 Claude Code 行为（覆盖：FR-02, FR-08, FR-09, FR-10, D-001@v1, D-006@v1, D-008@v1, D-009@v1）

## Wave 3（依赖 Wave 2）

- [x] task-04: 实现 CodexAppServerDriver 核心生命周期、flat message 日志与 interrupt（覆盖：FR-01, FR-02, FR-03, FR-04, FR-05, D-001@v1, D-002@v1, D-003@v1, D-004@v1）
- [x] task-05: 实现 Codex approval、request_user_input 与 MCP elicitation 映射（覆盖：FR-08, FR-09, D-006@v1, D-008@v1, D-010@v1）

## Wave 4（依赖 Wave 3）

- [x] task-06: daemon 接入 provider-specific executable、Codex recovery 与 session 清理（覆盖：FR-01, FR-03, FR-05, FR-06, D-001@v1, D-002@v1, D-003@v1, D-007@v1）
- [x] task-07: backend 放开 Codex reopen 并补齐 session/permission 回归测试（覆盖：FR-06, FR-08, FR-09, D-003@v1, D-006@v1, D-007@v1, D-008@v1）

## Wave 5（依赖 Wave 4）

- [x] task-08: frontend `/runtimes` Codex 改走 interactive panel 与 create/inject/reopen 路径（覆盖：FR-01, FR-02, FR-05, FR-06, FR-07, D-003@v1, D-005@v1, D-007@v1）
- [x] task-09: frontend 复用 AskUserDialogCard 展示 Codex dialog payload 并补齐交互测试（覆盖：FR-09, D-006@v1, D-008@v1, D-010@v1）

## Wave 6（依赖 Wave 5）

- [x] task-10: 同步模块文档、收敛 quick fix 变更并完成跨层验证（覆盖：FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1, D-008@v1, D-009@v1, D-010@v1）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| task-01 | 建立 provider-neutral interactive driver 契约与输入队列 | W1 | P0 | — | FR-01, FR-02, FR-10, D-001@v1, D-009@v1 | 移除 session 生命周期层对 Claude SDK 输入类型的直接依赖 |
| task-02 | SessionManager 接入 provider driver registry、provider-neutral hook 与恢复路由 | W2 | P0 | task-01 | FR-01, FR-02, FR-03, FR-06, FR-08, FR-09, FR-10, D-001@v1, D-006@v1, D-008@v1, D-009@v1 | create/inject/interrupt/end/recover 按 provider 路由 |
| task-03 | ClaudeSdkDriver 兼容 provider-neutral 输入并保留现有 Claude Code 行为 | W2 | P0 | task-01 | FR-02, FR-08, FR-09, FR-10, D-001@v1, D-006@v1, D-008@v1, D-009@v1 | Claude Code 现有 interactive、审批和 AskUserQuestion 不回退 |
| task-04 | 实现 CodexAppServerDriver 核心生命周期、flat message 日志与 interrupt | W3 | P0 | task-02, task-03 | FR-01, FR-02, FR-03, FR-04, FR-05, D-001@v1, D-002@v1, D-003@v1, D-004@v1 | Codex app-server 支持创建、多轮、日志、终止与打断 |
| task-05 | 实现 Codex approval、request_user_input 与 MCP elicitation 映射 | W3 | P0 | task-02, task-04 | FR-08, FR-09, D-006@v1, D-008@v1, D-010@v1 | Codex 普通审批和用户输入请求复用现有人工交互链路 |
| task-06 | daemon 接入 provider-specific executable、Codex recovery 与 session 清理 | W4 | P0 | task-04, task-05 | FR-01, FR-03, FR-05, FR-06, D-001@v1, D-002@v1, D-003@v1, D-007@v1 | daemon 以 runtime provider 选择 executable，并支持 Codex reopen/recovery |
| task-07 | backend 放开 Codex reopen 并补齐 session/permission 回归测试 | W4 | P0 | task-02 | FR-06, FR-08, FR-09, D-003@v1, D-006@v1, D-007@v1, D-008@v1 | backend 允许 Codex session 继续对话，同时保留 unsupported provider 拦截 |
| task-08 | frontend `/runtimes` Codex 改走 interactive panel 与 create/inject/reopen 路径 | W5 | P0 | task-06, task-07 | FR-01, FR-02, FR-05, FR-06, FR-07, D-003@v1, D-005@v1, D-007@v1 | Codex runtime 不再使用 quick-chat 作为主会话入口 |
| task-09 | frontend 复用 AskUserDialogCard 展示 Codex dialog payload 并补齐交互测试 | W5 | P1 | task-05, task-08 | FR-09, D-006@v1, D-008@v1, D-010@v1 | Codex 用户输入请求使用现有 dialog 卡片和响应路径 |
| task-10 | 同步模块文档、收敛 quick fix 变更并完成跨层验证 | W6 | P0 | task-06, task-07, task-08, task-09 | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1, D-007@v1, D-008@v1, D-009@v1, D-010@v1 | 模块文档反映最终架构，测试命令按 local.yaml 和子项目约定执行 |

## 关键路径

task-01 → task-02 → task-04 → task-05 → task-06 → task-08 → task-09 → task-10

## 调用点检查

| 检查项 | 命令 | 输出摘要 | 纳入任务 |
| --- | --- | --- | --- |
| `SessionManager` 构造与测试调用点 | `rg -n "new SessionManager\|SessionManager\\(" sillyhub-daemon/src sillyhub-daemon/tests` | 命中 `sillyhub-daemon/src/cli.ts`、`sillyhub-daemon/src/interactive/session-manager.ts`、`sillyhub-daemon/tests/interactive/**`、`sillyhub-daemon/tests/daemon-*.test.ts`、`sillyhub-daemon/tests/spec-transport-tar-sync/**` 等构造和 mock 调用点 | task-02, task-03, task-06 |
| `InputQueue` / Claude SDK 输入类型 | `rg -n "InputQueue\|SDKUserMessage\|ClaudeSdkDriver" sillyhub-daemon/src sillyhub-daemon/tests` | 命中 `input-queue.ts`、`session-manager.ts`、`claude-sdk-driver.ts`、`types.ts`、`protocol.ts` 和多组 interactive driver/session 测试 | task-01, task-02, task-03, task-10 |
| frontend session client 与 `/runtimes` 分流 | `rg -n "createSession\|injectSession\|reopenSession\|QuickChatSessionSection\|InteractiveSessionChatSection\|AskUserDialogCard" frontend/src` | 命中 `runtime-session-dialog.tsx` 中 Codex quick-chat 分流、`runtime-session-helpers.tsx`、`interactive-session-panel.tsx`、`ask-user-dialog-card.tsx` 与对应测试 | task-08, task-09, task-10 |
| backend reopen provider gate | `rg -n "reopen_session\|DaemonSessionResumeUnsupported\|provider" backend/app/modules/daemon/session backend/app/modules/daemon/tests` | 命中 `session/service.py` 中 `provider != "claude"` 拦截、`test_session_reopen.py` Codex unsupported 用例、session/permission/recovery 测试 | task-07, task-10 |

## 全局验收标准

- [ ] `/runtimes` Codex 首条消息调用 interactive session create，不调用 quick-chat API。
- [ ] Codex 同一 session 支持多轮 inject，每个 turn 对应同一 `AgentSession` 下的 `AgentRun`。
- [ ] Codex 输出以 flat message 写入现有 session log，并可通过前端 SSE 展示。
- [ ] Codex running turn 可 interrupt，session 结束后仍可查看历史日志。
- [ ] Codex ended/failed session 在有 thread id 时可 reopen，缺少 thread id 时明确失败且不伪造新 thread。
- [ ] `manual_approval=true, ask_user_only=true` 时 Codex 普通 command/file/permission approval 不弹普通审批卡；用户输入请求仍弹现有 dialog。
- [ ] `manual_approval=true, ask_user_only=false` 时 Codex 普通 approval 进入现有前端审批链路。
- [ ] Claude Code interactive create/inject/interrupt/end/reopen、审批和 AskUserQuestion 现有测试通过。
- [ ] backend、frontend、sillyhub-daemon 的相关测试与类型检查按 `.sillyspec/.runtime/local.yaml` 和子项目约定通过。
- [ ] `.sillyspec/docs/**` 模块文档与最终代码行为一致。

## 覆盖矩阵：Functional Requirements

| ID | 覆盖任务 | 验收证据 |
| --- | --- | --- |
| FR-01 | task-01, task-02, task-04, task-06, task-08, task-10 | AC-01, AC-09 |
| FR-02 | task-01, task-02, task-03, task-04, task-08, task-10 | AC-02, AC-09 |
| FR-03 | task-02, task-04, task-06, task-10 | AC-04, AC-09 |
| FR-04 | task-04, task-10 | AC-03, AC-09 |
| FR-05 | task-04, task-06, task-08, task-10 | AC-04, AC-09 |
| FR-06 | task-02, task-06, task-07, task-08, task-10 | AC-05, AC-09 |
| FR-07 | task-08, task-10 | AC-01, AC-09 |
| FR-08 | task-02, task-03, task-05, task-07, task-10 | AC-06, AC-07, AC-08, AC-09 |
| FR-09 | task-02, task-03, task-05, task-07, task-09, task-10 | AC-06, AC-07, AC-09 |
| FR-10 | task-01, task-02, task-03, task-10 | AC-08, AC-09 |

## 覆盖矩阵：Decisions

| ID | 覆盖任务 | 验收证据 |
| --- | --- | --- |
| D-001@v1 | task-01, task-02, task-03, task-04, task-06, task-10 | AC-02, AC-04, AC-08, AC-09 |
| D-002@v1 | task-04, task-06, task-10 | AC-02, AC-04, AC-05, AC-09 |
| D-003@v1 | task-04, task-06, task-07, task-08, task-10 | AC-02, AC-03, AC-04, AC-05, AC-09 |
| D-004@v1 | task-04, task-10 | AC-03, AC-09 |
| D-005@v1 | task-08, task-10 | AC-01, AC-09 |
| D-006@v1 | task-02, task-03, task-05, task-07, task-09, task-10 | AC-06, AC-07, AC-08, AC-09 |
| D-007@v1 | task-06, task-07, task-08, task-10 | AC-05, AC-09 |
| D-008@v1 | task-02, task-03, task-05, task-07, task-09, task-10 | AC-06, AC-07, AC-08, AC-09 |
| D-009@v1 | task-01, task-02, task-03, task-10 | AC-02, AC-08, AC-09 |
| D-010@v1 | task-05, task-09, task-10 | AC-06, AC-07, AC-09 |
