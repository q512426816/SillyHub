---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-09
title: 前端契约加 agent_profile_id（W3 链头）
---

# task-09: 前端契约加 agent_profile_id（W3 链头）

- **allowed_paths**: `frontend/src/lib/changes.ts`
- **改动**：
  - `TransitionRequest`（:40）加 `agent_profile_id?: string | null`。
  - `advanceChangeStage`（:370）/ `triggerDispatch`（:336）签名加 `agentProfileId?: string | null` 参数，拼进 body/query。
- **完成标准**：类型导出；调用方能传 agentProfileId。
- **依赖**：W1 task-01（后端 schema 定型，类型方向一致）。
