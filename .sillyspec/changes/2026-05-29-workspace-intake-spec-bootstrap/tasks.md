---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Tasks

## 任务列表

- task-01: Workspace 创建 schema 增加 spec_strategy
  - `backend/app/modules/workspace/schema.py`
  - `backend/app/modules/workspace/service.py`

- task-02: SpecWorkspace bootstrap/import/sync 服务
  - `backend/app/modules/spec_workspace/bootstrap.py`
  - `backend/app/modules/spec_workspace/service.py`

- task-03: SpecValidator 硬门禁
  - `backend/app/modules/spec_workspace/validator.py`
  - `backend/app/modules/spec_workspace/tests/test_validator.py`

- task-04: SpecWorkspace API
  - `backend/app/modules/spec_workspace/router.py`
  - `backend/app/modules/spec_workspace/schema.py`

- task-05: 前端接入流程
  - `frontend/src/lib/spec-workspaces.ts`
  - `frontend/src/components/workspace-scan-dialog.tsx`

- task-06: 契约测试和错误诊断
  - `backend/app/modules/spec_workspace/tests/`
