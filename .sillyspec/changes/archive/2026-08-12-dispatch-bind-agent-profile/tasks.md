---
author: WhaleFall
created_at: 2026-08-12T09:55:00
change: 2026-08-12-dispatch-bind-agent-profile
---

# Tasks: 变更详情页阶段操作区接入智能体档案

> 详细 Wave 分组 + 依赖在 plan.md（下一阶段产出）。本文件为任务清单概览。

## 后端

- [ ] task-01: `TransitionRequest` schema 加 `agent_profile_id: UUID | None` 字段（`change/schema.py`；注：无 DispatchRequest 类，`/dispatch` 端点用 Query 参数，见 task-04）
- [ ] task-02: `ChangeService.transition_with_dispatch` 加 `agent_profile_id` 参数，透传给 `dispatch()`
- [ ] task-03: `change/dispatch.py` 的 `dispatch()` + `dispatch_next_step` 加 `agent_profile_id` 参数，透传给 `start_stage_dispatch`（形参已存在）
- [ ] task-04: `change/router.py` 的 `/advance-stage` `/transition` 端点从 body（TransitionRequest）取 `agent_profile_id`；`/dispatch` 端点（manual_dispatch）新增 `agent_profile_id: UUID | None = Query(default=None)` 同款透传
- [ ] task-05: `mcp_gateway/tools.py` 的 `advance_change_stage` MCP tool 加 `agent_profile_id` 参数
- [ ] task-06: `agent/execution.py` 的 `dispatch_worker` 加 worker profile 解析 + 创建 lease 后补调 `_apply_profile_to_lease`（修 GAP-6，worker 失败标 failed 不崩 mission）
- [ ] task-07: `team_worker_preset` schema/类型放宽支持 `profile_id` 字段（兼容旧 agent_type/model）
- [ ] task-08: 后端单测——dispatch 透传链路、worker profile 失败兜底、None 路径零回归

## 前端

- [ ] task-09: `lib/changes.ts` 的 `TransitionRequest` 加 `agent_profile_id?: string | null`；`advanceChangeStage` / `triggerDispatch` 签名加 `agentProfileId`
- [ ] task-10: `page.tsx` 去 `stageProvider`/`stageModel` state + `AgentProviderSelect`/`AgentModelInput`；加 `stageProfileId` + `AgentProfileSelect`；改 `handleAdvance`/`handleDispatch` 传 agent_profile_id
- [ ] task-11: `change-stage-actions.tsx` 合并两块 UI，Props 改 `stageProfileId`/`onStageProfileChange`，去 provider/model Props，加「仅 provider/凭证生效，system_prompt 下版本」提示
- [ ] task-12: `stage-team-config.tsx` 的 `StageWorkerPreset` 改 `{profile_id, objective, role}`，每 worker 渲染 `AgentProfileSelect`；主 agent 档案选择器
- [ ] task-13: 前端组件测试更新（change-stage-actions / stage-team-config）

## 类型与验收

- [ ] task-14: `pnpm gen:types` + 提交 `api-types.ts` + `backend/openapi.json`
- [ ] task-15: 模块测试（change+agent+daemon pytest + frontend vitest）不回归；verify
