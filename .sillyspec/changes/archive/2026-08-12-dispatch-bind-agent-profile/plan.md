---
author: WhaleFall
created_at: 2026-08-12T13:15:00
change: 2026-08-12-dispatch-bind-agent-profile
plan_level: full
tier: independent
---

# Plan: 变更详情页阶段操作区接入智能体档案

> design.md 为设计真相源，本 plan 把 tasks.md 的 15 任务按 Wave 分组 + 依赖排序 + allowed_paths + 完成标准。

## 0. 总览

| Wave | 主题 | 任务 | 并行性 |
|---|---|---|---|
| W1 | 后端单 agent 透传主链路 | task-01~04, task-05 | 纵向链，按序 |
| W2 | 后端团队模式 + MCP 双入口 | task-06, task-08, task-07 | task-06 与 W1 并行；task-08/07 串行 |
| W3 | 前端 UI 重构 | task-09~13 | task-09 先（契约），10/11/12 并行，13 测试收尾 |
| W4 | 类型同步 + 验收 | task-14, task-15 | 串行收尾 |

**关键路径**：W1（task-01→02→03→04）→ W3（task-09→10/11/12→13）→ W4（task-14→15）。W2 可与 W1/W3 并行。

**契约要点**：
- 后端 `start_stage_dispatch` 形参已存在（agent/service.py:1211/:1224），**本变更不改 agent/service.py**，只补上层透传。
- daemon 不改、无 DB 迁移、无 pnpm bundle。
- 复用已实现：`_resolve_dispatch_profile`（agent/service.py:600）、`_apply_profile_to_lease`（:638）。

**FR 覆盖映射**（requirements.md）：
- FR-01（UI 合并）/ FR-02（档案选择器）/ FR-08（gap 提示）→ task-10、task-11
- FR-03（单 agent 透传）→ task-01~04
- FR-04（不选档案零回归）→ task-05（None 路径单测）
- FR-05（团队模式档案分配）→ task-12
- FR-06（worker 透传修 GAP-6）→ task-08、task-07
- FR-07（MCP 双入口一致）→ task-06
- NFR-01（兼容性）/ NFR-02（类型同步）→ task-14、task-15

## Wave 1：后端单 agent 透传主链路（纵向，按序）

把 `agent_profile_id` 从 HTTP 入口一路透传到已存在的 `start_stage_dispatch` 形参。下层兜底链 + apply_to_lease 已实现，零重写。

- [x] task-01: TransitionRequest schema 加 agent_profile_id
- **allowed_paths**: `backend/app/modules/change/schema.py`
- **改动**：`TransitionRequest`（:202）加 `agent_profile_id: UUID | None = None`。`worker_preset`（:224 注释）每条结构从 `{agent_type, model, objective, role}` 更新注释为支持 `profile_id`（schema 本身是 `list[dict]` loose，类型不动；task-07 细化）。
- **完成标准**：`TransitionRequest` 含新字段；ruff/mypy 过；不破坏既有字段。
- **依赖**：无（链头）。

- [x] task-02: transition_with_dispatch 加参数
- **allowed_paths**: `backend/app/modules/change/service.py`
- **改动**：`transition_with_dispatch`（:722）签名加 `agent_profile_id: uuid.UUID | None = None`；透传给 `dispatch()`（:783）。
- **完成标准**：参数透传到 dispatch 调用；None 默认零回归。
- **依赖**：task-01（schema 先行才有字段概念）。

- [x] task-03: dispatch/dispatch_next_step 加参数
- **allowed_paths**: `backend/app/modules/change/dispatch.py`
- **改动**：`dispatch()`（:462）+ `dispatch_next_step`（:1270）签名加 `agent_profile_id`；两者调 `start_stage_dispatch`（:534 / :1373）时传入 `agent_profile_id=agent_profile_id`。
- **完成标准**：`start_stage_dispatch` 终于收到 run 显式 profile id（兜底链 run_profile_id 分支激活）。
- **依赖**：task-02。

- [x] task-04: router 端点透传（body + Query 双形态）
- **allowed_paths**: `backend/app/modules/change/router.py`
- **改动**：
  - `/advance-stage`（:499）、`/transition` 端点：从 body `TransitionRequest` 取 `agent_profile_id` 透传给 `transition_with_dispatch`。
  - `/dispatch`（`manual_dispatch`，:855）：**Query 参数**风格（对齐 :861-862 provider/model），新增 `agent_profile_id: uuid.UUID | None = Query(default=None)`，透传给 `dispatch()`（:882）。
- **完成标准**：三个端点都能收到并透传 agent_profile_id；HTTP 测试覆盖。
- **依赖**：task-01（body schema）+ task-02 + task-03。

- [x] task-05: 后端透传单测（W1 收尾）
- **allowed_paths**: `backend/app/modules/change/tests/`、`backend/app/modules/agent/tests/`
- **改动**：
  - dispatch 透传链路测试：前端传 agent_profile_id → 落到 start_stage_dispatch 调用参数（mock 验证）。
  - None 路径零回归：不传 agent_profile_id → 行为与今天一致（`_resolve_dispatch_profile` 无 hint 返 None）。
  - lease.metadata 含档案字段（选了档案时）。
- **完成标准**：新增测试全过；既有 dispatch 测试不回归。
- **依赖**：task-04。

## Wave 2：后端团队模式 + MCP 双入口

- [x] task-06: MCP advance_change_stage tool 加参数（可与 W1 并行）
- **allowed_paths**: `backend/app/modules/mcp_gateway/tools.py`
- **改动**：`advance_change_stage`（:966）加 `agent_profile_id` 参数，透传给 `transition_with_dispatch`（与 HTTP 入口共用 service 方法，R-双入口一致）。
- **完成标准**：MCP tool 带 agent_profile_id 生效，与 HTTP 一致；MCP tool 测试更新。
- **依赖**：task-02（service 方法先有参数）。**可与 task-03/04 并行**。

- [x] task-07: team_worker_preset 支持 profile_id（先于 task-08）
- **allowed_paths**: `backend/app/modules/change/schema.py`
- **改动**：`worker_preset`（schema.py:224）注释明确每条支持 `{profile_id, objective, role}`（向后兼容 `{agent_type, model, ...}` 旧形态）；后端消费方（OrchestratorService / execution.py）按 profile_id 优先解析。（前端 `lib/changes.ts` 的 worker 类型变更归 task-09，不在本 task。）
- **完成标准**：schema loose dict 接受 profile_id；旧 preset 不破坏。
- **依赖**：task-01。

- [x] task-08: dispatch_worker 补调 _apply_profile_to_lease（修 GAP-6）
- **allowed_paths**: `backend/app/modules/agent/execution.py`
- **改动**：`MissionExecutionService.dispatch_worker`（:153）：worker profile 按 `worker_preset[i].profile_id` 解析（复用 AgentProfileService.resolve_profile，actor=触发用户）；`dispatch_to_daemon`（:275）拿到 lease_id 后**补调** `AgentService._apply_profile_to_lease(lease_id, profile)`（本体在 `agent/service.py:638`，已实现，本 task 仅在 execution.py 调用）。profile 解析失败（被删/越权）→ `mark_worker_run_failed`（execution.py 内）+ return None（对齐 worktree 失败语义，:250）。
- **完成标准**：worker lease.metadata 含档案字段；worker profile 失败标 failed 不崩 mission；单测覆盖。
- **依赖**：task-07（profile_id 字段先有）+ W1 task-03（dispatch 已透传）。

## Wave 3：前端 UI 重构（依赖 W1 schema 定型）

- [x] task-09: 前端契约加 agent_profile_id（W3 链头）
- **allowed_paths**: `frontend/src/lib/changes.ts`
- **改动**：
  - `TransitionRequest`（:40）加 `agent_profile_id?: string | null`。
  - `advanceChangeStage`（:370）/ `triggerDispatch`（:336）签名加 `agentProfileId?: string | null` 参数，拼进 body/query。
- **完成标准**：类型导出；调用方能传 agentProfileId。
- **依赖**：W1 task-01（后端 schema 定型，类型方向一致）。

- [x] task-10: page.tsx 换档案 state
- **allowed_paths**: `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- **改动**：去 `stageProvider`/`stageModel` state（:78-79）+ `AgentProviderSelect`/`AgentModelInput` 引用；加 `stageProfileId` state；`handleAdvance`（:168）/`handleDispatch`（:132）改传 `agent_profile_id`，去 provider/model；传给 `ChangeStageActions` 的 props 改 `stageProfileId`/`onStageProfileChange`。
- **完成标准**：page 用档案 state；两 handler 传 agent_profile_id；provider/model 引用清零。
- **依赖**：task-09。

- [x] task-11: change-stage-actions 合并重构
- **allowed_paths**: `frontend/src/components/changes/detail/change-stage-actions.tsx`
- **改动**：合并推进横幅 + provider/model/触发两块为统一操作区；Props 去 `stageProvider`/`onStageProviderChange`/`stageModel`/`onStageModelChange`，加 `stageProfileId`/`onStageProfileChange`；顶部挂 `AgentProfileSelect`（workspaceId + value/onChange）；保留两按钮 onAdvance/onDispatch；档案选择器旁加提示文案「仅 provider/凭证/allowed_roots 生效，system_prompt/skill/mcp 下版本支持」（FR-08）。
- **完成标准**：UI 合并为一块；AgentProviderSelect/AgentModelInput 不再被 import；提示文案可见。
- **依赖**：task-10（Props 契约）。

- [x] task-12: stage-team-config 改选档案
- **allowed_paths**: `frontend/src/components/stage-team-config.tsx`
- **改动**：`StageWorkerPreset`（:23）从 `{agent_type, model, objective, role}` 改 `{profile_id, objective, role}`；每个 worker 行渲染 `AgentProfileSelect`（替代 agent_type/model 输入）；主 agent 加档案选择器（团队开关下方）。worker 增删交互不变。
- **完成标准**：每 worker 选档案；主 agent 选档案；增删 worker 正常。
- **依赖**：task-09（契约）+ task-10（page 传 workspaceId 给子组件）。

- [x] task-13: 前端组件测试更新
- **allowed_paths**: `frontend/src/components/changes/detail/__tests__/`、`frontend/src/components/__tests__/`
- **改动**：`change-stage-actions.test.tsx` 更新（去 provider/model 断言，加档案选择断言 + 两按钮）；`stage-team-config.test.tsx` 更新（worker 选档案）。
- **完成标准**：vitest 全过。
- **依赖**：task-11 + task-12。

## Wave 4：类型同步 + 验收（收尾）

- [x] task-14: gen:types
- **allowed_paths**: `frontend/src/lib/api-types.ts`、`backend/openapi.json`
- **改动**：后端 schema 改完 → `pnpm gen:types`（gen 前确认 node_modules 健康，CLAUDE.md 规则 20）→ 提交 `api-types.ts` + `backend/openapi.json`。
- **完成标准**：gen:types 无 error；类型与后端 schema 一致；`gen:types:check`（git diff --exit-code）通过。
- **依赖**：W1 task-01 + W3 task-09（前后端 schema 都定型）。

- [x] task-15: 模块测试 + verify
- **allowed_paths**: 只读校验，不改源码（失败回 W1~W3 修）
- **改动**：跑 change+agent+daemon 模块 pytest + frontend vitest；对照 design §8 验收标准 8 条逐项核验。
- **完成标准**：design §8 八条全过；测试不回归。
- **依赖**：W1+W2+W3 全部完成 + task-14。

## 依赖图

```
task-01 (schema)
  ├── task-02 (service) ── task-03 (dispatch) ── task-04 (router) ── task-05 (单测)
  │     └── task-06 (MCP, 并行于 03/04)
  └── task-07 (worker_preset schema) ── task-08 (dispatch_worker GAP-6)

task-09 (前端契约, 依赖 01) ── task-10 (page) ── task-11 (actions)
                          ├── task-12 (team-config)
                          └── task-13 (前端测试, 依赖 11+12)

task-14 (gen:types, 依赖 01+09)
task-15 (验收, 依赖 全部 + 14)
```

## 风险与对策（沿用 design §7）

- system_prompt/skill/mcp 本次不生效 → task-11 UI 提示文案（FR-08）+ design 非目标标注。
- worker profile 失败 → task-08 mark_worker_run_failed 兜底。
- 双入口（HTTP/MCP）漂移 → task-04 + task-06 同变更内同步改 + task-05 测试覆盖。
