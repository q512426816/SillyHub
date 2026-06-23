---
schema_version: 1
doc_type: module-card
module_id: lib-workflow
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-workflow

## 定位
工作流（Workflow）领域 API 客户端（`frontend/src/lib/workflow.ts`，约 78 行）。封装变更阶段流转、评审提交与查询、任务状态变更。注意 `transitionChange` 与 `lib-changes` 同名但签名/返回不同，页面实际 import 的是本模块版本。

## 契约摘要
- `transitionChange(workspaceId, changeId, targetStage, reason?, provider?, model?): Promise<TransitionResponse>` — 变更阶段流转，返回 change 数据 + agent 调度结果。
- `submitReview(workspaceId, changeId, decision, comment?): Promise<unknown>` — 提交评审（decision: approve/reject）。
- `listReviews(workspaceId, changeId): Promise<ReviewEntry[]>` — 列出评审记录。
- `transitionTask(workspaceId, taskId, status): Promise<unknown>` — 任务状态变更。
- 类型：`ReviewEntry`、`AgentDispatchResult`（dispatched/reason/stage/phase/agent_run_id/error）、`TransitionResponse`（change + agent_dispatch）。

## 关键逻辑
```
transitionChange(ws, cid, targetStage, reason?, provider?, model?):
  POST /api/workspaces/{ws}/changes/{cid}/transition
       { target_stage, reason, provider, model }
  → TransitionResponse { change: { id, status, current_stage, ... }, agent_dispatch: AgentDispatchResult | null }
submitReview(ws, cid, decision, comment?): POST .../reviews { decision, comment }
listReviews(ws, cid): GET .../reviews → ReviewEntry[]
transitionTask(ws, taskId, status): POST /api/workspaces/{ws}/tasks/{taskId}/transition { status }
```

## 注意事项
- `transitionChange` 与 `lib-changes` 中同名函数功能重叠但并非同一实现：本模块返回 `TransitionResponse`（含 agent_dispatch 详情），调用方（如 page.tsx）按需选择；修改签名需同时核对两处。
- `provider` / `model` 参数覆盖工作区默认 agent 与模型，不传走默认。
- `agent_dispatch.dispatched` 为 false 时 `reason` 字段说明未调度原因（如无待办、阶段不允许等），UI 据此提示。
- 评审 `decision` 为 approve/reject，与审批门禁 verdict 语义一致。
- 任务流转 `transitionTask` 的 status 需符合任务状态机合法迁移，后端会校验非法跳转。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
