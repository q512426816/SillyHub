
## ql-20260829-008-69d9 | 2026-08-29 14:00:21 | 工作区状态字段维护（详情页归档/恢复）+ 列表默认只展示活跃工作区
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/workspace/schema.py（WorkspaceUpdate.status Literal 化 + 删类尾重复自由字符串字段）
- backend/app/modules/workspace/service.py（update 内 pending→active 委托 activate 引导）
- backend/app/modules/workspace/tests/test_router.py（新增 3 用例（归档恢复/非维护值 422/pending 引导））
- backend/openapi.json（gen:types 再生成）
- frontend/src/lib/api-types.ts（gen:types 再生成）
- frontend/src/lib/workspaces.ts（UpdateWorkspaceInput.status 收窄 active|archived）
- frontend/src/app/(dashboard)/workspaces/page.tsx（statusFilter 默认 active）
- frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（基本信息编辑表单状态下拉 + 取消重置 + 状态中文标签常量）
- frontend/src/components/workspace/hero-header.tsx（非 active 状态徽标显中文（原显英文原值））
- frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx（默认筛选+切全部状态用例（antd Select mouseDown 点选））
- frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（编辑归档保存链路用例）
需求：工作区状态字段维护（详情页归档/恢复）+ 列表默认只展示活跃工作区
根因：状态值域四值（pending/active/archived/deleted）虽已定义，但 WorkspaceUpdate 类尾存在一个同名的自由字符串 status 字段，把后来任何校验都覆盖成任意值可写（连 deleted 都能裸写且不触发软删收敛）；同时列表页无默认状态筛选，归档/废弃工作区与活跃区混排
方案：后端删除重复字段并给 WorkspaceUpdate.status 挂 WorkspacePatchStatusLiteral（仅 active/archived，其余 422）；service.update 对 pending→active 委托 activate 引导（spec bootstrap 与 last_scanned_at 不被绕过）；前端列表页 statusFilter 默认 active（全部状态可选回），详情页基本信息编辑表单增状态下拉（存量 pending 追加原值选项、取消重置草稿、omit 不改语义），hero 徽标非 active 值显中文标签，UpdateWorkspaceInput.status 类型收窄
结果：后端 workspace 模块 218 passed 1 skipped（skip 为 Windows 符号链接权限预存环境跳过，新增 3 用例含归档恢复主路径/非维护值 422/pending→active 引导断言）+ ruff/mypy 0 错；前端两个测试文件 18 passed（新增 2 用例）+ tsc 0 错 + eslint 0 错误；gen:types 已同步 openapi.json 与 api-types.ts；模块文档 workspace.md 已更新暂存
