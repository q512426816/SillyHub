---
schema_version: 1
doc_type: module-card
module_id: lib-changes
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更 API 客户端（lib-changes）

## 定位
变更（Change）领域 API 客户端（`frontend/src/lib/changes.ts`，611 行），前端最大 lib 模块。覆盖 SillySpec 变更的阶段流转、按需派发、gate 软调用、人工评审与归档门禁。

会话驱动化翻转（2026-08-14-change-center-conversation-driven）后符号大换血：旧 `createChange` / `executeChange` / `submitFeedback` / `getChangeApproval` / `updateChangeProgress` / `getChangeDocuments` 系列已删——创建入口并入变更列表/会话流程、文档读写移交 `lib-change-files`；当前主力符号是 `advanceChangeStage` / `runVerifyGate` / `submitStageReview` / `updateStageProfile` 等。

## 契约摘要
- 查询/重扫：
  - `listChanges(ws, params?)` — 过滤 location / status / owner / search / current_stage / sort / pending_review_only / page / page_size。
  - `getChange(ws, cid)` → `ChangeRead`（含 `pending_review` 投影字段，驱动详情页审核面板类型）。
  - `reparseChanges(ws)` — POST `.../changes/reparse`。
- 流转/推进：
  - `transitionChange(ws, cid, targetStage, reason?, provider?, model?, teamMode?, workerPreset?, mainAgentConfig?)` → `TransitionResponse`。
  - `advanceChangeStage(ws, cid, targetStage, opts?)` — POST `.../advance-stage`，body/响应与 /transition 完全对齐（共用后端 transition_with_dispatch），**按需推进主入口**。
  - `updateStageProfile(ws, cid, profileId|null)` — PATCH `.../stage-profile`，存每阶段独立 AgentProfile（null=清除跟随工作区默认）。
- 派发/状态：
  - `getAgentStatus(ws, cid)` → `DispatchResponse`（`last_dispatch` 含 `gate_status`/`gate_result`；手动 dispatch 软失败在 `dispatch_result{dispatched, reason, error}`）。
  - `triggerDispatch(ws, cid, provider?, model?, agentProfileId?)` — 三参数走 Query（对齐后端 manual_dispatch）。
  - `runVerifyGate(ws, cid)` → `VerifyGateResponse{exit_code, errors, source}`，source 为 `gate_result | gate_cmd | unavailable`（gate 软调用，不硬阻塞、不改 change 状态）。
  - `checkArchiveGate(ws, cid)` → `ArchiveGateResponse`（6 项检查，name 固定枚举）。
- 人工评审（submit_stage_review 的 HTTP 传输层，均带 `notifySession=true` 默认）：
  - `proposalReview`（decision: approve/revise/unclear）、`planReview`（approve/replan/back_to_propose/back_to_brainstorm）、`humanTest`（pass/bug/doc_mismatch）、`archiveConfirm`。
  - 统一入口 `submitStageReview(ws, cid, action, comment?, notifySession?)` — 按 11 个 action 词表分发到上述四方法；未识别 action `Promise.reject`（对齐 MCP tool 400 语义）。
  - 返回 `ReviewResponse{change, agent_dispatch, notified_session, notify_error}`。
- 退役只读：`approveChange` / `rejectChange`（旧 approval_status 链路，保留数据兼容）、`submitReview`（所打 POST /reviews 端点后端不存在，405）；存活：`listReviews`（GET /reviews）。
- 类型双轨：
  - OpenAPI 索引：ChangeSummary / ChangeRead / ChangeList / ChangeWarning / ChangeReparseStats / ChangeReparseResponse / FeedbackRequest / ArchiveCheckItem / ArchiveGateResponse / TransitionDispatchResponse。
  - **有据保留手写 shadow schema**（D-004@v2，源码注释载明理由）：`TransitionRequest`（worker_preset 精确结构 + team_mode 可选）、`TransitionResponse`（change 为精确 ChangeRead 非 loose dict）、`DispatchResult`/`DispatchResponse`（last_dispatch 精确字段）、`VerifyGateResponse`（source 精确 union）。
  - 另有 `HumanGate`（7 态 union）、`ReviewEntry`。

## 关键逻辑
```
advanceChangeStage(ws, cid, targetStage, opts?):
  body = { target_stage }; 真值才附加 reason/provider/model/agent_profile_id
  teamMode → + team_mode:true + worker_preset + main_agent_config
  POST .../advance-stage → TransitionResponse
submitStageReview(ws, cid, action, comment?, notifySession?):
  switch(action) → proposalReview/planReview/humanTest/archiveConfirm
  default → Promise.reject(unsupported review action)
```

## 注意事项
- `ReviewResponse.notified_session/notify_error` 是 D-006@v2 审批注入结果：审批落库后后端以服务身份向绑定会话注入审批消息，best-effort、失败不回滚审批（R-03）；`notify_error` 语义化（turn_conflict / session_inactive / inject_failed），UI 应展示。
- 手动 dispatch 软失败不抛 ApiError（200 OK + `dispatched:false`），必须读 `DispatchResponse.dispatch_result` 显示失败原因，handleDispatch 的 catch 拿不到。
- `transitionChange` / `advanceChangeStage` 的可选参数只在真值时附加（与后端 schema default=None 行为等价）；`worker_preset` 每项支持新形态 `{profile_id, objective, role}`（档案优先）与旧 `{agent_type, model}` 向后兼容（D-002@v2）。
- 后端 schema 变更时：优先改后端 + `pnpm gen:types` 走 OpenAPI 索引；5 个手写 shadow schema 迁移前先核对源码注释载明的调用方依赖（如 23 处 `.change.xxx` 精确字段访问、source union 的 `===` exhaustiveness）。
- `FeedbackRequest` 类型保留但已无 `submitFeedback` 函数（会话驱动化后反馈走会话消息）。
- `HumanGate` 7 态（none / need_requirement_input / need_proposal_review / need_plan_review / need_human_test / need_archive_confirm / blocked）是流转 UI 渲染门禁提示的依据。

## 人工备注

<!-- MANUAL_NOTES_START -->
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：后端砍 auto_dispatch 自动连轴，前端 `handleDispatch`/`handleAdvance` 改显式调按需推进。新增 `advanceChangeStage`（POST /advance-stage）、`runVerifyGate`（POST /run-verify-gate）+ `VerifyGateResponse` 类型（本地内联，api-types.ts 由 OpenAPI 生成不在本卡 allowed_paths）。新增 `submitStageReview` 统一审核入口分发到 proposal/plan/humanTest/archiveConfirm 四方法（D-006/FR-06）；旧 `submitReview` + `approval_status` 链路退役标注只读。`transitionChange`/`executeChange`/`triggerDispatch` 既有方法不变（后端 transition_with_dispatch 行为变按需，前端调用形态不变）。
<!-- MANUAL_NOTES_END -->
