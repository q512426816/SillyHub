---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-10
title: page.tsx 换档案 state
---

# task-10: page.tsx 换档案 state

- **allowed_paths**: `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- **改动**：去 `stageProvider`/`stageModel` state（:78-79）+ `AgentProviderSelect`/`AgentModelInput` 引用；加 `stageProfileId` state；`handleAdvance`（:168）/`handleDispatch`（:132）改传 `agent_profile_id`，去 provider/model；传给 `ChangeStageActions` 的 props 改 `stageProfileId`/`onStageProfileChange`。
- **完成标准**：page 用档案 state；两 handler 传 agent_profile_id；provider/model 引用清零。
- **依赖**：task-09。
