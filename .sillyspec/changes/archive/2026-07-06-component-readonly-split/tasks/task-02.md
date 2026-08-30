---
id: task-02
title: 新建 component_catalog_service（只读组件目录）
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@V1]
allowed_paths:
  - backend/app/modules/workspace/component_catalog_service.py
goal: >
  新建只读组件目录 service：读 `projects/*.yaml` 返回 `Component[]`，替代"读 workspaces 表"的旧路径，作为 GET /components 的唯一数据源（D-001）。
implementation:
  - spike-01 通过为前置：确认 SpecPathResolver platform_managed mode 在 daemon-client 下能解析 spec_root 读到 yaml
  - 新建 `component_catalog_service.py`，实现 `list_components(workspace_id) -> list[Component]`
  - 步骤：`SpecWorkspaceService.get(id)` → `SpecPathResolver.resolve(spec_ws)`（platform_managed，daemon-client 兼容）→ `WorkspaceParser().parse(spec_root)`，只取 `workspaces`，丢弃 `relations`
  - 过滤掉 `component_key == ws.name`（项目组自身 yaml 如 SillyHub.yaml），只返回一级子项目
  - 输出结构对齐 design §7.1：`component_key/name/path/type/role/tech_stack/status`
acceptance:
  - daemon-client 模式与 server-local 模式都能正确解析 spec_root 并返回 Component[]
  - 返回项不包含项目组自身（SillyHub 不出现在自己的 components 里）
  - 不再触碰 workspaces 表的 component_key 行
verify:
  - cd backend && python -m pytest tests/modules/workspace/test_component_catalog.py -q
constraints:
  - 仅新建文件，不改 router/service（router 切换在 task-03）
  - 必须复用 SpecPathResolver，不得硬编码路径（daemon-client 兼容）
  - 不消费 parser 的 relations 段
---

