---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-12
title: stage-team-config 改选档案
---

# task-12: stage-team-config 改选档案

- **allowed_paths**: `frontend/src/components/stage-team-config.tsx`
- **改动**：`StageWorkerPreset`（:23）从 `{agent_type, model, objective, role}` 改 `{profile_id, objective, role}`；每个 worker 行渲染 `AgentProfileSelect`（替代 agent_type/model 输入）；主 agent 加档案选择器（团队开关下方）。worker 增删交互不变。
- **完成标准**：每 worker 选档案；主 agent 选档案；增删 worker 正常。
- **依赖**：task-09（契约）+ task-10（page 传 workspaceId 给子组件）。
