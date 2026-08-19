---
author: qinyi
created_at: 2026-08-19 00:02:00
change: 2026-08-18-workspace-role-type
---

# 符号影响面报告（Symbol Impact）— 工作区角色类型

依据：tasks/task-01~08.md allowed_paths + design.md §5/§6，调用点扫描结论。

- task-01: **DTO 字段级变更（非签名破坏）**——WorkspaceCreate 加必填 type + 新增 description（所有 `WorkspaceCreate(` 构造调用点必须传 type）。受影响调用点：backend/app/modules/workspace/tests/{test_service,test_model,test_schema_default_agent,test_daemon_client_scan}.py 约 30 处构造 + frontend/src/app/m/workspaces/page.tsx:548 createWorkspace（经 client）——测试 4 文件在 task-01 allowed_paths 内 ✓；移动端调用点在 task-08 allowed_paths 内 ✓；生产代码 app/ 内零直接构造（grep 核实仅 router 经 HTTP body）✓。router.py `list_workspaces(workspace_type: str|None)` 参数类型改 Literal + 新增 unclassified 参数——调用点仅 HTTP（FastAPI 注入），前端调用点 workspaces/page.tsx:250（task-06）与 m/workspaces/page.tsx:130（task-08）均覆盖 ✓。WorkspaceBrief 加字段（向后兼容，消费者 LinkWorkspaceDialog.tsx 已在 task-07）✓。schema WorkspaceUpdate 加可选字段（omit/null，无破坏）✓。
- task-02: 无签名级变更——model.py 加可空字段（ORM 向后兼容）；migration 新文件无调用点。
- task-03: **DTO 字段级变更**——ParsedWorkspace dataclass 加 description 字段（构造处全部在 parser.py 内部 _parse_workspace ✓）；ComponentRead 加 description（构造处 component_catalog_service.py:_to_component ✓；消费方 scan_docs/router 等读字段为可选，无破坏）。
- task-04: 无签名级变更——生成产物替换，接口形状只加不改。
- task-05: **client 输入类型变更**——CreateWorkspaceInput 加必填 type（调用点：workspace-scan-dialog.tsx task-06 ✓、m/workspaces/page.tsx:548 task-08 ✓）；UpdateWorkspaceInput 加可选字段（调用点：详情页 task-07 ✓、workspaces/page.tsx:158 display_alias PATCH 不受影响——可选字段叠加）。listWorkspaces 参数加 unclassified（调用点 task-06/task-08 覆盖）✓。
- task-06: 组件内部改动（scan-dialog 表单 state、workspace-card 徽标渲染、page.tsx 筛选），WorkspaceCard props 不变（读 workspace.type 现有字段）——无签名级变更。
- task-07: 组件内部改动（详情页编辑区、LinkWorkspaceDialog 渲染），props 不变——无签名级变更。
- task-08: 移动端 page.tsx 调用点收口（见 task-01/task-05 行）；测试文件改写无生产调用点。

**结论**：所有签名级变更的调用点均在对应 task allowed_paths 内，无越界调用点，不阻断 execute。
