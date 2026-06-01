---
author: qinyi
created_at: 2026-05-29 17:22:24
---

# Tasks

## 任务列表

- task-01: Workspace 数据模型收口
  - `backend/app/modules/workspace/model.py`
  - `backend/migrations/versions/202606130900_workspace_graph.py`

- task-02: Workspace schema/service/router 适配
  - `backend/app/modules/workspace/schema.py`
  - `backend/app/modules/workspace/service.py`
  - `backend/app/modules/workspace/router.py`

- task-03: WorkspaceRelation 和拓扑 API
  - `backend/app/modules/workspace/relation_schema.py`
  - `backend/app/modules/workspace/relation_service.py`
  - `backend/app/modules/workspace/topology.py`
  - `backend/app/modules/workspace/tests/test_relation_router.py`

- task-04: Projects YAML parser/scanner 迁移
  - `backend/app/modules/workspace/parser.py`
  - `backend/app/modules/workspace/scanner.py`
  - `backend/app/modules/workspace/tests/test_parser.py`
  - `backend/app/modules/workspace/tests/test_scanner.py`

- task-05: Change/Task/AgentRun 多 Workspace 关联
  - `backend/app/modules/change/schema.py`
  - `backend/app/modules/change/service.py`
  - `backend/app/modules/task/schema.py`
  - `backend/app/modules/task/service.py`
  - `backend/app/modules/agent/model.py`
  - `backend/app/modules/agent/schema.py`
  - `backend/app/modules/agent/service.py`

- task-06: AgentSpecBundle 跨 Workspace 上下文
  - `backend/app/modules/agent/context_builder.py`
  - `backend/app/modules/agent/base.py`
  - `backend/app/modules/agent/tests/test_context_builder.py`

- task-07: ScanDocs / SpecWorkspace 适配 Workspace-only 模型
  - `backend/app/modules/scan_docs/model.py`
  - `backend/app/modules/scan_docs/schema.py`
  - `backend/app/modules/scan_docs/service.py`
  - `backend/app/modules/spec_workspace/service.py`
  - `backend/app/modules/spec_workspace/bootstrap.py`

- task-08: 移除 Component 核心入口
  - `backend/app/modules/component/`
  - `backend/app/main.py`
  - `frontend/src/lib/workspaces.ts`

- task-09: 前端 Workspace Graph 入口迁移
  - `frontend/src/app/(dashboard)/workspaces/page.tsx`
  - `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx`
  - `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx`
  - `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`
  - `frontend/src/components/workspace-card.tsx`
  - `frontend/src/components/workspace-scan-dialog.tsx`

- task-10: 变更包边界文档和原型
  - `.sillyspec/changes/2026-05-28-component-as-workspace/MASTER.md`
  - `.sillyspec/changes/2026-05-28-component-as-workspace/prototype-workspace-graph.html`
  - `.sillyspec/changes/2026-05-28-component-as-workspace/prototype-change-packages.html`
