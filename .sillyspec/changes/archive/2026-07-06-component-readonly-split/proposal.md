---
author: qinyi
created_at: 2026-07-06T11:03:16
---

# Proposal: 组件只读化 — 剥离 workspaces 表 + 砍无效关系功能

变更名：`2026-07-06-component-readonly-split`
阶段：brainstorm（本文档经 explore 充分讨论后立项）

## 背景

调研 SillyHub 工作区 `/components` 页"无子组件"问题时，发现一组连锁的概念错位：

1. **"内部组件" ≡ "workspace 行"**：`workspaces` 表用单一 `component_key` nullable 列区分组件与项目组（`model.py:90-93`），无只读标志。reparse 把 `.sillyspec/projects/*.yaml` 解析落库成 component workspace 行（`service.py:860-883`），与项目组共享同一张表、同一套权限链、同一个列表接口。

2. **admin 对组件完全可写、零拦截**：所有写端点（变更/绑定/init lease/scan-generate/reparse）都不校验 `component_key`；`is_platform_admin` 在 `rbac.py:101` 短路一切。普通用户对组件 403 只是"无 owner 成员行"的副作用，不是策略。

3. **"组件间关系"功能产出 100% 垃圾**：`workspace_relations` 表 446 条边全部 `depends_on` 类型、100% 机器自动生成（0 手工）、100% 两端 soft-deleted。抽样：`auth→auth` 自环、`core→auth` 反向、`runtime→frontend_stores` 跨层、"万物依赖万物"。根因之一（`generate_projects` 累积变量作用域 bug）已由 ql-20260706-007 修复生成端，但存量垃圾未清。

4. **粒度错配**：SillyHub 名下曾生成 36 个 component workspace，其中只有 5 个是真正的一级子项目（backend/frontend/daemon/sillyhub-daemon/ppm），其余 30 个是 `backend/app/modules/*` 这种模块级零件。用户"应该有好几个"的心智指向 5 个一级子项目。

用户已主动删除那 36 行（soft-delete），但 `/components` 页因读 `workspaces` 表而显示空——**核心矛盾**：当前架构里"子组件"与"workspace 行"是同一个东西，没有"只读内部组件"这个中间形态。

## 目标

- **组件剥离**：内部组件不再是 `workspaces` 表的行，改为从 `projects/*.yaml` 读出的只读元数据附属（名/路径/技术栈/role）。
- **只读保障**：组件不再有 workspace 身份，写端点天然无法作用其上（变更/绑定/init/scan/reparse 全部只能挂在项目组）。
- **砍无效功能**：移除"组件间关系"功能（数据已证实是噪声制造机，零业务损失）。
- **粒度对齐**：`generate_projects` 只生成一级子项目组件，不再生成模块级。
- **清理存量**：alembic migration 硬删 36 个 soft-deleted component + 446 条垃圾 relations + `change_workspaces` 投影行。

## 范围

| 层 | 模块 | 改动 |
|---|---|---|
| backend | `workspace` | 新只读组件目录接口；`generate_projects` 粒度改 + 不落库；废 `reparse`；删 `WorkspaceRelation` 模型/service/router；topology 退化 |
| backend | `change` | 废 `_sync_change_workspaces` 投影表填充；`ChangeSummary.workspace_ids` 处理 |
| backend | `spec_workspace` | 新接口复用 `SpecPathResolver`（daemon-client 兼容） |
| backend | migration | 硬删 component 行 + relations + change_workspaces |
| frontend | components 页 | 改名"项目组件" + 改读新接口 + 删出/入边表 + 删重新扫描按钮 |
| frontend | topology 页 | 退化到项目组级 |
| frontend | lib/create-change | `listComponents` 改调新接口 |

## 决策摘要（D-xxx@V1，详见 design.md §决策追踪）

- **D-001@V1** 组件目录接口：`GET /workspaces/{id}/components` 改读 projects yaml（经 SpecPathResolver），响应复用 `Component` 类型
- **D-002@V1** 组件粒度：只生成一级子项目（5 个），不生成模块级
- **D-003@V1** reparse 拆分：`generate_projects` 末尾去掉 `await self.reparse()`；reparse 方法 + router 废弃
- **D-004@V1** 关系层：删 `workspace_relations` 表 + 模型 + relation_service/router + topology 组件级图；components 页删出/入边 SectionCard
- **D-005@V1** change_workspaces：废弃 `_sync_change_workspaces`；`ChangeSummary.workspace_ids` 移除
- **D-006@V1** 数据清理：本次 alembic migration 硬删存量（CASCADE 处理级联）
- **D-007@V1** components 页：改名"项目组件" + 全只读 + 去重新扫描按钮

## 非目标

- **不重构变更流程**：`changes.affected_components` 字符串链路不动（已是 component_key 字符串，乙路无感）
- **不改 daemon / sillyhub-daemon**：本次纯 backend + frontend
- **不修 scan 质量（除 generate_projects 粒度）**：`_module-map.yaml` 的 depends_on 提取质量不在本次范围
- **不引入"组件只读"新权限枚举**：组件不再有 workspace 身份，写端点天然挡住，无需新权限注解
- **不做 components 页新视觉**：沿用现有 SectionCard/StatusBadge/DataTable 样式系统

## 为何现在做

- 用户已手动清空 36 行 component（数据已就绪，等于乙路"清理历史"步骤已半完成）
- ql-20260706-007 已修生成端 bug（新生成的 yaml 干净，避免再次污染）
- 关系功能经数据证实零价值，砍掉是收益不是代价
- 本项目未正式上线（CLAUDE.md 规则10），允许重置数据，不要求历史兼容
