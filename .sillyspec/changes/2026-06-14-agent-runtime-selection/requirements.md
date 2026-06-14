---
author: qinyi
created_at: 2026-06-14 21:48:37
---

# Requirements — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 对应 design.md §6 文件清单、§7 接口、§10 风险

## 角色

| 角色 | 说明 |
|---|---|
| 工作空间所有者 | 在 workspace 设置页配置 `default_agent`，决定该 workspace 默认用哪个 agent 执行 |
| 触发者 | 在 task / stage / scan 触发时通过下拉临时选择/覆盖 agent |
| daemon | 注册多 provider runtime、轮询 lease、按 lease.metadata 的 provider 执行（本变更不改动） |
| 系统（placement） | 按 provider 优先级解析、严格匹配、无在线回退 |

## 功能需求

### FR-01: Workspace 持久化默认 agent

Given 一个已存在的 workspace（`default_agent` 列存在，可为 NULL）
When 所有者通过 `PATCH /api/workspaces/{id}` 传 `{"default_agent": "claude"}`
Then 该 workspace 的 `default_agent` 更新为 `"claude"`，`GET /api/workspaces/{id}` 返回 `default_agent="claude"`

Given workspace 当前 `default_agent="claude"`
When 所有者 PATCH 传 `{"default_agent": null}`（显式清空）
Then `default_agent` 更新为 NULL

Given workspace 当前 `default_agent="claude"`
When 所有者 PATCH 不传 `default_agent` 字段（省略）
Then `default_agent` 保持 `"claude"` 不变（`exclude_unset=True`）

### FR-02: provider 解析优先级（三入口共用）

Given workspace.default_agent="claude"，且未在触发时显式传 provider
When 任意入口（start_run / start_stage_dispatch / start_scan_dispatch）分发
Then 透传给 `dispatch_to_daemon` 的 `provider="claude"`

Given workspace.default_agent="claude"，触发时显式传 provider="codex"
When 分发
Then 透传的 `provider="codex"`（显式 > 默认）

Given workspace.default_agent=NULL，触发时未显式传 provider
When 分发
Then 透传的 `provider=None`（维持现状，ORDER BY last_heartbeat）

### FR-03: placement 严格匹配 + 无在线回退

Given 用户有 claude（在线）、codex（在线）、hermes（在线）三个 runtime
When `_get_online_runtime(user_id, provider="claude")`
Then 返回 provider="claude" 的 runtime

Given 用户仅有 codex（在线）、hermes（在线），claude 离线
When `_get_online_runtime(user_id, provider="claude")`
Then 返回 codex 或 hermes 中一个在线 runtime（ORDER BY last_heartbeat），并 `log.warning("placement_provider_fallback", wanted="claude", actual=<选中>)`

Given 用户无任何在线 runtime
When `_get_online_runtime(user_id, provider=<任意>)`
Then 返回 None（由 `decide_backend` 抛 `NoOnlineDaemonError`，行为不变）

### FR-04: 自动调度链路自动使用默认 agent

Given workspace.default_agent="claude"，change 处于自动调度（`auto_dispatch_next_step` → `dispatch()` → `start_stage_dispatch`），调用方未传 provider
When stage 自动分发执行
Then `start_stage_dispatch` 内部读 workspace.default_agent，命中 claude（无需改 dispatch.py 自动调度入参）

### FR-05: task 触发支持显式 provider

Given 前端 task 触发面板，用户在下拉选择 "codex"
When POST `/api/workspaces/{id}/agent/runs` body 含 `"provider": "codex"`
Then `create_agent_run` 透传给 `start_run(provider="codex")`，最终命中 codex

### FR-06: 手动 stage dispatch / scan-generate 支持显式 provider

Given 前端手动重跑 stage / scan 触发面板，用户选择某 provider
When 对应 HTTP 入口收到 `provider` 字段
Then 透传到 `start_stage_dispatch` / `start_scan_dispatch`，覆盖 workspace.default_agent

### FR-07: 前端 workspace 设置页默认 agent 下拉

Given workspace 设置页打开，daemon 注册了 claude / codex / hermes（部分在线）
When 渲染"默认 Agent"下拉
Then 选项 = 在线 runtime 的 distinct provider（用 PROVIDER_META 显示 label/icon），含"未设置"选项；默认选中 workspace.default_agent

### FR-08: 前端触发面板 agent 下拉默认联动

Given workspace.default_agent="claude"
When 打开 task / stage / scan 触发面板
Then agent 下拉默认显示"claude"（或"使用默认(claude)"），用户可临时改选

## 非功能需求

- **兼容性**：所有新增 DB 列 nullable、API 字段可选；`default_agent=NULL` 时行为与变更前完全一致（FR-02 第三块、成功标准 1）。
- **可回退**：provider 回退路径保证任务不因"指定 provider 离线"而失败（除非完全无在线 runtime）；回退有日志告警（FR-03）。
- **可测试**：placement 回退、provider 解析优先级、API 透传、前端联动均有可自动化验证的 GWT（FR-01~FR-08）。
- **可观测**：回退时 structlog `placement_provider_fallback` 带 wanted/actual；lease.metadata 可追溯 provider（既有）。
- **性能**：新增列无索引需求（点查 by workspace id）；`_get_online_runtime` 回退仅多一次查询，可接受。
- **数据安全**：项目未上线、数据可清空（CLAUDE.md 规则 7），迁移无需回填默认值。
