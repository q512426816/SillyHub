---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Tasks

## 任务列表

- task-01: 控制面 router 挂载
  - `backend/app/main.py`

- task-02: Workflow 状态机收口
  - `backend/app/modules/workflow/fsm.py`
  - `backend/app/modules/workflow/service.py`
  - `backend/app/modules/workflow/router.py`

- task-03: Spec Guardian 执行门禁
  - `backend/app/modules/workflow/spec_guardian.py`

- task-04: Policy Engine
  - `backend/app/modules/policy/`
  - `backend/app/modules/tool_gateway/service.py`

- task-05: AuditLog
  - `backend/app/modules/audit/`
  - `backend/app/modules/git_gateway/service.py`
  - `backend/app/modules/tool_gateway/service.py`

- task-06: 前端控制面入口
  - `frontend/src/lib/workflow.ts`
  - `frontend/src/lib/approvals.ts`
  - `frontend/src/lib/audit.ts`
