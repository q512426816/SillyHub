---
author: qinyi
created_at: 2026-07-06T11:03:16
---

# Design: 组件只读化 — 剥离 workspaces 表 + 砍无效关系功能

变更名：`2026-07-06-component-readonly-split`
关联 quicklog：ql-20260706-007（已修 generate_projects 累积变量作用域 bug，本次基于干净生成端推进）

## 1. 背景

### 1.1 现状（explore 已坐实）

- `workspaces` 表用单一 `component_key` nullable 列区分组件 vs 项目组（`backend/app/modules/workspace/model.py:90-93`），无只读标志列。
- `reparse`（`service.py:748-971`）把 `.sillyspec/projects/*.yaml` 解析落库成 component workspace 行（`:860-883`），`created_by=None`、不建 owner 成员行。
- `/workspaces/[id]/components` 页"子组件"清单数据源 = `listWorkspaces()` 按 `root_path` 前缀过滤（`frontend/.../components/page.tsx:74-81`）。
- `WorkspaceRelation` 双 FK → `workspaces.id` CASCADE（`model.py:159-198`）；topology 拓扑页（`topology.py` + frontend `topology/page.tsx`）把端点当 workspace UUID 用。
- `list_workspaces`（`router.py:214`）不过滤 component；admin 在 `rbac.py:101` 短路 → 对 component 全可写、零拦截；普通用户因 component 无 owner 行而 403（副作用非策略）。
- 前端 `listComponents`（`lib/components.ts:126-138`）= 过滤子 workspace 的兼容层。
- `change_workspaces` M:N 投影表（`model.py:201-226`）由 `change/service.py:1201-1244 _sync_change_workspaces` 用 `component_key IN (...)` 反查填充。
- `changes.affected_components` 是 `component_key` 字符串 JSON 数组（`change/model.py:128-131`）——变更功能的权威主存储，全程字符串，不引用 workspace_id。

### 1.2 数据实证（关系功能是垃圾）

- `workspace_relations` 表 446 条边：100% `depends_on`、100% 自动生成、100% 两端 soft-deleted。
- 抽样：`auth→auth` 自环、`core→auth` 反向、`runtime→frontend_stores` 跨层、"万物依赖万物"。
- 唯一合理的 2 条 yaml 关系（`frontend→backend`、`sillyhub-daemon→backend`）反而不在那 446 条里。
- 根因之一（`generate_projects` 累积变量作用域 bug）已由 ql-20260706-007 修复（`service.py:668` all_relations 移入循环体），生成端已干净，但存量垃圾未清。

### 1.3 要解决的问题

- **概念错位**：组件 ≡ workspace 行，导致 admin 可写、列表污染、`/components` 页与 workspace 表死耦合。
- **无效功能**：关系功能产出垃圾，污染 topology 和 relations API。
- **粒度错配**：生成 36 个 component（含模块级），用户心智只期望 5 个一级子项目。

## 2. 设计目标

1. 组件 = 项目组的只读元数据附属（读自 `projects/*.yaml`），不再是 workspace 行。
2. 写端点天然无法作用在组件上（无 workspace 身份）。
3. 移除"组件间关系"功能（零损失）。
4. `generate_projects` 只生成一级子项目组件。
5. 清理存量垃圾数据（36 component + 446 relations + change_workspaces 投影）。

## 3. 非目标

- 不重构变更流程（`affected_components` 字符串链路不动）
- 不改 daemon / sillyhub-daemon（纯 backend + frontend）
- 不修 scan 质量除 generate_projects 粒度
- 不引入"组件只读"新权限枚举（组件无 workspace 身份，写端点天然挡住）
- 不做 components 页新视觉（沿用现有样式系统）
- 不删 `Workspace.component_key` 列（保留 nullable，值全空；删列留作后续单独 migration，减少本次改动面）

## 4. 拆分判断

单一连贯重构，**不拆分**、**不走批量模式**。涉及 backend/workspace + change + frontend，但耦合度高（一起改才能工作），作为单一变更推进。

Wave 划分（plan 阶段细化）：
- **W1 后端**：新只读组件目录接口 + generate_projects 粒度 + 废 reparse + 删 relation 模型
- **W2 前端**：components 页改造 + topology 退化 + listComponents/create-change 切换
- **W3 收尾**：alembic migration 清理存量 + 端到端验证

## 5. 总体方案

### 5.1 数据模型层

```
   改前                                    改后
   ┌──────────────────────────┐           ┌──────────────────────────┐
   │ workspaces               │           │ workspaces               │
   │  SillyHub (项目组)        │           │  SillyHub (项目组, 唯一)  │
   │  backend (component)     │           │  (component_key 列保留   │
   │  frontend (component)    │           │   nullable, 值全空)      │
   │  ... 36 行               │           └──────────────────────────┘
   └──────────────────────────┘
   ┌──────────────────────────┐           (workspace_relations 删表)
   │ workspace_relations      │           (change_workspaces 删表)
   │  446 条 depends_on 垃圾   │
   └──────────────────────────┘           ┌──────────────────────────┐
   ┌──────────────────────────┐           │ projects/*.yaml (只读源) │
   │ change_workspaces (投影)  │           │  backend/frontend/daemon │
   └──────────────────────────┘           │  /sillyhub-daemon/ppm    │
                                          │  (5 个一级子项目)         │
                                          └──────────────────────────┘
                                              ↑ 新 GET /components 读
                                              ↑ create-change 候选源
```

### 5.2 接口层（backend）

**新增/改读源**：
- `GET /workspaces/{id}/components` → 改为读 `projects/*.yaml`（经 `SpecPathResolver` 解析 daemon-client spec_root），返回 `Component[]`。新实现走 `component_catalog_service.py`。

**废弃/移除**：
- `GET /workspaces/{id}/relations` → 移除（relation_service 删）
- `POST /workspaces/{id}/reparse` → 移除（reparse 方法删；前端"重新扫描"按钮删）
- `GET /workspaces/topology` → 退化为只返回项目组节点（无边）
- `POST /workspaces/{id}/generate-projects` → 保留，但末尾去掉 `await self.reparse()`，只产 yaml

**不变**：
- `GET /workspaces`、`GET /workspaces/{id}`（component_key 列保留，项目组行 component_key=null）
- changes 全套接口（`affected_components` 字符串链路）

### 5.3 前端层

- `components/page.tsx`：标题"工作区关系" → "项目组件"；删出/入边两个 SectionCard；删"重新扫描"按钮；`load()` 改调 `getWorkspaceComponents(id)`（新）。
- `topology/page.tsx`：退化，只渲染项目组节点（或整页隐藏，留待 plan 决定）。
- `lib/components.ts` `listComponents` → 改调 `GET /workspaces/{id}/components`，移除 `workspaceToComponent` 兼容层。
- `lib/workspaces.ts`：移除 `getWorkspaceRelations`；新增/改 `getWorkspaceComponents`。
- `create-change/page.tsx`：选组件候选源改调新 `listComponents`（已是 component_key 字符串，提交链路不动）。

### 5.4 generate_projects 粒度（丁路，D-002）

`service.py:648-654` 当前分组逻辑：`prefix = key.split("-")[0]`，把 `_module-map.yaml` 的每个 module key 按首段分组（`backend-agent` → `backend`）。

改为：**只按一级目录分组**。`_module-map.yaml` 的 module paths 字段含完整路径，按路径的顶级目录（`backend`/`frontend`/`daemon`/`sillyhub-daemon`/`ppm`）分组，不再按 module key 首段。模块级（`backend/app/modules/auth`）归入对应一级组件，不单独成组件。

效果：生成的 `projects/*.yaml` 从 35 个降到 5 个（一级子项目）。

**同时去掉 relations 生成段**（Design Grill G-05 补丁）：`service.py:689-699` 的 `all_relations` 收集 + `:716-725` 的 dedup + 写入 `project_def["relations"]` 整段移除。关系功能已砍（D-004），projects yaml 不再需要 relations 段——避免死代码，也避免再走已修的累积 bug 路径（ql-20260706-007）。

### 5.5 migration 清理（D-006）

alembic revision `component_readonly_cleanup`：
1. `DELETE FROM workspaces WHERE component_key IS NOT NULL`（硬删 36 行 component，含 soft-deleted）
2. `workspace_relations` 行因 FK CASCADE 随 component 行删除自动级联（无需单独 DELETE，但表本身在 migration 里 DROP）
3. `change_workspaces` 行 FK CASCADE 随 change/workspace 级联；表本身 DROP
4. `DROP TABLE workspace_relations`
5. `DROP TABLE change_workspaces`
6. 保留 `workspaces.component_key` 列（不删列，D-008）

downgrade：不可逆（数据已删）。`downgrade` 抛 `NotImplementedError` 或重建空表（本项目允许重置数据，CLAUDE.md 规则10）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/workspace/component_catalog_service.py` | 只读组件目录 service：读 `projects/*.yaml` 返回 `Component[]`，经 SpecPathResolver |
| 修改 | `backend/app/modules/workspace/service.py` | `generate_projects` 改一级粒度（5.4）+ 末尾去 `await self.reparse()`；`reparse` 方法删除；`_build_child_root_path` 等随 reparse 删 |
| 修改 | `backend/app/modules/workspace/router.py` | 移除 `POST /{id}/reparse`、`GET /{id}/relations`、relation CRUD；`GET /{id}/components` 改调 component_catalog_service；`generate-projects` 保留 |
| 修改 | `backend/app/modules/workspace/topology.py` | 退化为只返回项目组节点（无边）；移除 relations 读取 |
| 删除 | `backend/app/modules/workspace/relation_service.py` | WorkspaceRelation service 整文件删 |
| 删除 | `backend/app/modules/workspace/relation_schema.py` | relation schema 整文件删 |
| 修改 | `backend/app/modules/workspace/model.py` | 删 `WorkspaceRelation`（:159-198）、`ChangeWorkspace`（:201-226）模型类；保留 `Workspace.component_key` 列 |
| 修改 | `backend/app/modules/workspace/parser.py` | 保留 yaml→ParsedWorkspace 解析；移除 relations 解析段（:217-231, :288-350）或保留但 catalog service 不消费 |
| 修改 | `backend/app/modules/workspace/schema.py` | 移除 relation 相关 response schema；`WorkspaceRead` 保留 `component_key`（null） |
| 修改 | `backend/app/modules/change/service.py` | 删 `_sync_change_workspaces`（:1201-1244）及其调用（:1049）；reparse 不再填投影表 |
| 修改 | `backend/app/modules/change/schema.py` | `ChangeSummary` 移除 `workspace_ids` 字段（或置空数组） |
| 新增 | `backend/alembic/versions/<rev>_component_readonly_cleanup.py` | 硬删 component + DROP relations/change_workspaces 表 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx` | 改名"项目组件" + 改读 `getWorkspaceComponents` + 删出/入边 SectionCard + 删重新扫描按钮 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx` | 退化（只项目组节点或隐藏） |
| 修改 | `frontend/src/lib/components.ts` | `listComponents` 改调 `GET /workspaces/{id}/components`；移除 `workspaceToComponent` 兼容层 |
| 修改 | `frontend/src/lib/workspaces.ts` | 移除 `getWorkspaceRelations`；新增 `getWorkspaceComponents` |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx` | 选组件候选源切换（调新 listComponents，提交链路不变） |

## 7. 接口定义

### 7.1 `GET /workspaces/{id}/components`（改读源）

**响应** `200 OK`：
```json
{
  "items": [
    {
      "component_key": "backend",
      "name": "Backend API",
      "path": "backend",
      "type": "component",
      "role": "service",
      "tech_stack": ["Python", "FastAPI", "SQLAlchemy", "Pydantic"],
      "status": "active"
    }
  ]
}
```

**实现**：`component_catalog_service.list_components(workspace_id)`：
1. `spec_ws = SpecWorkspaceService.get(workspace_id)`
2. `spec_root = SpecPathResolver.resolve(spec_ws)`（platform_managed mode，daemon-client 兼容，参考 memory `runtime-read-broken-daemon-client`）
3. `parser = WorkspaceParser(); parse_result = parser.parse(spec_root)`（复用现有 yaml 解析，但只取 `workspaces`，不取 `relations`）
4. 过滤掉 `component_key == ws.name`（项目组自身的 yaml，如 `SillyHub.yaml`），返回一级子项目

**权限**：`require_permission(Permission.WORKSPACE_READ)`（与现有一致）。

### 7.2 废弃接口

- `GET /workspaces/{id}/relations` → 移除（前端不再调）
- `POST /workspaces/{id}/relations` / `DELETE /workspaces/{id}/relations/{rid}` → 移除
- `POST /workspaces/{id}/reparse` → 移除
- `GET /workspaces/topology` → 退化为 `{nodes: [...项目组], edges: []}`

## 7.5 生命周期契约表

本次变更不涉及 session/lease/agent_run/daemon/lifecycle/state transition 等关键词（纯数据模型 + 接口重构），**省略**。

## 8. 数据模型

### 8.1 删除

- 表 `workspace_relations`（含模型 `WorkspaceRelation`，`model.py:159-198`）
- 表 `change_workspaces`（含模型 `ChangeWorkspace`，`model.py:201-226`）

### 8.2 保留（不动）

- 表 `workspaces`：保留 `component_key` 列（nullable，值全空，D-008）
- 表 `changes`：`affected_components` JSON 字符串数组（不动）

### 8.3 migration

`<rev>_component_readonly_cleanup.py`：
- `op.execute("DELETE FROM workspaces WHERE component_key IS NOT NULL")`（硬删 36 行）
- `op.drop_table('workspace_relations')`（行已 CASCADE 清空，drop 表）
- `op.drop_table('change_workspaces')`（行已 CASCADE 清空，drop 表）
- downgrade：抛 `NotImplementedError`（本项目允许重置数据，不可逆）

## 9. 兼容策略（brownfield）

- **未配置新功能时行为不变**：项目组 workspace 的 CRUD、变更流程、绑定、init、scan-generate 全部不变（`affected_components` 字符串链路、项目组写端点均未动）。
- **组件读路径切换**：`GET /components` 从"读 workspace 表"切到"读 yaml"，前端同步切换。切换前后响应结构（`Component[]`）保持一致，前端组件消费不变。
- **create-change 候选源**：W1 后端新接口先就绪 → W2 前端切换。时序保证新接口先于前端切换可用（R-02）。
- **不改变的 API/表**：`GET /workspaces`、`GET /workspaces/{id}`、changes 全套、`workspaces.component_key` 列。
- **回退路径**：若 W1 后出问题，前端仍可临时用 `listWorkspaces` 过滤（component_key 非空）兜底；migration 在 W3 最后跑，前两个 Wave 出问题可回退代码不回退数据。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon-client spec_root 解析：新接口读 yaml 走 SpecPathResolver，daemon-client 模式路径易错（memory `runtime-read-broken-daemon-client` 教训） | P0 | 复用 `SpecPathResolver` platform_managed mode；单测覆盖 daemon-client + server-local 两模式；容器内 dry-run 验证 |
| R-02 | create-change 候选源时序：新接口必须先于 listComponents 切换就绪，否则创建页无候选组件 | P1 | Wave 顺序 W1（后端接口）→ W2（前端切换）；W2 内 listComponents 切换前先验证新接口可用 |
| R-03 | reparse 调用方对齐：废 reparse 前要确认所有调用方（workspace-bootstrap-flow、其他变更） | P1 | execute 前全局 grep `reparse`、`generate_projects` 调用方；逐一确认改"只产 yaml"后行为正确 |
| R-04 | migration CASCADE 顺序：硬删 component 时 relations/change_workspaces 级联 | P1 | migration 先 DELETE component 行（触发 CASCADE），再 DROP 表；单测验证无残留 |
| R-05 | generate_projects 粒度改动：现有 projects yaml 含 35 个（模块级），改粒度后重生只剩 5 个 | P1 | 改动后需重新 `generate_projects` 重生 yaml；execute 阶段对 SillyHub 实跑一次验证 |
| R-06 | frontend Workspace 类型 component_key：保留字段（null），不破坏类型契约 | P2 | schema.py `WorkspaceRead` 保留 `component_key: str | None`；前端类型不动 |
| R-07 | topology 页退化方案未定（隐藏 vs 只节点） | P2 | plan 阶段定；倾向"只项目组节点 + 无边"，保留页面入口 |

## 11. 决策追踪

| 决策 ID | 标题 | 状态 | 摘要 |
|---|---|---|---|
| D-001@V1 | 组件目录接口 | accepted | `GET /workspaces/{id}/components` 改读 projects yaml（SpecPathResolver），返回 Component[] |
| D-002@V1 | 组件粒度 | accepted | generate_projects 只生成一级子项目（5 个），不生成模块级 |
| D-003@V1 | reparse 拆分 | accepted | generate_projects 去掉 `await self.reparse()`；reparse 方法 + router 移除 |
| D-004@V1 | 关系层清理 | accepted | 删 workspace_relations 表 + 模型 + relation_service/router + topology 组件级图；components 页删出/入边 |
| D-005@V1 | change_workspaces 投影表 | accepted | 废弃 `_sync_change_workspaces`；`ChangeSummary.workspace_ids` 移除；表 DROP |
| D-006@V1 | 数据清理 | accepted | 本次 alembic migration 硬删存量（CASCADE 级联） |
| D-007@V1 | components 页改造 | accepted | 改名"项目组件" + 全只读 + 去重新扫描按钮 + 删出/入边 |
| D-008@V1 | component_key 列去留 | accepted | 保留 `workspaces.component_key` nullable 列（值全空），本次不删列以减少改动面 |

## 12. 自审（step 11 内联）

- ✅ 文件变更清单覆盖 backend（workspace/change/spec_workspace/migration）+ frontend（components/topology/lib/create-change）
- ✅ 接口定义含新接口响应 + 废弃清单
- ✅ 数据模型明确删表/保留列/migration 步骤
- ✅ 兼容策略含回退路径 + Wave 时序
- ✅ 风险登记覆盖 P0（daemon-client spec_root）+ P1（时序/调用方/CASCADE/粒度）+ P2
- ✅ 决策追踪 D-001~D-008 全部 accepted，与 step 6/7/9 用户拍板一致
- ✅ 非目标明确（不动变更流程/daemon/scan 质量/权限枚举/视觉）
- ⚠️ topology 页最终方案（R-07）留 plan 阶段定
- ⚠️ reparse 所有调用方（R-03）需在 execute 前全局 grep 确认
