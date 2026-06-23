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
- 反馈：`submitFeedback(workspaceId, changeId, category, text)`（触发后端自动返工决策）。
- 归档门禁：`checkArchiveGate(workspaceId, changeId)` → `ArchiveGateResponse`。
- Agent 调度：`getAgentStatus`、`triggerDispatch(...)`。
- 人工审批 4 节点：`proposalReview` / `planReview` / `humanTest` / `archiveConfirm`。

## 关键逻辑
```
transitionChange(ws, cid, targetStage, reason?, provider?, model?):
  POST /api/workspaces/{ws}/changes/{cid}/transition { target_stage, reason, provider, model }
  → { change: {...}, agent_dispatch: { dispatched, agent_run_id, ... } }
executeChange(ws, changeKey, provider?):
  POST .../execute { provider }  # provider 覆盖 workspace 默认 agent
proposalReview/planReview/humanTest/archiveConfirm:
  对应 SillySpec 4 个审批门禁节点的 verdict/comment 提交
checkArchiveGate: GET → 归档前校验所有 gate item 是否通过
```

## 注意事项
- 接口数量多（20+），后端 schema 变更需同步本模块类型；`ChangeSummary` / `ChangeRead` 字段较密集，新增字段注意区分必填与可选。
- `transitionChange` / `executeChange` / `triggerDispatch` 的 `provider?` 参数用于覆盖工作区 `default_agent`，传则用、不传走默认。
- `HumanGate` 类型定义了 7 种人工门禁状态，是流转 UI 渲染门禁提示的依据。
- 人工审批 4 接口分别对应 SillySpec 的 proposal/plan/human-test/archive 四个评审节点，verdict 为 approve/reject。
- `submitFeedback` 后端会据 category 自动决定返工目标阶段，前端无需手动算 target_stage。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
