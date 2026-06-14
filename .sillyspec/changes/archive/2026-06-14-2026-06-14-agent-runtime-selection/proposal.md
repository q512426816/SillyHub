---
author: qinyi
created_at: 2026-06-14 21:48:37
---

# Proposal — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 前置：`2026-06-14-unified-agent-execution`（daemon 唯一执行路径）

## 动机

前置变更 `unified-agent-execution` 删除了 SERVER 子进程路径，daemon 成为 agent 执行的唯一后端。但 daemon 可以注册多个 provider 的 runtime（claude / codex / hermes / gemini …），而当前系统**没有让用户表达"我想用哪个 agent"的任何机制**——既没有工作空间级的默认 agent，单次执行也无法指定 provider。结果是多 provider 环境下执行结果不可预测、不可复现。

## 关键问题（现有方案为什么不够）

1. **默认 agent 缺失，执行随机命中。**
   `placement._get_online_runtime(user_id, provider=None)` 在 provider 为空时按 `ORDER BY last_heartbeat_at DESC NULLS LAST LIMIT 1` 选 runtime。三个分发入口（`start_run` / `start_stage_dispatch` / `start_scan_dispatch`）都不传 provider。daemon 注册 claude+codex+hermes 时，谁被选中取决于谁的心跳更近——纯随机，用户无法控制。

2. **用户无法在触发时选择 agent。**
   前端 `runtimes/page.tsx` 只有监控 + QuickChat（聊天带 provider 下拉，但仅限对话，不影响真实 task/stage/scan 执行）。task / stage / scan 的触发入口完全没有 agent 选择 UI，用户无法临时指定"这次用 codex 跑"。

3. **stage 自动调度链路完全没有 provider 视角。**
   `change/dispatch.py` 的 `auto_dispatch_next_step` → `dispatch()` → `start_stage_dispatch` 是大量 stage 执行的真实路径（如 brainstorm/propose/plan/execute/verify 自动流转），调用方根本无 provider 参数。如果不把 provider 解析下沉到 `start_stage_dispatch` 内部（读 workspace.default_agent），自动调度永远随机。

## 变更范围

本次做：

- **后端模型**：`Workspace` 增 `default_agent: str | None` 列 + Alembic 迁移。
- **后端 placement**：`_get_online_runtime` 改为"provider 严格优先 + 无在线回退任意在线 + 告警"，避免静默失败。
- **后端三入口**：`start_run` / `start_stage_dispatch` / `start_scan_dispatch` 增 `provider` 参数，内部按 `显式 provider > workspace.default_agent > None` 解析后透传 `dispatch_to_daemon(provider=...)`。
- **后端 API**：`AgentRunCreate`、stage 手动 dispatch 入口、scan-generate 入口 request 增可选 `provider`；`WorkspaceCreate/Update/Read` 增 `default_agent`。
- **前端**：`workspaces.ts` 增类型 + `updateWorkspace`；workspace 设置页加"默认 Agent"下拉；task / 手动 stage dispatch / scan 触发加 agent 下拉（默认联动 workspace.default_agent）。
- **daemon**：零改动（复用已就绪的多 runtime 注册 + lease.metadata provider 传播链路）。

## 不在范围内（显式清单）

- 不做跨 workspace 的全局默认 agent。
- 不做 per-task / per-change 级别的持久 agent 偏好。
- 不改 daemon 端代码。
- 不改 `decide_backend`（只判"有无在线 runtime"，与 provider 解耦）。
- 不引入 provider 权限 / 配额 / 路由策略。
- 不做 agent_type 与 provider 的耦合映射（`agent_type="claude_code"` 是执行风格，与 provider 正交）。
- 不做 runtime 级指定（只到 provider 维度，同 provider 多 runtime 仍按心跳选）。

## 成功标准（可验证）

1. **旧配置默认行为不变**：`default_agent=NULL` 的 workspace，分发 provider 解析为 None，`_get_online_runtime` 走原 ORDER BY last_heartbeat 逻辑，结果与变更前一致。
2. **默认 agent 生效**：设 `default_agent="claude"` 且 claude 在线时，task / stage（含自动调度）/ scan 分发命中的 runtime.provider == "claude"。
3. **显式覆盖生效**：触发时显式传 `provider="codex"`（codex 在线），即使 workspace.default_agent=claude，也命中 codex。
4. **回退不失败**：指定 provider（显式或默认）无在线 runtime 时，回退到任意在线 runtime 并 `log.warning("placement_provider_fallback")`，任务仍能执行（不抛 NoOnlineDaemonError，除非完全无在线 runtime）。
5. **前端可用**：workspace 设置页能选并保存默认 agent（PATCH 成功，重新打开显示已选值）；task / stage / scan 触发面板的 agent 下拉默认显示 workspace.default_agent，可临时改选。
6. **daemon 无感知**：daemon 代码无 diff，claim payload 的 provider 来自 lease.metadata（既有链路）。
