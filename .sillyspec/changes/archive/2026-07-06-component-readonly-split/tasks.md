---
author: qinyi
created_at: 2026-07-06T11:03:16
---

# Tasks: 组件只读化（粗任务清单，plan 阶段细化成 Wave + 依赖）

> 本文件是粗任务清单，后续 `sillyspec run plan` 会细化为带依赖关系的 Wave 计划。
> 任务编号 T01-T20，按 W1（后端）/ W2（前端）/ W3（清理收尾）分组。

## 前置确认（execute 开始前）

- [ ] T00 全局 grep `reparse`、`generate_projects`、`_sync_change_workspaces`、`WorkspaceRelation`、`ChangeWorkspace`、`getWorkspaceRelations` 的所有调用方，逐一登记（对应 R-03 调用方对齐）

## W1 — 后端数据模型 + 接口

- [ ] T01 新建 `backend/app/modules/workspace/component_catalog_service.py`：`list_components(workspace_id)` 读 `projects/*.yaml` 返回 `Component[]`，经 `SpecPathResolver` 解析 spec_root（platform_managed mode，daemon-client 兼容）
- [ ] T02 `workspace/router.py`：`GET /workspaces/{id}/components` 改调 `component_catalog_service`；移除 `GET /workspaces/{id}/relations` + relation CRUD；移除 `POST /workspaces/{id}/reparse`
- [ ] T03 `workspace/service.py`：`generate_projects` 分组逻辑改一级粒度（按 paths 顶级目录，不再按 module key 首段）；末尾去 `await self.reparse(workspace_id)`；**去掉 relations 生成段（:689-699 + :716-725，关系功能已砍，避免死代码，G-05 补丁）**
- [ ] T04 `workspace/service.py`：删 `reparse` 方法（:748-971）+ `_build_child_root_path` 等 helper（随 reparse 删）
- [ ] T05 删 `workspace/relation_service.py` + `workspace/relation_schema.py`；`workspace/model.py` 删 `WorkspaceRelation`（:159-198）；`workspace/parser.py` 移除 relations 解析段或保留不消费
- [ ] T06 `workspace/topology.py`：退化为只返回项目组节点（无边）
- [ ] T07 `change/service.py`：删 `_sync_change_workspaces`（:1201-1244）+ 调用处（:1049）；`change/schema.py` `ChangeSummary` 移除 `workspace_ids`
- [ ] T08 `change/model.py` / `workspace/model.py`：删 `ChangeWorkspace` 模型（:201-226）
- [ ] T09 backend 单测：`component_catalog_service` 覆盖 daemon-client + server-local；`generate_projects` 一级粒度测试（模块级不生成）；workspace + change 全量回归零失败

## W2 — 前端改造

- [ ] T10 `lib/workspaces.ts`：移除 `getWorkspaceRelations`；新增 `getWorkspaceComponents(id)` 调新接口
- [ ] T11 `lib/components.ts`：`listComponents` 改调 `getWorkspaceComponents`；移除 `workspaceToComponent` 兼容层
- [ ] T12 `components/page.tsx`：标题"工作区关系"→"项目组件"；`load()` 改调 `getWorkspaceComponents`；删出/入边两个 SectionCard；删"重新扫描"按钮 + `handleRescan`
- [ ] T13 `create-change/page.tsx`：选组件候选源切换（调新 `listComponents`；提交 `affected_components` 不变）
- [ ] T14 `topology/page.tsx`：退化（只项目组节点或隐藏，plan 定方案）
- [ ] T15 frontend `pnpm typecheck` 零错误 + `pnpm vitest` 零回归（更新 components/topology/create-change 相关测试）

## W3 — migration 清理 + 收尾

- [ ] T16 新建 alembic revision `component_readonly_cleanup`：`DELETE FROM workspaces WHERE component_key IS NOT NULL` → `DROP TABLE workspace_relations` → `DROP TABLE change_workspaces`；downgrade 不可逆
- [ ] T17 migration 测试库 dry-run（验证 component 行 + relations + change_workspaces 全清，CASCADE 正确）
- [ ] T18 SillyHub 端到端：重新 `generate_projects`（一级粒度）→ `/components` 页显示 5 个一级子项目 → create-change 选组件 → 变更详情"影响组件"正确
- [ ] T19 更新模块文档：workspace.md（若无则新建最小卡片）、change.md（变更索引追加本次 ql-ID）；按 `scan-regenerates-module-docs` 教训融入"注意事项"，变更索引会被 scan 重生时删除
- [ ] T20 更新 archive 前的 ROADMAP（若有）+ quicklog 收尾记录

## 依赖关系（plan 阶段细化）

- T00 → 所有 W1 任务（先确认调用方再动手）
- T01 → T02（catalog service 先于 router 接入）
- T02 → T09（接口改完测）
- T03 + T04 → T09（service 改完测）
- W1 全部 → W2（后端接口先就绪，前端才能切换，R-02 时序）
- T10 → T11 → T12/T13（lib 先于页面）
- W2 全部 → W3（前端切完再清存量）
- T16 → T17 → T18（migration 先于端到端）

## 风险任务映射

- R-01（daemon-client spec_root，P0）→ T01 + T09 单测覆盖两模式
- R-02（候选源时序，P1）→ Wave 顺序 W1 → W2；T11 切换前验证 T01 接口
- R-03（reparse 调用方，P1）→ T00 前置 grep + T04 删除前确认
- R-04（CASCADE，P1）→ T16 migration + T17 dry-run
- R-05（generate_projects 重生，P1）→ T18 端到端实跑
- R-07（topology 方案，P2）→ T14 在 plan 定
