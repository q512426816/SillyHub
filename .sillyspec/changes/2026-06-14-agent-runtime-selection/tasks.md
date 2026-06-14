---
author: qinyi
created_at: 2026-06-14 21:48:37
---

# Tasks — Agent Runtime Selection

> 变更：`2026-06-14-agent-runtime-selection`
> 仅列任务名 + 对应文件路径；任务细节、依赖、验收在 plan 阶段展开。
> 对应 design.md §6 文件清单。

## Phase 1 — 后端核心（模型 + placement + 三入口）

- **T1** 数据模型 + 迁移：`Workspace.default_agent` 列
  - `backend/app/modules/workspace/model.py`
  - `backend/app/migrations/versions/202606141200_add_workspace_default_agent.py`

- **T2** placement provider 严格优先 + 无在线回退 + 告警
  - `backend/app/modules/agent/placement.py`（`_get_online_runtime`）

- **T3** 三入口 provider 解析（显式 > workspace.default_agent > None）并透传 dispatch_to_daemon
  - `backend/app/modules/agent/service.py`（`start_run` / `start_stage_dispatch` / `start_scan_dispatch`）

## Phase 2 — 后端 API 契约

- **T4** workspace schema 增 default_agent（Create/Update/Read）
  - `backend/app/modules/workspace/schema.py`

- **T5** AgentRunCreate + create_agent_run 透传 provider
  - `backend/app/modules/agent/schema.py`
  - `backend/app/modules/agent/router.py`

- **T6** stage 手动 dispatch 入口支持 provider
  - `backend/app/modules/change/dispatch.py`（`dispatch()` / `dispatch_next_step()`）
  - 对应 stage 手动 dispatch 的 HTTP 入口 + request schema

- **T7** scan-generate 入口支持 provider（⚠️ plan 阶段先确认 request schema 字段名与注入点，R-05）
  - scan-generate service / request schema
  - `backend/app/modules/agent/service.py`（`start_scan_dispatch` 入参，T3 已覆盖）

## Phase 3 — 前端

- **T8** workspaces.ts：Workspace 接口增 default_agent + 新增 updateWorkspace（PATCH）
  - `frontend/src/lib/workspaces.ts`

- **T9** provider 下拉共享组件（复用 PROVIDER_META + listDaemonRuntimes）
  - `frontend/src/components/AgentProviderSelect.tsx`（或就近内联）

- **T10** workspace 设置页：默认 Agent 下拉 + 保存
  - `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（或设置子页）

- **T11** task 触发面板：agent 下拉（默认联动 workspace.default_agent）
  - `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/**`

- **T12** stage 手动 dispatch + scan 触发：agent 下拉
  - stage 手动 dispatch UI（change 详情 / dispatch 入口）
  - scan 触发 UI（scan-docs / scan-generate 入口）

## Phase 4 — 验证

- **T13** 后端测试：placement 回退、provider 解析优先级、三入口透传、API schema（对照 requirements.md FR-01~FR-06）
- **T14** 前端测试 / 手动验收：默认 agent 保存、触发下拉联动（对照 FR-07~FR-08）
- **T15** 端到端：多 provider 环境（claude+codex+hermes）下 default_agent 命中、显式覆盖、离线回退全链路（对照成功标准 1~6）

---

> daemon 无任务（零改动，D7）。
