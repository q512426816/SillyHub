---
author: qinyi
created_at: 2026-07-06T11:03:16
---

# Requirements: 组件只读化

## 功能需求

### FR-01 组件目录只读接口
- 后端 `GET /workspaces/{id}/components` 改为读 `projects/*.yaml`，返回 `Component[]`（一级子项目）
- 经 `SpecPathResolver` 解析 daemon-client 模式 spec_root（兼容 server-local）
- 响应字段：`component_key / name / path / type / role / tech_stack / status`
- 过滤掉项目组自身的 yaml（如 `SillyHub.yaml`）

### FR-02 generate_projects 一级粒度
- `service.py:648-654` 分组逻辑改为按"一级目录"（backend/frontend/daemon/sillyhub-daemon/ppm）
- 不再按 module key 首段生成模块级 component
- 生成结果：5 个一级子项目 yaml（原来 35 个）
- 末尾去掉 `await self.reparse()`，只产 yaml 不落库

### FR-03 reparse 废弃
- 移除 `POST /workspaces/{id}/reparse` 端点
- 删除 `WorkspaceService.reparse` 方法（service.py:748-971）及相关 helper
- 前端 components 页"重新扫描"按钮移除

### FR-04 组件间关系功能移除
- 删除 `workspace_relations` 表 + `WorkspaceRelation` 模型（model.py:159-198）
- 删除 `relation_service.py` + `relation_schema.py`
- 移除 `GET/POST/DELETE /workspaces/{id}/relations` 端点
- components 页"出边/入边"两个 SectionCard 移除
- `GET /workspaces/topology` 退化为只返回项目组节点（无边）

### FR-05 change_workspaces 投影废弃
- 删除 `_sync_change_workspaces`（change/service.py:1201-1244）及其调用
- `ChangeSummary` 移除 `workspace_ids` 字段（change/schema.py）
- 删除 `change_workspaces` 表 + `ChangeWorkspace` 模型（model.py:201-226）
- `changes.affected_components` 字符串链路保持不变

### FR-06 components 页改造（前端）
- 页面标题"工作区关系" → "项目组件"
- 数据源 `listWorkspaces` 过滤 → `getWorkspaceComponents`（新接口）
- 删除"出边/入边"两个 SectionCard
- 删除"重新扫描"按钮
- 子组件清单展示：name + component_key + role + tech_stack + status（只读）

### FR-07 前端候选源切换
- `lib/components.ts` `listComponents` 改调 `GET /workspaces/{id}/components`
- 移除 `workspaceToComponent` 兼容层
- `create-change/page.tsx` 选组件候选源切换到新 `listComponents`
- 提交时 `affected_components` 仍是 component_key 字符串数组（不变）

### FR-08 存量数据清理
- alembic migration `component_readonly_cleanup`：
  - 硬删 `workspaces` 表中 `component_key IS NOT NULL` 的行（36 行，含 soft-deleted）
  - `DROP TABLE workspace_relations`
  - `DROP TABLE change_workspaces`
  - 保留 `workspaces.component_key` 列（nullable，值全空）

## 非功能需求（验收标准）

- backend：`workspace` + `change` 模块全量测试零回归
- backend：组件目录接口单测覆盖 daemon-client + server-local 两模式
- backend：generate_projects 粒度测试（一级子项目数量正确，模块级不生成）
- migration：测试库 dry-run 通过，无残留 component/relations/change_workspaces
- frontend：`pnpm typecheck` 零错误
- frontend：`pnpm vitest` 零回归（components/topology/create-change 相关测试更新通过）
- 端到端：SillyHub `/workspaces/{id}/components` 页显示 5 个一级子项目（只读、无出入边、无重新扫描按钮）
- 端到端：create-change 页能选组件（候选来自新接口），提交后变更详情"影响组件"显示正确

## 范围外（明确不做）

- 变更流程改动（`affected_components` 字符串链路不动）
- daemon / sillyhub-daemon 改动
- scan 质量修复（除 generate_projects 粒度；`_module-map.yaml` depends_on 提取质量不在范围）
- 新增"组件只读"权限枚举（组件无 workspace 身份，写端点天然挡住）
- components 页新视觉设计（沿用现有样式系统）
- 删除 `workspaces.component_key` 列（保留 nullable，D-008）
