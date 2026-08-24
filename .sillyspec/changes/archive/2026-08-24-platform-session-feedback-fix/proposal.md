---
author: qinyi
created_at: 2026-08-24 10:45:00
---

# 提案书（Proposal）— 平台会话实时反馈修复

## 动机

用户在 Web 平台会话中使用 Agent 时，遇到三类影响操作信心的体验缺陷：

1. **长时间 shell 命令无反馈**：Agent 执行 Bash 工具（构建、测试、迁移等）时，平台会话看不到命令是否正在运行、当前输出、是否结束。
2. **Plan 模式无确认入口**：Agent 通过 `EnterPlanMode` 进入计划阶段后，平台侧没有计划摘要和确认/修改/取消入口，用户与 Agent 都不知道下一步该谁推进。
3. **后台 Agent 任务进度不可见**：平台会话在后台任务仍在运行时提前显示「已完成」，用户等不到后续反馈（如当前 Design Grill 子代理场景）。
4. **AskUser 弹窗遮挡内容**：现有 askuser / permission 弹窗不可最小化，大弹窗容易完全遮挡会话内容。

根本原因：平台已有 `agent_session:{id}` Redis Pub/Sub + SSE 实时通道，但 plan/bash/后台 Agent 进度等事件尚未定义、上报和消费。

## 关键问题

- **事件缺口**：现有 session SSE 只消费 `log` / `tokens` / `messages` / `permission_request` / `gate_status_changed`，没有 `plan_mode_entered` / `bash_status` / `bash_chunk` / `agent_task_status` 等事件。
- **前端状态与后台实际进度脱节**：后台 Agent/Bash/plan 运行时，前端会话状态提前进入「已完成」，用户收不到进度推送。
- **确认交互分散**：plan 确认、askuser、permission_request 三套交互没有统一的最小化/浮动能力，容易互相遮挡。

## 变更范围

本次变更将：

1. 扩展 backend session SSE 事件体系，新增 `plan_mode_entered`、`bash_status`、`bash_chunk`、`agent_task_status` 事件。
2. 新增 `POST /api/daemon/sessions/{session_id}/plan-response` 端点，接收用户对 plan 的确认/修改/取消决策。
3. 在 sillyhub-daemon 的交互式会话驱动中识别 plan/Bash/后台 Agent 任务，并上报事件。
4. 在前端 `SessionPanel` 中渲染 `PlanApprovalCard`、`BashProgressCard`，并接入后台 Agent 任务进度提示。
5. 改造 askuser / permission 弹窗，支持最小化为右下角浮动胶囊。

## 不在范围内

- 不实现 Bash 命令的远程中断/取消。
- 不改造 Agent 侧 plan 模式内部逻辑。
- 不重构现有 `permission_request` / `session_dialog_request` 数据模型。
- 不修改 SillySpec CLI 进度同步协议。
- 不新增持久化表存储 plan/bash 事件。

## 成功标准

1. Agent 进入 plan 模式后，Web 会话 3 秒内弹出计划摘要确认卡片；用户决策后 Agent 在 5 秒内收到反馈。
2. Bash 命令开始后，Web 会话显示「运行中」进度卡片，实时输出按 100ms 级延迟追加。
3. 后台 Agent 任务（如 Design Grill 子代理）运行时，会话状态不提前标记完成，任务进度可见。
4. AskUser 弹窗支持最小化/还原，最小化后显示未决角标。
5. 所有新事件类型对旧前端/daemon 兼容（忽略不认识的事件）。
6. 新增后端/前端/daemon 测试覆盖，CI 通过。
