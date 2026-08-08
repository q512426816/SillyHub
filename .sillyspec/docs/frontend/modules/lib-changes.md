---
schema_version: 1
doc_type: module-card
module_id: lib-changes
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-changes

## 定位
变更（Change）领域 API 客户端（`frontend/src/lib/changes.ts`，约 478 行）。前端最大的 lib 模块，覆盖 SillySpec 变更从创建、执行、阶段流转、人工审批到归档门禁的完整生命周期。是变更/任务看板/审批等页面的核心数据层。

## 契约摘要
- CRUD：`listChanges(workspaceId, query?)`、`getChange(workspaceId, changeId)`、`createChange(workspaceId, input)`。
- 文档：`getChangeDocuments`（文档矩阵）、`getChangeDocumentContent`（单文档正文）、`reparseChanges`。
- 审批：`getChangeApproval`、`approveChange(workspaceId, changeKey, approvedBy)`、`rejectChange(workspaceId, changeKey, reason)`。
- 进度/执行：`updateChangeProgress`、`executeChange(workspaceId, changeKey, provider?)`（创建 AgentRun 后台执行）。
- 流转：`transitionChange(workspaceId, changeId, targetStage, reason?, provider?, model?)` → `TransitionResponse`（含 change + agent_dispatch）。
- 按需推进（2026-08-08-change-center-on-demand 起取代自动连轴）：`advanceChangeStage(workspaceId, changeId, targetStage, opts?)` → `POST /changes/{cid}/advance-stage`（handleDispatch 走此入口，body/响应与 /transition 对齐，共用 transition_with_dispatch）；`runVerifyGate(workspaceId, changeId)` → `POST /changes/{cid}/run-verify-gate` 返回 `VerifyGateResponse{exit_code, errors, source}`（gate 软调用，不硬阻塞）。
- 反馈：`submitFeedback(workspaceId, changeId, category, text)`（触发后端自动返工决策）。
- 归档门禁：`checkArchiveGate(workspaceId, changeId)` → `ArchiveGateResponse`。
- Agent 调度：`getAgentStatus`、`triggerDispatch(...)`。
- 人工审批 4 节点：`proposalReview` / `planReview` / `humanTest` / `archiveConfirm`（分别对应后端 4 个 review 端点，作 submit_stage_review 语义的 HTTP 传输层）。
- 审核统一入口：`submitStageReview(workspaceId, changeId, action, comment?)` — 按 action 词表（proposal_approve / plan_replan / test_pass / archive_confirm 等）分发到上述 4 方法；changes 详情页 gate 面板审核一律走本方法（D-006 / FR-06）。旧 `submitReview` + `approval_status` 链路退役只读，不再驱动推进。

## 关键逻辑
```
transitionChange(ws, cid, targetStage, reason?, provider?, model?):
  POST /api/workspaces/{ws}/changes/{cid}/transition { target_stage, reason, provider, model }
  → { change: {...}, agent_dispatch: { dispatched, agent_run_id, ... } }
advanceChangeStage(ws, cid, targetStage, opts?):  # 形态A 按需推进（handleDispatch 走此）
  POST .../advance-stage { target_stage, reason?, provider?, model?, team_mode?, ... }
  → TransitionResponse（与 /transition 对齐，共用 transition_with_dispatch）
runVerifyGate(ws, cid):  # gate 软调用三态，不硬阻塞
  POST .../run-verify-gate → { exit_code, errors, source: gate_result|gate_cmd|unavailable }
executeChange(ws, changeKey, provider?):
  POST .../execute { provider }  # provider 覆盖 workspace 默认 agent
submitStageReview(ws, cid, action, comment?):  # 统一审核入口，按 action 分发
  → proposalReview/planReview/humanTest/archiveConfirm（4 节点 HTTP 传输层）
checkArchiveGate: GET → 归档前校验所有 gate item 是否通过
```

## 注意事项
- 接口数量多（20+），后端 schema 变更需同步本模块类型；`ChangeSummary` / `ChangeRead` 字段较密集，新增字段注意区分必填与可选。
- `transitionChange` / `executeChange` / `triggerDispatch` 的 `provider?` 参数用于覆盖工作区 `default_agent`，传则用、不传走默认。
- `HumanGate` 类型定义了 7 种人工门禁状态，是流转 UI 渲染门禁提示的依据。
- 人工审批 4 接口分别对应 SillySpec 的 proposal/plan/human-test/archive 四个评审节点，verdict 为 approve/reject。
- `submitFeedback` 后端会据 category 自动决定返工目标阶段，前端无需手动算 target_stage。
- **形态A 按需触发**（2026-08-08-change-center-on-demand）：后端砍 auto_dispatch 自动连轴，stage 完成停「待触发」态；`handleDispatch`/`handleAdvance` 改显式调 `advanceChangeStage`（advance-stage HTTP）推进，不再依赖自动连轴。`runVerifyGate` 作 gate 软调用（结果交调用方决策，不硬阻塞）。
- 审核链路收敛：详情页 gate 面板审核动作统一走 `submitStageReview`（D-006 / FR-06）；旧 `submitReview`（POST /reviews 端点实际不存在，405）+ `approval_status` 通用 verdict 链路退役只读，`approveChange`/`rejectChange`/`submitReview` 仅保留供历史调用方兼容，不再驱动推进。

## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：后端砍 auto_dispatch 自动连轴，前端 `handleDispatch`/`handleAdvance` 改显式调按需推进。新增 `advanceChangeStage`（POST /advance-stage）、`runVerifyGate`（POST /run-verify-gate）+ `VerifyGateResponse` 类型（本地内联，api-types.ts 由 OpenAPI 生成不在本卡 allowed_paths）。新增 `submitStageReview` 统一审核入口分发到 proposal/plan/humanTest/archiveConfirm 四方法（D-006/FR-06）；旧 `submitReview` + `approval_status` 链路退役标注只读。`transitionChange`/`executeChange`/`triggerDispatch` 既有方法不变（后端 transition_with_dispatch 行为变按需，前端调用形态不变）。
<!-- MANUAL_NOTES_END -->
