---
author: WhaleFall
created_at: 2026-08-12T15:00:00
change: 2026-08-12-dispatch-bind-agent-profile
---

# 模块影响分析（Module Impact）— 变更详情页阶段操作区接入智能体档案

## 模块影响矩阵

| 模块 | 影响类型 | 变更文件 | 说明 |
|---|---|---|---|
| change | 接口变更 / 逻辑变更 | backend/app/modules/change/schema.py | TransitionRequest 加 agent_profile_id 字段（UUID|None，默认 None）|
| change | 接口变更 | backend/app/modules/change/service.py | transition_with_dispatch 加 agent_profile_id 参数透传 dispatch |
| change | 接口变更 / 调用关系变更 | backend/app/modules/change/dispatch.py | dispatch() + dispatch_next_step 加 agent_profile_id 参数，透传 start_stage_dispatch（形参已存在）|
| change | 接口变更 / 逻辑变更 | backend/app/modules/change/router.py | /transition /advance-stage 端点从 body 取 agent_profile_id；/dispatch 端点（manual_dispatch）加 Query 参数 |
| agent | 调用关系变更 / 逻辑变更 | backend/app/modules/agent/execution.py | dispatch_worker 补调 _apply_profile_to_lease（修 GAP-6），新增 _apply_worker_profile_to_lease helper |
| mcp_gateway | 接口变更 | backend/app/modules/mcp_gateway/tools.py | advance_change_stage MCP tool 加 agent_profile_id（R-双入口）|
| frontend | 逻辑变更 / UI 变更 | frontend/src/lib/changes.ts | TransitionRequest 类型加 agent_profile_id；triggerDispatch/advanceChangeStage 签名加 agentProfileId；worker_preset 类型改 {profile_id,...} |
| frontend | UI 变更 / 逻辑变更 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 去 stageProvider/stageModel state，加 stageProfileId；handleAdvance/handleDispatch 改传 agent_profile_id |
| frontend | UI 变更 | frontend/src/components/changes/detail/change-stage-actions.tsx | 合并两块分散 UI，改 AgentProfileSelect，加 FR-08 提示文案 |
| frontend | UI 变更 | frontend/src/components/stage-team-config.tsx | StageWorkerPreset 改 {profile_id, objective, role}，每 worker 渲染 AgentProfileSelect |
| openapi/类型 | 数据结构变更 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 重生成，TransitionRequest 含 agent_profile_id |

## 影响类型汇总

- **接口变更**：5 处（schema/service/dispatch/router/tools）——所有 dispatch 入口加 agent_profile_id 可选参数，None 零回归。
- **调用关系变更**：3 处（service→dispatch→start_stage_dispatch；execution dispatch_worker 补调 _apply_profile_to_lease）。
- **逻辑变更**：execution.py GAP-6 修复（worker 档案进 lease.metadata）。
- **UI 变更**：3 处前端组件（操作区合并 + 档案选择器 + 团队 worker 选档案）。
- **数据结构变更**：TransitionRequest 字段 + openapi/api-types 同步。

## 依赖链

```
前端档案选择 → HTTP TransitionRequest.agent_profile_id → transition_with_dispatch
  → dispatch/dispatch_next_step → start_stage_dispatch（形参已存在，复用）
  → _resolve_dispatch_profile（兜底链）→ _apply_profile_to_lease（写 lease.metadata 五键）
  → daemon claim payload（复用已实现，本变更不改 daemon）
```

## 未匹配文件

- 无（全部 17 个变更文件均映射到 change/agent/mcp_gateway/frontend 四模块）。
- 测试文件：backend test_dispatch_agent_profile.py / test_dispatch_worker_profile.py、frontend 3 个组件测试文件均随所属模块映射。

## 已知限制 / 需 review

- **system_prompt/skill/mcp 链路断**（GAP-2/3/4/5，D-004 排除）：本次选了档案 system_prompt 不生效，放下个变更。UI 已标注提示。
- **deployment-critical**：lease/agent_run 字段透传到 daemon spawn agent，端到端实测留部署后。
- **worker profile 兜底**：execution.py _apply_worker_profile_to_lease profile 查不到标 failed 不崩 mission（design §9）。
