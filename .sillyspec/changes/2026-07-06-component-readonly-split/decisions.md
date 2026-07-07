---
author: qinyi
created_at: 2026-07-06T11:03:16
---

# Decisions: 组件只读化（Grill/重大决策台账）

> 稳定版本 ID 格式 `D-xxx@V1`（大写 V）。supersede 需新版本号。

## D-001@V1 组件目录接口
- type: architecture
- status: accepted
- source: explore + step6/7
- question: 内部组件的元数据从哪里读、怎么暴露给前端？
- answer: 新建 `component_catalog_service`，`GET /workspaces/{id}/components` 读 `projects/*.yaml`（经 `SpecPathResolver` 解析 daemon-client spec_root），返回 `Component[]`；过滤掉项目组自身 yaml
- alternatives: 甲路（组件留 workspace 行 + 写端点加守卫）/ 丙路（中间态 read_only 列）—— 否决，双身份负担 + 粒度问题未解
- impact: 新增 `backend/app/modules/workspace/component_catalog_service.py`；router `GET /components` 改读源

## D-002@V1 组件粒度（丁路叠加）
- type: boundary
- status: accepted
- source: step6 用户拍板
- question: 组件清单的粒度（一级子项目 vs 模块级）？
- answer: `generate_projects` 只生成一级子项目（backend/frontend/daemon/sillyhub-daemon/ppm，5 个），按 paths 顶级目录分组；模块级（backend/app/modules/*）不再单独成组件
- alternatives: 保留 35 个细粒度前端折叠 / 两级都显可展开 —— 否决，与用户"应该有好几个"心智不符
- impact: `generate_projects` 分组逻辑改（service.py:648-654）

## D-003@V1 reparse 拆分
- type: architecture
- status: accepted
- source: step7
- question: reparse 方法去留？generate_projects 末尾是否还调 reparse？
- answer: `generate_projects` 末尾去掉 `await self.reparse()`，只产 yaml；`reparse` 方法 + `POST /reparse` 端点废弃移除；前端"重新扫描"按钮删
- alternatives: 保留 reparse 不落库 —— 否决，语义混乱
- impact: `service.py` 删 reparse 方法（:748-971）；router 移除端点；调用方对齐（R-03）

## D-004@V1 关系层清理
- type: architecture
- status: accepted
- source: step6（数据实证 446 条全垃圾）
- question: 组件间关系功能（workspace_relations）怎么处理？
- answer: 删表 + 模型 + relation_service/router + topology 组件级图；components 页出/入边 SectionCard 删；projects yaml 的 relations 生成段也去（G-05 补丁）
- alternatives: 保留 schema 不填充 / 保留并修 —— 否决，前者留死表，后者工作量大且价值低（446 条 100% 垃圾）
- impact: 删 `relation_service.py` / `relation_schema.py` / `WorkspaceRelation` 模型；topology 退化；service.py 去 relations 生成

## D-005@V1 change_workspaces 投影表
- type: architecture
- status: accepted
- source: step7
- question: change_workspaces M:N 投影表（workspace_id FK）怎么处理？
- answer: 废弃 `_sync_change_workspaces`；`ChangeSummary.workspace_ids` 移除；表 DROP。`changes.affected_components` 字符串链路是权威，不动
- alternatives: 保留表改填充源 —— 否决，affected_components 字符串已够用，投影表是冗余
- impact: `change/service.py` 删 `_sync_change_workspaces`；`change/schema.py` 移除字段；model 删 `ChangeWorkspace`

## D-006@V1 数据清理
- type: compatibility
- status: accepted
- source: step6 用户拍板
- question: 存量垃圾数据（36 deleted component + 446 relations）何时清？
- answer: 本次 alembic migration `component_readonly_cleanup` 硬删：`DELETE workspaces WHERE component_key IS NOT NULL` → `DROP TABLE workspace_relations` → `DROP TABLE change_workspaces`；downgrade 不可逆（本项目允许重置数据）
- alternatives: 单独运维脚本 / 不清存量 —— 否决，前者易忘，后者留垃圾
- impact: 新增 alembic revision；W3 执行

## D-007@V1 components 页改造
- type: boundary
- status: accepted
- source: step6 用户拍板
- question: components 页改读 yaml 后变成什么样？
- answer: 标题"工作区关系"→"项目组件"；改读 `getWorkspaceComponents`；删出/入边两个 SectionCard；删"重新扫描"按钮；全只读
- alternatives: 保留名字 + 保留扫描按钮 / 合并架构文档视图 —— 否决，前者按钮语义已变，后者扩范围
- impact: `components/page.tsx` 改造

## D-008@V1 component_key 列去留
- type: compatibility
- status: accepted
- source: step7（Design Grill）
- question: `workspaces.component_key` 列删还是留？
- answer: 保留 nullable 列（migration 后值全空），本次不删列。理由：减少改动面（不碰 schema.py WorkspaceRead / frontend 类型）；列保留无害；删列可后续单独 migration
- alternatives: 本次删列 —— 否决，扩大改动面且需清所有引用
- impact: migration 不删列；schema/frontend 类型保留字段
