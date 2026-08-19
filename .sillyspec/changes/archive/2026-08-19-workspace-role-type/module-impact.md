---
author: qinyi
created_at: 2026-08-18 23:25:00
change: 2026-08-18-workspace-role-type
---

# 模块影响分析（Module Impact）— 工作区角色类型

依据：design.md §6 文件变更清单 + plan.md 任务列表，对照 _module-map.yaml（source_commit ba87eec）。

## 影响矩阵

| 模块 | 影响类型 | 涉及文件 | 说明 |
|------|----------|----------|------|
| backend | 修改 | backend/app/modules/workspace/{constants.py(新),model.py,schema.py,service.py,parser.py,link_service.py,component_catalog_service.py}；backend/migrations/versions/20260818150000_workspace_role_type.py(新)；backend/app/modules/workspace/tests/test_workspace_admin_management.py 等 | 受控词表+description 列+migration+parser 归一+Brief 扩字段+存量测试改写 |
| frontend | 修改 | frontend/src/lib/{workspace-types.ts(新),workspaces.ts,api-types.ts(再生成)}；frontend/src/components/workspace-scan-dialog.tsx；frontend/src/app/(dashboard)/workspaces/page.tsx；frontend/src/app/(dashboard)/workspaces/[id]/page.tsx；frontend/src/components/workspace/{workspace-card,LinkWorkspaceDialog}.tsx；frontend/src/app/m/workspaces/page.tsx（移动端收口） | 添加弹窗新字段+列表徽标筛选+详情编辑+项目关联徽标+gen:types |
| sillyhub-daemon | 无变化 | — | type 对 daemon 无语义，不改（design §3 非目标） |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/workspace.md` | 更新 workspace 模块卡（词表语义/description 列/组件目录归一/migration） | done |
| `modules/frontend_lib.md` / `modules/frontend_components.md` / `modules/frontend_app.md` | 更新前端三卡（workspace-types 词条/入口件与关联弹窗徽标/列表详情移动端收口） | done |
| `_module-map.yaml` | 无变化（未增删模块，constants.py/workspace-types.ts 归入既有模块路径 glob） | skipped |
