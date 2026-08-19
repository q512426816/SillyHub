---
author: qinyi
created_at: 2026-08-18 23:20:00
change: 2026-08-18-workspace-role-type
plan_level: light
---

# 轻量计划（Light Plan）：工作区角色类型

## 来源

brainstorm design.md（Grill 两轮通过，docHash 586f7003）+ decisions.md D-001~D-006@v1 全 accepted。核心：Workspace.type 收 8 值受控词表（必填）+ role 自由文本 + 新增 description 列；前端添加弹窗/列表徽标筛选/详情编辑/项目关联徽标；yaml 拓扑组件目录展示层归一（不落库）；破坏面调用点同 change 收口。

## 范围

- backend：workspace 模块 constants.py（新）/model/schema/service/parser/link_service/component_catalog_service + 1 个 migration（down_revision=20260817100000）
- backend 测试：workspace 模块 tests + test_workspace_admin_management.py 旧值断言改写（实际路径 backend/app/modules/workspace/tests/）
- frontend：workspace-types.ts（新）/workspaces.ts/workspace-scan-dialog/workspaces 列表页/详情页/LinkWorkspaceDialog/m-workspaces 移动端收口（实际路径 frontend/src/app/m/workspaces/page.tsx）
- 生成物：api-types.ts + openapi.json（gen:types）

## Tasks

### Wave 1（后端基础）

- [x] task-01: 后端词表与 schema——constants.py（WORKSPACE_TYPE_VALUES/WorkspaceTypeLiteral/YAML_TYPE_NORMALIZE_MAP）+ WorkspaceCreate.type 必填 Literal + Update omit/null 语义 + Read/Brief 补 description（Brief 另补 role）+ list ?type= 枚举化 + ?unclassified 互斥参数 + service 透传（覆盖：FR-01/FR-02/FR-03, D-002@v1, D-005@v1）

### Wave 2（后端落库与归一）

- [x] task-02: migration——Workspace.description 列 + 存量 type CASE 收编 UPDATE + downgrade（覆盖：FR-03, D-001@v1）
- [x] task-03: parser 组件目录归一——_parse_workspace YAML_TYPE_NORMALIZE_MAP 归一 + description 透传 + KNOWN_COMPONENT_KEYS 加键 + ComponentRead 补 description（覆盖：FR-07, D-003@v1, D-004@v1）

### Wave 3（类型生成）

- [x] task-04: gen:types——node_modules 健康复核（pnpm exec tsc --version）+ pnpm gen:types + api-types.ts/openapi.json 落盘（覆盖：FR-01 验收）

### Wave 4（前端词表与 client）

- [x] task-05: 前端词表与 client——workspace-types.ts（8 值中文标签+徽标 helper+未分类/未知值兜底）+ workspaces.ts Create/Update Input 补 type/description/role（覆盖：FR-01/FR-04）

### Wave 5（前端界面）

- [x] task-06: 添加工作区弹窗 + 列表页——类型必选下拉+描述 textarea 提交体；列表徽标+筛选新词表+unclassified，删 daemon-client 旧值（覆盖：FR-04/FR-05）
- [x] task-07: 详情页编辑 + 项目关联徽标——基本信息编辑区（type/role/description PATCH）；LinkWorkspaceDialog 已关联/可选列表徽标+title 摘要（覆盖：FR-05/FR-06）

### Wave 6（收口与回归）

- [x] task-08: 破坏面收口 + 测试全绿——m/workspaces 筛选旧值+创建补 type；test_workspace_admin_management.py 断言改新词表；新增后端测试（schema 枚举/parser 归一/Brief/Update 语义）+ 前端 vitest（弹窗/筛选/徽标/PATCH）+ pytest+vitest+tsc+mypy 回归（覆盖：FR-08, D-006@v1）

依赖：task-01→task-02→task-04→task-05→(task-06/task-07 并行)→task-08；task-03 独立可与 task-01 后并行。

Wave 划分说明：workspace-types.ts 被 task-05（创建）与 task-08（移动端导入消费）共同触及——按共享文件须分 Wave 规则，task-08 排 Wave 6 串行在 task-05（Wave 4）之后。

## 验收

- AC-01 新建工作区不选类型 422；选合法值成功且 OpenAPI JSON type 字段带 enum 8 值
- AC-02 PATCH omit 不改 / null 清空（type/role/description 三字段行为一致）
- AC-03 `?type=frontend-code` 精确命中；`?unclassified=true` 只出 type 为空行；两者同传 422
- AC-04 yaml 写 `type: frontend` 组件目录展示"前端代码"；未知值展示原值；ComponentRead 含 description
- AC-05 列表/项目关联弹窗徽标渲染正确（NULL=未分类灰、未知=原值灰）
- AC-06 migration upgrade/downgrade 通过；存量 CASE 收编幂等
- AC-07 backend pytest + frontend vitest + tsc + mypy 全绿（含改写后的 admin_management）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01/task-02 | AC-01（类型在 Workspace 本体，关联表零改动） |
| D-002@v1 | task-01/task-05 | AC-01/AC-05 |
| D-003@v1 | task-03 | AC-04 |
| D-004@v1 | task-03 | AC-04（不落 Workspace 表） |
| D-005@v1 | task-01 | AC-02/AC-03 |
| D-006@v1 | task-08 | AC-07（移动端最小收口） |
