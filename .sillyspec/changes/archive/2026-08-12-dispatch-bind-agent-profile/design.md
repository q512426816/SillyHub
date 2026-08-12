---
author: WhaleFall
created_at: 2026-08-12T09:55:00
change: 2026-08-12-dispatch-bind-agent-profile
scale: large
tier: independent
---

# Design: 变更详情页阶段操作区接入智能体档案

## 1. 背景与目标

### 1.1 现状（调研实证）

变更详情页（`workspaces/[id]/changes/[cid]/page.tsx`）的阶段操作区当前是**两个分散的 UI 块**：

- **推进横幅**：`当前阶段已完成，待触发下一阶段 / 推进到「XX」` → `onAdvance`
- **Provider/Model 行**：`AgentProviderSelect` + `AgentModelInput` + `🤖 触发智能体` → `onDispatch`

两个按钮（推进、触发）共用上方手动的 `stageProvider`/`stageModel`。底层 `dispatch()` → `AgentService.start_stage_dispatch(provider, model, prompt_template)`，provider/model 是两个平铺参数，**无档案概念**。

下层档案基建其实已经接好（前序变更产出，本变更复用）：

- `AgentService.start_stage_dispatch` **已有 `agent_profile_id` 形参**（`agent/service.py:1211`，task-06 §8 留的口子）。
- `_resolve_dispatch_profile`（`agent/service.py:600`）**兜底链已实现**：run 显式 → workspace.default_agent_profile_id → None。无 hint 时零 SQL 查询直接 None（C-07 零回归）。
- `_apply_profile_to_lease`（`agent/service.py:638`）**已实现**：把 mcp_refs / skill_refs / effective_allowed_roots / profile_version / llm_provider_id 写进 `lease.metadata`。
- daemon claim payload（`daemon/lease/context.py:build_claim_payload`）**已会读**这些 metadata 字段 → 注入 provider_config env / 透传 mcp/skill/effective_allowed_roots。
- `AgentProfileSelect` 前端组件**已 drop-in 就绪**（`agent-profile-select.tsx`），目前在「任务详情页」用，变更详情页未接。

### 1.2 缺口（本变更要补的）

| 缺口 | 现状 | 影响 |
|---|---|---|
| **GAP-1** stage dispatch 上层无 `agent_profile_id` 入参 | HTTP `TransitionRequest` / `ChangeService.transition_with_dispatch` / `change/dispatch.py::dispatch()` / `dispatch_next_step` 全无此参数；`MCP advance_change_stage` tool 同 | 前端选了档案到不了 service |
| **GAP-6** team worker 派发不调 `_apply_profile_to_lease` | `MissionExecutionService.dispatch_worker`（`execution.py`）调 `dispatch_to_daemon` 但从不调 `_apply_profile_to_lease` | 团队 worker 即使绑了档案，mcp/skill/凭证也进不了 lease |
| **前端** 操作区分散 + 无档案选择器 | 两块独立 UI，手动 provider/model | 交互割裂，档案选不了 |

### 1.3 目标

1. **UI 合并**：把推进横幅 + provider/model/触发智能体两块合并成统一操作区，去掉手动 provider/model 输入框，改为「智能体档案」选择器；保留两个按钮（推进、触发当前）。
2. **档案透传**：选了档案 → `agent_profile_id` 经 HTTP → service → dispatch → `start_stage_dispatch`（复用兜底链 + `_apply_profile_to_lease`）→ lease.metadata → daemon claim。
3. **团队模式**：主 agent + 每个 worker 各选一个档案；worker_preset 加 `profile_id`，`dispatch_worker` 补调 `_apply_profile_to_lease`（修 GAP-6）。
4. **可选**：不选档案 → 走现有默认（`_resolve_dispatch_profile` 无 hint 返 None 零回归）。

### 1.4 非目标（明确排除，放下个变更）

- **system_prompt 注入链路修复**（GAP-2/3）：stage run 的 claude_md 被清空 + daemon 未写 CLAUDE.md → 档案 system_prompt 本次**选了也不生效**。这是档案核心价值，但链路修复涉及 daemon TS 改动 + pnpm bundle + 重建，范围过大，拆下个变更紧接做。
- **skill_refs / mcp_refs interactive 路径修复**（GAP-4/5）：interactive session（stage run 走的路径）不裁剪 skill_refs、不注入 mcp_refs。本次只保证 metadata 写进 lease（下游 claim 读得到），interactive 路径的生效修复放下个变更。
- **MCP `dispatch_worker` tool**：已有 `agent_profile_id`（`agent/mcp_tools.py`），不在本变更范围。

## 2. 方案设计（方案 B：全透传，选定）

### 2.1 后端透传链路（单 agent）

复用现有下层基建，**只补上层透传**（6 处加 `agent_profile_id` 参数）：

```
前端 advanceChangeStage({agent_profile_id})
  → HTTP POST /advance-stage body.agent_profile_id          [新增字段]
  → TransitionRequest schema 加 agent_profile_id             [改 schema.py]
  → ChangeService.transition_with_dispatch(agent_profile_id=) [加参数]
  → change/dispatch.py::dispatch(agent_profile_id=)          [加参数]
  → AgentService.start_stage_dispatch(agent_profile_id=)     [形参已存在, 终于收到值]
  → _resolve_dispatch_profile(run_profile_id=agent_profile_id) [已实现兜底链]
  → _apply_profile_to_lease(lease_id, profile)                [已实现, 写 mcp/skill/凭证/allowed_roots]
```

手动派发路径（`POST /dispatch` → `handleDispatch`）同理加 `agent_profile_id` 透传，保证两个按钮一致。

`MCP advance_change_stage` tool（`mcp_gateway/tools.py:966`）同步加 `agent_profile_id` 参数，与 HTTP 入口共用 `transition_with_dispatch`，保持双入口一致（R-双入口）。

### 2.2 团队模式档案透传

**主 agent**：现有 `team_main_agent_config` 是 `{agent_type, provider, model}`。改为携带 `profile_id`（或整体替换为 profile 引用），`OrchestratorService.team_mission_entry` 解析后，主 agent run 经 `start_stage_dispatch` 同款路径绑档案。

**worker**：`StageWorkerPreset` 加 `profile_id` 字段（替换 `agent_type`/`model` 手动字段）。`team_worker_preset` 落 `change.stages` 后，`MissionExecutionService.dispatch_worker`（`execution.py`）在调 `dispatch_to_daemon` 创建 lease 后，**补调 `_apply_profile_to_lease(lease_id, profile)`**（修 GAP-6）。worker profile 按 `worker_preset[i].profile_id` 解析。

**worker profile 解析**：复用 `AgentProfileService.resolve_profile`（归属校验 + 可见域），actor = 触发用户。失败（档案被删/越权）→ 标 worker run failed + return None（对齐现有 worktree 创建失败的 `mark_worker_run_failed` 语义，design §9 不崩 mission）。

### 2.3 前端 UI 重构（方案 A：仅档案，选定）

`change-stage-actions.tsx` 合并重构：

- **去掉**：`stageProvider`/`stageModel` state、`AgentProviderSelect`/`AgentModelInput` 组件、那行「Agent provider（阶段流转/手动派发时生效）」文案。
- **新增**：`AgentProfileSelect`（workspaceId + value/onChange），挂在合并后的统一操作区顶部。
- **保留两按钮**：`推进到「XX」`（`onAdvance`）、`🤖 触发智能体`（`onDispatch`），共用档案选择。
- **新增 state**：`stageProfileId`（替代 stageProvider/stageModel）。
- `handleAdvance`/`handleDispatch` 改传 `agent_profile_id`，不再传 provider/model。
- 团队模式（`StageTeamConfig`）：`StageWorkerPreset` 改为 `{profile_id, objective, role}`，每个 worker 渲染一个 `AgentProfileSelect`；主 agent 档案选择器在团队开关下方。

`TransitionRequest`（前端手写契约）加 `agent_profile_id?: string | null`，去掉/保留 `provider`/`model` 字段——**保留字段但 UI 不再填**（后端 schema 仍接受，向后兼容；后续可清）。

## 3. 生命周期契约表（lease + agent_run 字段透传）

本变更**不新增生命周期事件、不改变状态机**，仅改 `agent_profile_id` 字段在现有事件 payload 中的取值（前端选择 → dispatch → lease.metadata）。lease（batch）与 session（interactive）事件×状态及字段流转：

### 3.1 lease（batch，含 worker）状态机 × agent_profile_id 流转

| 事件 | 方向 | payload 含 profile? | 改写点 |
|---|---|---|---|
| stage dispatch 创建 run | 前端→backend | 是：`TransitionRequest.agent_profile_id` | **新增** HTTP body 字段 |
| transition_with_dispatch | backend 内部 | 是：形参透传 | **新增** agent_profile_id 参数 |
| `dispatch()` / `dispatch_next_step` | backend 内部 | 是：传给 start_stage_dispatch | **新增** agent_profile_id 参数 |
| start_stage_dispatch | backend 内部 | 是：`_resolve_dispatch_profile` 解析 | 复用已实现兜底链 |
| lease 创建后 `_apply_profile_to_lease` | backend→DB lease.metadata | 是：mcp_refs/skill_refs/effective_allowed_roots/profile_version/llm_provider_id | **复用已实现**（worker 路径 GAP-6 补调用）|
| lease claim payload | backend→daemon | 是：build_claim_payload 读 metadata | **复用已实现** |
| daemon spawn agent | daemon 侧 | provider_config env / mcp / skill / allowed_roots 生效；**system_prompt 本次不生效**（已知 gap） | 本变更不改 daemon |

### 3.2 session（interactive，stage run 实际走这条）

| 事件 | 方向 | payload 含 profile? | 备注 |
|---|---|---|---|
| session create | backend→daemon | execPayload 带 provider_config / mcp_refs / skill_refs（claim payload 透传） | **interactive 路径 skill/mcp 实际不生效**（GAP-4/5，非目标）|

### 3.3 字段契约

- `agent_profile_id` 字段语义：**单次 dispatch 入参，不持久化到 change**（每次操作单独选；刷新/下次操作要重选）。`AgentRun.agent_profile_id` + `agent_profile_snapshot` 仍照旧冻结（已实现）。
- 无 `agent_profile_id`（未选档案）→ `transition_with_dispatch` 传 None → `_resolve_dispatch_profile` 无 hint 返 None → dispatch 走 `workspace.default_agent`，与今天 100% 一致（C-07 零回归）。
- 生命周期契约：本变更不新增 lease/session 生命周期事件，仅给现有 dispatch→lease→claim 链路增加 `agent_profile_id` 入口字段。

## 4. 决策记录

### D-001@v1：agent_profile_id 透传 vs 持久化到 change
- type: architecture / status: accepted / source: user
- question: 档案选择的作用域？
- answer: **每次操作单独选**（dispatch 入参），不持久化到 change 记录。选了带到这次 dispatch；不选走默认。
- evidence: 用户对话「在一个 change 的不同流程阶段都要自己选择一下，不选就默认」。

### D-002@v1：UI 方案 A（仅档案）vs B（档案+手动框）
- type: ui / status: accepted / source: user+prototype
- question: provider/model 手动选择能力是否保留？
- answer: **方案 A，仅档案选择器**，去掉手动 provider/model 输入框。选档案→provider/model/凭证/allowed_roots 全由档案定；不选→工作区默认。
- evidence: prototype-option-a/b 对比，用户选 A。

### D-003@v1：后端方案 B（全透传）vs A（仅单 agent）vs C（预埋 system_prompt）
- type: architecture / status: accepted / source: user+code
- question: 后端透传范围？
- answer: **方案 B**，单 agent + 团队（主 agent/每 worker）全透传，复用现有下层基建，daemon 不改。
- risk: worker 派发链路（execution.py）要补 `_apply_profile_to_lease` 调用（GAP-6）。
- evidence: agent/service.py:600/638 已实现兜底链 + apply_to_lease。

### D-004@v1：system_prompt/skill/mcp 断链修复排除
- type: scope / status: accepted / source: user
- question: 档案 system_prompt/skill/mcp 注入链路断（GAP-2/3/4/5）要不要一并修？
- answer: **排除**，放下个变更紧接做。本次选了档案后 system_prompt/skill/mcp **不生效**（链路断），文档与 UI 明确标注已知 gap；生效字段 = provider/model/llm_provider_id 凭证 / allowed_roots_overlay。
- evidence: 用户确认「本次只透传+UI，prompt 下个变更修」。

### D-005@v1：团队模式档案分配
- type: ui / status: accepted / source: user
- question: 团队模式主 agent / worker 档案怎么分？
- answer: **主 agent 选一个档案 + 每个 worker 各选一个档案**，对齐现有 StageTeamConfig 逐 worker 配置交互。worker 增删/数量交互不变。
- evidence: 用户「现在的模式不变（添加多个）但是选择从手动调整为选档案」+「主 agent + 每 worker 各选档案」。

## 5. 文件变更清单

### 后端（Python）
- backend/app/modules/change/schema.py
- backend/app/modules/change/service.py
- backend/app/modules/change/dispatch.py
- backend/app/modules/change/router.py
- backend/app/modules/agent/execution.py
- backend/app/modules/mcp_gateway/tools.py
- backend/app/modules/change/tests/test_dispatch_agent_profile.py
- backend/app/modules/agent/tests/test_dispatch_worker_profile.py

### 前端（TS）
- frontend/src/lib/changes.ts
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
- frontend/src/components/changes/detail/change-stage-actions.tsx
- frontend/src/components/stage-team-config.tsx
- frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
- frontend/src/components/__tests__/stage-team-config.test.tsx

### OpenAPI / 类型
- backend/openapi.json
- frontend/src/lib/api-types.ts

> 不改：agent/service.py（start_stage_dispatch 形参已存在）、_resolve_dispatch_profile、_apply_profile_to_lease、daemon 任何代码。改动语义见 §2 方案设计。

## 6. 兼容策略（brownfield）

- **零回归**：`agent_profile_id=None`（未选档案）路径与今天 100% 一致——`_resolve_dispatch_profile` 无 hint 零 SQL 返 None（C-07），`transition_with_dispatch` None 透传不触发 profile 分支。
- **前端旧调用方**：`advanceChangeStage` 新增参数可选，既有调用（无 agentProfileId）不破坏。
- **MCP 双入口**：HTTP / MCP tool 同步加参数，不出现 HTTP 支持档案而 MCP 不支持的割裂。
- **数据**：无 DB schema 变更、无迁移。

## 7. 风险登记

| 风险 | 对策 |
|---|---|
| 用户以为选了档案 system_prompt 就生效，实际不生效（GAP-2/3） | UI 档案选择器旁明确提示「本次仅 provider/凭证/技能配置生效，system_prompt 下版本支持」；design 非目标章节 + change README 标注 |
| **主 agent** profile 解析失败（档案被删/越权/不可见） | `start_stage_dispatch` 的 `_resolve_dispatch_profile` 经 `AgentProfileService.resolve_profile` 归属/可见域校验，失败时按现有兜底链降级（run 显式失效 → workspace 默认 → None）；service.py 现有 catch 保留，不阻塞 dispatch，profile=None 走默认路径 |
| **worker** profile 解析失败（档案被删/越权）拖垮 mission | `dispatch_worker` 失败标 worker run failed + return None，主 agent 决策补派（对齐 worktree 失败语义）|
| interactive 路径 skill/mcp 不生效（GAP-4/5）让用户困惑 | 本次明确不修，非目标；下个变更做 |
| `team_worker_preset` schema 放宽影响旧数据 | 字段为可选新增，旧 preset（带 agent_type/model）仍能读，兼容 |
| 双入口（HTTP/MCP）参数漂移 | 同一变更内同步改，加测试覆盖 |

## 8. 验收标准

1. 变更详情页操作区合并为一块：档案选择器 + 推进/触发两按钮（手动 provider/model 框已去）。
2. 不选档案点推进/触发 → 行为与今天一致（workspace.default_agent）。
3. 选档案点推进 → 新 lease 的 `lease.metadata` 含该档案的 mcp_refs/skill_refs/effective_allowed_roots/profile_version/llm_provider_id；agent_run.agent_profile_snapshot 冻结正确。
4. 团队模式勾开 → 主 agent + 每 worker 各能选档案；worker lease.metadata 含对应档案字段（GAP-6 修复）。
5. MCP `advance_change_stage` 带 agent_profile_id → 同 HTTP 一致生效。
6. gen:types 通过，api-types.ts / openapi.json 提交。
7. 后端 pytest（change+agent+daemon 模块）不回归；前端组件测试更新通过。
8. **FR-08**：UI 档案选择器旁可见「仅 provider/凭证/allowed_roots 生效，system_prompt/skill/mcp 下版本支持」提示文案（screenshot/grep 校验）。

## 9. 自审（Self-Review）

按 brainstorm step 11：
- ✅ 需求覆盖：UI 合并 / 档案透传 / 团队模式 / 可选默认 四点全覆盖。
- ✅ 决策闭环：D-001~D-005 全部对应澄清结论。
- ✅ 非目标清晰：system_prompt/skill/mcp 断链明确排除（§1.4）。
- ✅ 零回归：None 路径 C-07 保护（§6）。
- ✅ 文件清单：backend 7 处 + frontend 5 处 + gen:types（§5）。
- ✅ 生命周期契约表：§3 lease/session 字段透传矩阵。
- ✅ 风险登记：§7。
- ⚠️ 已知 gap：system_prompt/skill/mcp 本次不生效，UI + 文档双重标注（D-004）。
