---
author: qinyi
created_at: 2026-08-18 23:11:00
change: 2026-08-18-workspace-role-type
---

# 任务清单（Tasks）— 工作区角色类型

> 详细 Wave/Task 拆分由 plan 阶段产出（plan.md），本文件为 brainstorm 级任务骨架。

## 任务骨架

- [ ] T1 词表常量与后端 schema：constants.py（WORKSPACE_TYPE_VALUES/Literal/YAML_TYPE_NORMALIZE_MAP）+ WorkspaceCreate/Update/Read/Brief 字段与校验 + ?type= 枚举化 + ?unclassified 参数（design §5.1/§5.3/§7）
- [ ] T2 数据模型与 migration：Workspace.description 列 + 存量 type CASE 收编 UPDATE（down_revision=20260817100000，design §5.2/§8）
- [ ] T3 parser 组件目录归一：_parse_workspace 映射归一 + description 透传 + KNOWN_COMPONENT_KEYS + ComponentRead 补 description（design §5.3 FR-07，D-004）
- [ ] T4 link_service WorkspaceBrief 补 role/description（design §6）
- [ ] T5 gen:types：node_modules 健康复核 + pnpm gen:types + 提交 api-types.ts/openapi.json（design §5.5）
- [ ] T6 前端词表与 client：workspace-types.ts（词表/徽标 helper）+ workspaces.ts Create/Update Input 补字段（design §5.4）
- [ ] T7 添加工作区弹窗：类型必选下拉 + 描述 textarea + 提交体（FR-05）
- [ ] T8 列表页：徽标 + 筛选新词表 + unclassified（FR-04）
- [ ] T9 详情页基本信息编辑区（FR-05）
- [ ] T10 项目关联弹窗徽标（FR-06）
- [ ] T11 破坏面收口：移动端 m/workspaces 筛选+创建、后端存量测试改写（FR-08，§5.6；注意 design 两处路径笔误：移动端实际 frontend/src/app/m/workspaces/page.tsx、测试实际 backend/app/modules/workspace/tests/）
- [ ] T12 测试收口：backend（schema 枚举/parser 归一/Brief/收编 migration）+ frontend vitest（弹窗提交体/筛选/徽标/详情 PATCH）+ 全量回归

## 依赖关系

T1→T2→T5→(T6→T7/T8/T9/T10 并行)；T3/T4 与前端并行；T11 在 T1 后可做；T12 收口。
