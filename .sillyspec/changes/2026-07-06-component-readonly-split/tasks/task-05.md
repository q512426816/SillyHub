---
id: task-05
title: 删 relation 模型/service/schema + topology 退化
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@V1]
allowed_paths:
  - backend/app/modules/workspace/relation_service.py
  - backend/app/modules/workspace/relation_schema.py
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/topology.py
goal: >
  彻底删除关系功能层（D-004）：删 relation_service/relation_schema 文件、删 WorkspaceRelation 模型、topology 退化为只返回项目组节点无边。
implementation:
  - 删除文件：`relation_service.py`、`relation_schema.py`
  - `model.py:159-198` 删除 `WorkspaceRelation` 模型类（表本身由 task-12 migration DROP，这里只删 ORM 类）
  - `topology.py` 退化为：只返回项目组节点（从 workspaces 表读 component_key IS NULL 行），edges 恒为空数组，移除 relations 读取
  - 检查 parser.py：relations 解析段（`:217-231, :288-350`）可保留（catalog 不消费）或一并删，按 task-01 清单决定，避免遗留死代码
acceptance:
  - `grep WorkspaceRelation backend/app` 仅在 migration 历史或注释中命中，无运行时引用
  - GET /workspaces/topology 返回 `{nodes: [...项目组], edges: []}`
  - backend import 无破损（无 relation_service/relation_schema 引用残留）
verify:
  - cd backend && python -c "from app.modules.workspace import model, topology"
  - cd backend && python -m pytest tests/modules/workspace/ -q
constraints:
  - 表 `workspace_relations` 的 DROP 留给 task-12 migration，本任务不写 DDL
  - topology 保留页面入口（隐藏与否由 task-10 前端定）
  - 删模型前确认 task-01 清单无运行时引用
---

