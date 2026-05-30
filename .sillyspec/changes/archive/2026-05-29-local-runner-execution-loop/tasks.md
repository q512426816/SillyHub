---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Tasks

## 任务列表

- task-01: Runtime 数据模型和 API
  - `backend/app/modules/runtime/model.py`
  - `backend/app/modules/runtime/router.py`

- task-02: Runner task claim 协议
  - `backend/app/modules/runtime/service.py`
  - `backend/app/modules/agent/service.py`

- task-03: Local daemon CLI
  - `runner/`

- task-04: 隔离执行环境
  - `runner/execenv/`
  - `backend/app/modules/worktree/service.py`

- task-05: Claude/Codex backend adapter
  - `backend/app/modules/agent/adapters/`
  - `runner/adapters/`

- task-06: AgentRun 日志 SSE
  - `backend/app/modules/agent/router.py`
  - `frontend/src/app/(dashboard)/workspaces/[id]/agent/`

- task-07: 结果收集和 review gate
  - `backend/app/modules/workflow/service.py`
  - `backend/app/modules/agent/service.py`
