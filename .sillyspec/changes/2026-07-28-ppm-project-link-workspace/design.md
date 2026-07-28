---
author: qinyi
created_at: 2026-07-28 13:40:09
change: 2026-07-28-ppm-project-link-workspace
scale: large
---

# 设计文档(Design)— PPM项目关联平台工作区

> 本变更为「PPM 项目维护 ↔ 平台工作区 关联」总体规划的 **A 阶段(关联骨架)**。
> B 阶段(项目维度会话式 AI 开发入口 + 重做会话界面 + PC/手机)是下一个独立变更,依赖本关联。
> 用户原始诉求:**在 PPM 项目里能像 Claude Code 桌面版那样,通过会话和关联工作区的代码 + AI Agent 交互**。该核心诉求落在 B 阶段;本阶段先把「项目和谁关联」管好。

## 1. 背景

- **PPM 项目维护**(`PpmProjectMaintenance`,表 `ppm_project_maintenance`,`backend/app/modules/ppm/project/model.py:42`)是 PPM 模块「项目」本体——一份业务项目档案(编号/名称/客户/类型/状态/维保期),PPM 全部业务(计划/问题清单/任务/成员/工时)以它为根。它是**平台级实体,目前无任何指向工作区的字段**(D-001@v1 明确「平台级:无 workspace_id」)。
- **平台工作区**(`Workspace`,表 `workspaces`,`backend/app/modules/workspace/model.py:22`)是注册到平台的 Git 仓库 + SillySpec 工作空间,AI Agent 编排、变更生命周期、会话式开发都在此进行。工作区已用 M:N 关联表挂载了 `task`(`TaskWorkspace`)和 `agent_run`(`AgentRunWorkspace`),且**目前无任何指向 PPM 项目的关联字段**。
- 现状:两套体系各自独立——业务项目档案在 PPM、代码与 AI 开发在工作区,互不相通。用户希望打通:一个 PPM 项目可以挂多个工作区,项目成员最终(在 B 阶段)能进入关联工作区做会话式开发。
- 两边都是「白纸」(无现有关联字段/数据语义冲突),加关联表无历史包袱;唯一对外 FK 是 PPM 的 `organization_id`,自 2026-07-22 权限统一到「项目成员角色」后已退役,不影响本变更。

## 2. 设计目标

1. 建立 PPM 项目 ↔ 工作区 **多对多关联**(一个项目可挂多个工作区,一个工作区可挂多个项目)。
2. **双边对称设置**:项目维护页、工作区详情页两边都能绑定/解绑对方,操作同一份关联数据,自动一致。
3. **关联后互相可见**:项目页看到关联工作区(名/状态/类型);工作区页看到关联项目(名/状态)。
4. 为 B 阶段(项目→关联工作区→会话)提供数据基础。
5. 零破坏:不动 PPM 现有已上线功能,不动工作区现有 task/agent_run 关联。

## 3. 非目标(Non-Goals)

- ❌ **不做会话式开发入口**(B 阶段):不在项目页加「进会话」、不重做会话界面、不接 agent_run 交互。
- ❌ **不做关联元数据**:不记关联类型/主次/备注/角色,纯关联(复合主键)。
- ❌ **不做手机端**:本阶段仅 PC 网页;手机端随 B 阶段一起做。
- ❌ **不做权限传递**:不做「项目成员自动获得关联工作区会话权限」——这是 B 阶段的权限议题。
- ❌ **不做任务↔变更数据联动**:不把 PlanTask 绑定到 change/agent_run(B 阶段或更后)。

## 4. 拆分判断

- 用户明确选择「先关联,再会话入口」分两步。A(关联骨架)是 B(会话入口)的**硬前置**:B 的「项目→工作区→会话」依赖 A 的关联记录。
- A 独立可交付、可验证(关联 CRUD + 双边 UI + 互相可见),不依赖 B。
- **不走批量模式**:这是单一关联关系,不是「模板 × N 实例」,无批量特征。

## 5. 总体方案

沿用工作区现有 M:N 关联模式(`TaskWorkspace` / `AgentRunWorkspace` 已铺路),新增 `PpmProjectWorkspace`,把 PPM 项目作为又一种「挂到工作区上的业务实体」。工作区作为**关联中枢**,双边操作同一张表。

### Phase 1 — 数据模型
- `workspace/model.py` 新增 `PpmProjectWorkspace`(仿 `TaskWorkspace`):复合主键 `(ppm_project_id, workspace_id)`,双向 `ON DELETE CASCADE`,索引 `workspace_id`。
- 一个 Alembic migration:`ppm_project_workspace` 建表。

### Phase 2 — 后端 API + 权限
- 关联底层逻辑封装在 `workspace/link_service.py`(bind/unbind/list,表级操作,权限无关)。
- **两个 router 对称暴露**:`workspace/link_router.py`(工作区维度)+ `ppm/project/router.py`(项目维度,新增端点),都调同一个 link_service,操作同一张表。
- **双边各自权限校验**:工作区侧 bind/unbind = 工作区成员(`require_permission(WORKSPACE_*)`);项目侧 = PPM 项目 manager(复用 `ppm/common/data_scope.py` 的 `manager_project_ids`)。两个维度都能绑定/解绑,体验对称。

### Phase 3 — 前端(双边,PC)
- `ppm/projects` 列表行加「关联工作区」按钮 → 弹窗(已关联可解绑 / 可选工作区可绑定)。
- `workspaces/[id]` 详情页加「关联项目」区块(对称:已关联可解绑 / 搜索项目可绑定)。
- 互相可见字段:项目看工作区 `name/status/type`;工作区看项目 `project_name/project_status`。

### Phase 4 — 不做(YAGNI)
见 §3 非目标。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/model.py` | 新增 `PpmProjectWorkspace` 类(仿 `TaskWorkspace`) |
| 新增 | `backend/migrations/versions/202607281500_ppm_project_workspace.py` | 建表 migration(revision=202607281500 唯一 + down_revision 接当前 head 202607271700) |
| 新增 | `backend/app/modules/workspace/link_service.py` | 关联表级逻辑(bind/unbind/list,权限无关,供两 router 复用) |
| 新增 | `backend/app/modules/workspace/link_router.py` | 工作区维度关联接口(挂 `/api/workspaces`) |
| 修改 | `backend/app/modules/ppm/project/router.py` | 项目维度关联接口(挂 `/api/ppm/projects`,新增端点,只读写新关联表) |
| 修改 | `backend/app/main.py` | sibling include 注册 link_router(仿 `members_router`,main.py:485 范式) |
| 修改 | `backend/app/modules/workspace/schema.py` | 关联请求/响应 DTO |
| 新增 | `backend/app/modules/workspace/tests/test_link_service.py` | 表级逻辑测试 |
| 新增 | `backend/app/modules/workspace/tests/test_link_router.py` | 工作区维度接口+权限测试 |
| 新增 | `backend/tests/modules/ppm/test_project_workspace_link.py` | 项目维度接口+权限测试 |
| 修改 | `frontend/src/lib/workspace.ts`(或新建 link api 模块) | 调用关联 API 的客户端函数 |
| 修改 | `frontend/src/app/(dashboard)/ppm/projects/page.tsx` | 列表行加「关联工作区」按钮 |
| 新增 | `frontend/src/components/workspace/LinkWorkspaceDialog.tsx` | 项目侧关联工作区弹窗 |
| 新增 | `frontend/src/components/workspace/LinkedProjectsSection.tsx` | 工作区侧关联项目区块 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 嵌入「关联项目」区块 |
| 新增 | `frontend/src/components/workspace/__tests__/LinkWorkspaceDialog.test.tsx` | 弹窗绑定/解绑交互测试 |
| 新增 | `frontend/src/components/workspace/__tests__/LinkedProjectsSection.test.tsx` | 区块对称操作测试 |
| 修改 | `frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx` | 预存类型漂移修复(mkBinding fixture 补 MemberBindingView.shared 必填字段,regen api-types 暴露,仅补 fixture 未动断言) |
| 重新生成 | `frontend/src/lib/api-types.ts` | pnpm gen:types 重新生成(含本变更新端点+顺带同步过期 schema,纯生成产物) |
| 重新生成 | `backend/openapi.json` | dump_openapi 重新导出(342 paths/408 schemas,含新端点,纯生成产物) |

> PPM 后端**零数据模型改动**:项目维度端点只读写新关联表 `ppm_project_workspace`,不碰 PPM 现有表/业务逻辑,对已上线 PPM 模块无侵入。plan 阶段细化每个文件的函数签名与改动点。

## 7. 接口定义

### 数据结构
```
PpmProjectWorkspace:
  ppm_project_id: UUID  (FK→ppm_project_maintenance.id, CASCADE, PK)
  workspace_id:    UUID  (FK→workspaces.id, CASCADE, PK)
  # 复合主键天然防重复绑定;无额外元数据(YAGNI)
```

### REST 接口(双边对称,操作同一张表)
| 方法 | 路径 | 作用 | 权限 |
|---|---|---|---|
| GET | `/workspaces/{workspace_id}/ppm-projects` | 列出工作区关联的项目 | 工作区可见 |
| POST | `/workspaces/{workspace_id}/ppm-projects` | 绑定 `{ppm_project_id}` | 工作区成员 |
| DELETE | `/workspaces/{workspace_id}/ppm-projects/{ppm_project_id}` | 解绑 | 工作区成员 |
| GET | `/ppm/projects/{project_id}/workspaces` | 列出项目关联的工作区 | 项目可见 |
| POST | `/ppm/projects/{project_id}/workspaces` | 绑定 `{workspace_id}` | 项目 manager |
| DELETE | `/ppm/projects/{project_id}/workspaces/{workspace_id}` | 解绑 | 项目 manager |

> **双边对称**:项目侧和工作区侧各自 GET/POST/DELETE,操作同一张 `ppm_project_workspace` 表,各自权限校验。link_service 封装同一套底层 bind/unbind/list,两个 router 分别调用——既保证数据一致(一张表),又让两个维度的 UI 各自能完整操作(绑定/解绑),体验对称。归属明确:工作区维度接口在 `workspace/link_router.py`(prefix `/workspaces`),项目维度接口在 `ppm/project/router.py`(prefix `/ppm/projects`),与各自现有路由分层一致。

## 7.5 生命周期契约

**不涉及生命周期契约。** 本变更(A 阶段·关联骨架)仅新增静态多对多关联表 `ppm_project_workspace` 与双边 CRUD 接口,不新增或改变 `session` / `lease` / `agent_run` / `daemon` / `lifecycle` 的任何事件、状态机或必需字段。B 阶段(项目会话开发入口)才会触及 `agent_run` / `session` 生命周期,届时在该变更单独建表。

## 8. 数据模型

新增表 `ppm_project_workspace`(类 `PpmProjectWorkspace`,定义于 `workspace/model.py`,模式与 `TaskWorkspace` 完全对齐):

| 列 | 类型 | 约束 |
|---|---|---|
| `ppm_project_id` | UUID | FK→`ppm_project_maintenance.id` ON DELETE CASCADE,主键 |
| `workspace_id` | UUID | FK→`workspaces.id` ON DELETE CASCADE,主键 |

- 索引:`ix_ppm_project_workspace_workspace` on `workspace_id`(对齐 `TaskWorkspace` 的工作区维度查询索引)。
- 复合主键 `(ppm_project_id, workspace_id)` 天然防止重复绑定,无需额外唯一索引。
- 不新增列、不改现有表(零破坏)。

## 9. 兼容策略(brownfield)

- **未关联的项目/工作区**:行为完全不变,列表/详情与现状一致。
- **PPM 已上线模块**:PPM 后端**零数据模型改动**,仅 `ppm/project/router.py` 新增关联端点(只读写新关联表,不动 PPM 现有表/业务逻辑),前端 `ppm/projects` 仅新增一个按钮列,不影响现有增删改查/导出/成员管理。
- **工作区现有关联**:`TaskWorkspace` / `AgentRunWorkspace` 不受影响,新增表与之并列。
- **回退路径**:若需禁用,仅下线前端两个入口 + 两 router 的关联端点即可,数据表保留无副作用。
- **数据迁移**:无存量数据需迁移(新表,历史项目/工作区关联为空)。

## 10. 风险登记(Risk)

| ID | 风险 | 应对 |
|---|---|---|
| R1 | migration chain 冲突(多个活跃变更并行加 migration,revision/down 分叉致多 head → 启动 crash-loop,SQLite 抓不到 PG 才暴露) | migration 用唯一 revision id;`down_revision` 接当前真实 head(`202607271700`);部署前 `alembic heads` 校验单 head |
| R2 | 双边权限模型越权(工作区成员 vs 项目成员角色两套体系) | bind/unbind 在两个 router 分别校验:工作区侧 `require_permission(WORKSPACE_*)`,项目侧 ppm `manager_project_ids`/`data_scope`;写测试覆盖越权 403 |
| R3 | PPM 项目删除与关联级联 | `ppm_project_maintenance` 已被 `PpmProjectMember`/`PpmProjectStakeholder` 强 FK CASCADE 引用(model.py:224/311);本表同样 CASCADE,删项目同步删关联,行为一致 |
| R4 | workspace 软删除(`deleted_at`/`status=deleted`)下关联残留 | 关联列表查询过滤 `workspace.deleted_at IS NULL`;硬删触发 CASCADE 自动清理(与 `TaskWorkspace` 同策略) |
| R5 | 唯一约束/重复绑定 | 复合主键天然防重;重复绑定返回 409(非 500) |
| R6 | PPM 项目可能跨工作区重复展示 | 多对多为预期行为;前端按工作区分组展示,不做去重 |

## 11. 自审(Self-Review)

- [x] **lifecycle 关键词**:design 提及 workspace/task/agent_run(背景)与 B 阶段 session/agent_run(非目标)。A 阶段本身不引入生命周期事件 → §7.5 已写豁免「不涉及生命周期契约」(否定词紧邻关键词),合规。
- [x] **文件清单**:覆盖 后端(model+migration+service+两 router+main.py+schema+3组测试)、前端(两页+弹窗组件+区块+测试),无遗漏。
- [x] **权限**:双边各自校验(R2),写测试覆盖 403。
- [x] **兼容**:零数据模型改动(§9),PPM 后端仅加关联端点。
- [x] **数据模型**:仿 `TaskWorkspace`,模式一致;复合主键防重。
- [x] **migration**:唯一 revision + down 接 head(R1)。
- [x] **YAGNI**:砍掉元数据/会话/手机/权限传递(§3)。
- 自审结论:通过。

### Design Grill 交叉审查(independent 子代理)结论与采纳

independent 子代理审查 verdict = **specVerdict: pass / qualityVerdict: pass**(非阻断)。发现并已采纳修正:
1. **migration 路径事实错误**:`backend/alembic/versions/` → 修正为 `backend/migrations/versions/`(§6)。
2. **router 注册点事实错误**:`workspace/__init__.py` → 修正为 `backend/app/main.py` sibling include(仿 `members_router`,main.py:485 范式)(§6)。
3. **接口归属矛盾**:原 §6「PPM 不新增端点」与 §7「GET /ppm/projects/{id}/workspaces」冲突 → 统一为**双边各自 GET/POST/DELETE,各自权限,操作同一张表**(§5 Phase2 / §6 / §7)。
4. **权限口径不一致**:§5 Phase2 与 §7 备注项目侧权限口径不一 → 统一为双边对称各自校验。
- 子代理核实确认:`PpmProjectWorkspace` 仿 `TaskWorkspace` 可行(workspace/model.py:135-160);双边 CASCADE 与现有 FK 一致;PPM `data_scope`/`manager_project_ids` 可落地;工作区成员 `require_permission(WORKSPACE_*)` 可落地;R3/R4 断言属实。
