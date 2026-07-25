---
author: qinyi
created_at: 2026-07-25 17:51:38
scale: large
---

# 设计文档（Design）— 业务/管理人员借用开发人员 daemon 读源码出业务方案

## 1. 背景

系统有两类用户：
- **开发人员**：电脑上装了 daemon（本地 Agent 守护进程）+ 持有项目源码。daemon 是"源码访问 + agent 运行"的载体（通过 Claude/Codex 等 provider 拉起 agent 进程）。
- **业务/管理人员**：电脑上既无 daemon 也无源码。

诉求：业务/管理人员要能**借用开发人员的 daemon**，去读开发机器上的源码、跑 agent 分析、产出业务方案，方案要落系统。

现状（已查证，commit 基线 main @ 2026-07-25）：
- `collaborative-workspace` 变更（已合入主干 `e2f65d9a`）支持多用户共享工作空间，per-member 绑定表 `workspace_member_runtimes`（PK `workspace_id+user_id`），但模型是"每个成员各自绑定**自己的** daemon"，仍是"各自自带"，不允许借用他人 daemon。
- 三道硬闸门明确禁止借用他人 daemon：
  1. **绑定闸** `backend/app/modules/workspace/member_runtimes/service.py:49-56`：配 binding 时 `daemon.user_id != user_id` → `403 daemon_not_owned`。
  2. **派发闸** `backend/app/modules/workspace/member_runtimes/queries.py:38-48` + `backend/app/modules/agent/placement.py:768-775`：agent 派发 SQL `WHERE daemon.user_id = 当前操作者`，无自有 daemon 抛 `NoOnlineDaemonError("工作区未绑定守护进程")`。
  3. **角色闸** `backend/app/modules/auth/permissions.py:78` + `backend/app/modules/agent/router.py:305`：viewer 无 `task:run_agent`；PPM 经理角色（`ppm/common/data_scope.py:31-34`）只管数据可见范围，不授予 agent 能力。
- **已有突破口**：host_fs 委托读文件那条路是"按工作空间解析 daemon、不校验 user_id"的窄路 —— `workspace/member_runtimes/queries.py:115-168` `resolve_daemon_instance_for_workspace`（"取带 daemon_id 的成员行即源宿主 daemon"）。本变更核心 = 把这种"工作空间级共享 daemon"能力从"只读文件"扩展到"完整 agent 派发"，并加授权控制。

查证结论（无硬阻塞）：既有 placement resolver 框架、file service 直接入口、daemon 并发（`config.ts:317` `max_concurrent_tasks=5`）+ worktree 机制、权限枚举/迁移/缓存都已就绪。

## 2. 设计目标

- 业务/管理人员**无需**装 daemon、无需源码，借用工作空间里开发人员"共享出来"的 daemon，跑 agent 读源码、出业务方案。
- daemon 归属人（开发人员）主动共享，工作空间 owner 可见可撤销。
- 业务方案落到平台文件中心（MinIO），业务人员工作台可见。
- 借用全程审计（不限额）。
- **不污染开发人员代码区**（借用任务只读源码、产出回传 backend，不写开发代码）。
- 零回归：现有"自带 daemon"路径行为不变，借用是纯增量能力。

## 3. 非目标

- **不做服务器侧 agent**：不回退已删的 SERVER backend，业务 agent 始终跑在开发人员的 daemon 上（契合"借用开发人员 agent"诉求，对应方案对比中的方案 C 被排除）。
- **不做审批流**：业务人员自动借用工作空间共享 daemon，无需 owner/出借人逐次审批（YAGNI，对应方案 B 被排除）。
- **不做额度限额**：借用消耗开发人员 API 额度，仅审计不限额（D-004）。
- **不做跨工作空间借用**：借用边界 = 工作空间成员资格（信任边界内）。
- **不改 collaborative-workspace 既有 per-member 自带模型**：自有 daemon 路径完全保留，借用是回退分支。
- **业务人员不改代码**：只读源码 + 出方案，不写开发代码区。
- **不做 HTML 原型/独立前端大改**：前端为辅助（共享开关 + 触发 + 方案查看），UI 草图留 plan 阶段前端 task 细化。

## 4. 拆分判断

- **单变更**，6 Phase。目标单一（让借用走通），不拆子变更。
- **不走批量模式**：无重复模式（不是 N 个相似页面/报表）。
- 涉及多模块（workspace/agent/auth/daemon/file/frontend）但耦合于同一数据流（借用派发），作为整体设计。

## 5. 总体方案

按 6 个 Phase 组织（详见各节）。核心数据流：

```
业务人员点"跑 agent"
  → placement._resolve_borrowed_or_own_runtime: 查自己 binding → 无自有在线 daemon
  → 借用查询: WHERE workspace=本 AND shared=True AND daemon 非空 AND 归属人≠业务人员 AND online
  → 命中开发人员 shared+在线的 daemon，解析 runtime dict，标记 borrowed=True(带 lender)
  → 校验 DAEMON_BORROW 权限 + shared + online
  → 准备独立 sandbox 目录(slug=borrow-<actor>-<run_id>) + 独立 runtime_id/只读 policy
  → 建 interactive lease,派发到开发人员的 daemon
  → daemon 跑 agent(读源码,只读,不写代码区) → 出方案
  → submit_lease_messages 回传方案文本
  → backend: FileService.upload_file → 落文件中心(owner_type=workspace, uploaded_by=业务人员)
  → 业务人员工作台可见方案 + 写借用审计
```

### Phase 1 — 数据模型 + 共享授权

给 `workspace_member_runtimes` 加 `shared` 列（bool，默认 false，部分索引 `WHERE shared=TRUE`）。**不新建表**（D-005）：该表语义本就是"成员把自己的 daemon 绑给工作空间"，加 shared 是自然延伸；复用 PK `(workspace_id, user_id)` 的信任边界，lender 必须先是工作空间成员；撤销 = `shared=False`，无需独立 revoke 流程。

新增 `daemon_borrow_audit` 表（borrower_user_id / lender_user_id / daemon_instance_id / workspace_id / agent_run_id / borrowed_at / usage_summary），对应 D-004 审计不限额。

### Phase 2 — 权限模型

新增权限点 `DAEMON_BORROW = "daemon:borrow"`（`auth/permissions.py`，group 路由加 `daemon` 前缀分支落 AGENT 组）。

新增工作空间级角色 `business_member`（D-006@v2，Design Grill F-01 修正），权限组合 = `task:run_agent` + `daemon:borrow` + 工作空间读。**关键澄清**：`task:run_agent` 仅让业务人员能"触发"现有 agent run 端点（`agent/router.py:305` 鉴权通过），**不**意味着能跑自有 agent——因业务人员无自有 daemon，placement 必然走借用回退，回退需 `daemon:borrow` 授权。因此**复用现有 agent 端点、不改端点鉴权**，business_member 因无自有 daemon 天然只能借、不会"全量跑自有 agent"。owner 把业务人员加成该角色（`workspace/members_service.py:42` `ROLE_KEY_WHITELIST` 需加 `business_member`，F-04）。

新建**独立迁移** INSERT 权限种子 + business_member 角色（**不改**历史迁移 `202605280900`，因已部署 DB 不会再跑）。grant 后对齐 `rbac-permission-cache` 变更触发 `invalidate_all_permissions`（`core/permission_cache.py:231-257`），否则首次借用命中旧缓存失败。

### Phase 3 — 派发链路（核心难点 1）

抽共享 helper `_resolve_borrowed_or_own_runtime(workspace_id, user_id, provider) -> runtime_dict | None`（D-008）：
1. 先查 actor 自己的 binding（现有 `MemberBindingResolver.resolve_member_binding`）→ 有在线自有 daemon 就返回（零回归原路径）；
2. 无则走借用查询 `resolve_shared_daemon_for_borrow(session, workspace_id, actor_user_id, provider)`（新建，基于 `resolve_daemon_instance_for_workspace` 的 SQL shape 叠加 `AND shared=TRUE AND user_id <> actor AND status='online'` + provider 解析 `_query_runtime_by_daemon_and_provider`）→ 返回借用 runtime + 标记 `borrowed=True`/`lender_user_id`；
3. 内部三重校验：actor 有 `DAEMON_BORROW` + lender binding `shared=True` + daemon online。

**4 路派发解析统一调该 helper**（只改一处会重现 D-007 当年"决策通过但派发报错"的语义割裂）：
- `_resolve_dispatch_runtime`（`agent/placement.py:690-807`，主派发，749-754 无 binding / 771-775 离线两处接入）
- `_resolve_decide_runtime`（`placement.py:855-944`，决策预检，900-905 / 921-926 接入）
- `resolve_runtime_for_writeback`（`workspace/member_runtimes/resolver.py:59-150`，写回，106-109 / 120-125 接入）
- `prepare_interactive_dispatch` 的 `_get_online_runtime`（`placement.py:408`，业务人员 quick-chat 走这条 user 级查询，不看 workspace binding，**必须单独改造**或调用方前置解析借用 daemon）

### Phase 4 — daemon 侧沙箱隔离（核心难点 2、3）

查证两个坑：
1. daemon 不自动隔离：agent cwd 直接取 lease `rootPath`（`sillyhub-daemon/src/daemon.ts:2723`）。backend 派发前必须**显式准备独立目录**——复用 `prepareWorkspace` mirror by slug 机制（`workspace.ts:118-160`），slug = `borrow-<actor>-<run_id>`，把路径塞进 lease metadata。**不复用 `WorktreeLease`**（`worktree/model.py:26-67` 强制 change_id/task_id/git_identity_id NOT NULL + 依赖 repo_url，borrow 场景无这些）。
2. **借用若复用 lender 的 runtime_id，会命中 PolicyEngine 写策略缓存（`session-manager.ts:1037-1102`）继承 lender 写权限**，与"不污染开发代码"直接冲突（核心难点 3）。

应对（D-007@v2，Design Grill F-02 调整）：**候选 B 为本变更主路径**——复用 lender runtime_id，但 PolicyEngine 按 **lease 而非 runtime** 隔离 allowed_roots（borrow lease 显式只读 root_path，不写代码区）。候选 A（daemon 侧注册独立 runtime_id）依赖 daemon runtime 注册模型支持"一物理 daemon 给同一 lender 注册多隔离 runtime"，可行性存疑（R-09 待 plan spike），降为可选优化。候选 B 不依赖 daemon 注册模型改造，落地风险更低。

借用产出只走 `submit_lease_messages` 回传，不落 sandbox。

> 并发：`max_concurrent_tasks=5`（`config.ts:317`）全 daemon 共享，业务借用占开发人员自己的额度。先不额外限制（审计可见），文档注明（R-03）。

### Phase 5 — 方案落点（file 桥接）

查证确认 `FileService.upload_file`（`backend/app/modules/file/service.py:66-109`）直接吃 `data: bytes`，可被 backend service 直接调（不经前端上传）。

agent run 完成（interactive 收口走 `close_interactive_run` / `complete_lease` 回调，Design Grill F-03 指明钩子），backend 在该回调拿方案文本 → 调 `FileService.upload_file(original_name="方案-<run>.md", data=text.encode(), mime_type="text/markdown", uploaded_by=actor_id, owner_type="workspace", owner_id=ws_id)`。File 表无 workspace_id，用现成多态 `owner_type/owner_id`（`file/model.py:43-51`）。针对 PPM 问题的方案可额外 `owner_type="ppm_problem"`。

**待 plan 确认**（R-04）：`text/markdown` 是否在 `settings.file_allowed_type_set` 白名单（`service.py:59-64`），不在则加配置或用 `text/plain`；size 不超 `file_max_size_mb`。

### Phase 6 — 前端

- 业务人员：正常触发 agent（背后自动借用，无感）+ 文件中心/工作台看方案。
- 开发人员（出借人）：工作空间设置里"共享我的 daemon"开关（标 shared）。
- workspace owner：成员/设置页看所有共享 daemon + 撤销 + 给成员授 business_member 角色。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/member_runtimes/model.py` | 加 `shared` 列（bool，server_default false）+ 部分索引 |
| 新增 | `backend/migrations/versions/2026072511xx_daemon_borrow_shared.py` | workspace_member_runtimes 加 shared 列迁移 |
| 修改 | `backend/app/modules/workspace/member_runtimes/queries.py` | 新增 `resolve_shared_daemon_for_borrow(session, ws, actor, provider)` |
| 修改 | `backend/app/modules/workspace/member_runtimes/service.py` | 标记/撤销 shared 端点（lender 标自己 / owner 撤销） |
| 修改 | `backend/app/modules/workspace/members_service.py` | `ROLE_KEY_WHITELIST`(42) 加 `business_member`（F-04） |
| 新增 | `backend/app/modules/agent/borrow_resolver.py` | 共享 helper `_resolve_borrowed_or_own_runtime` + 借用查询封装 |
| 修改 | `backend/app/modules/agent/placement.py` | `_resolve_dispatch_runtime`(690-807) / `_resolve_decide_runtime`(855-944) / `prepare_interactive_dispatch._get_online_runtime`(408) 三路接入 helper |
| 修改 | `backend/app/modules/workspace/member_runtimes/resolver.py` | `resolve_runtime_for_writeback`(59-150) 接入 helper |
| 修改 | `backend/app/modules/auth/permissions.py` | 新增 `DAEMON_BORROW` 枚举 + `daemon` 前缀 group 分支 |
| 新增 | `backend/migrations/versions/2026072512xx_add_daemon_borrow_permission.py` | INSERT business_member 角色 + DAEMON_BORROW 权限种子；末尾 invalidate 缓存 |
| 新增 | `backend/app/modules/agent/borrow_audit_model.py`（或并入现有 model） | `daemon_borrow_audit` 表模型 |
| 不改 | `backend/app/modules/agent/router.py` | D-006@v2：复用现有 agent 端点，business_member 带 task:run_agent 过鉴权 + daemon:borrow 借用回退，不改端点鉴权 |
| 修改 | `backend/app/modules/agent/`（run 完成回调链路） | turn completed 时落方案到 FileService + 写借用审计 |
| 修改 | `backend/app/modules/file/service.py` 或 config | 确认/补 text(markdown) 白名单（R-04） |
| 修改 | `sillyhub-daemon/src/daemon.ts`（+ workspace.ts / session-manager.ts） | borrow lease 独立 sandbox slug 目录 + 独立 runtime_id/只读 policy（候选 A/B，plan spike） |
| 修改 | `frontend/src/`（workspace 设置 + 成员管理 + agent 触发 + 文件查看） | 共享开关 / owner 管理 / 业务触发无感 / 方案查看 |

## 7. 接口定义

### 后端 HTTP
- `PUT /api/workspaces/{ws_id}/my-binding/shared` — lender 标记自己 binding 为 shared（body: `{shared: bool}`）。鉴权：binding 归属本人。
- `GET /api/workspaces/{ws_id}/shared-daemons` — owner 查工作空间所有共享 daemon 列表（含 lender、在线状态、可撤销）。
- `PUT /api/workspaces/{ws_id}/members/{user_id}/role` — 复用现有成员角色接口授 `business_member`。
- agent 触发：复用现有 `/api/agent/...` 端点；placement 自动判别 actor 有无自有 daemon，无则走借用（业务人员无感）。

### 核心 helper / 查询签名
```python
# borrow_resolver.py
async def _resolve_borrowed_or_own_runtime(
    session, workspace_id, user_id, provider
) -> tuple[dict | None, bool, uuid.UUID | None]:
    """返回 (runtime_dict, borrowed, lender_user_id)。
    先查自有 binding（零回归），无则借用查询。
    borrowed=True 时 runtime_dict 来自 lender daemon。"""

# queries.py
async def resolve_shared_daemon_for_borrow(
    session, workspace_id, actor_user_id, provider
) -> dict | None:
    """WHERE workspace_id=:ws AND shared=TRUE AND daemon_id IS NOT NULL
       AND user_id <> :actor AND status='online'
       叠加 provider 解析，返回 runtime dict 或 None。
       内部校验 actor 有 DAEMON_BORROW 权限。"""
```

### 数据结构
- borrow runtime dict：复用 placement 现有 `{id, user_id(lender), provider, status, daemon_instance_id}` shape（`placement.py:793`）+ 借用标记。
- daemon_borrow_audit 行：`{borrower_user_id, lender_user_id, daemon_instance_id, workspace_id, agent_run_id, borrowed_at, usage_summary}`。
- 落 file 调用：`FileService.upload_file(original_name, data: bytes, mime_type, uploaded_by=actor, owner_type="workspace", owner_id=ws_id)`。

## 7.5 生命周期契约表

本变更涉及 `daemon / lease / agent_run / session / complete` 关键词，必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 创建借用 lease | backend | (DB) | leaseId, borrower_user_id, lender_user_id, daemon_instance_id, sandbox_rootPath, provider, borrowed=true | lease pending |
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | pending → running（复用现有协议） |
| create session | backend | daemon | sessionId, leaseId, isolated_runtime_id（或 readonly policy key）, rootPath=sandbox | session active |
| submit message | daemon | backend | leaseId, claimToken, agentRunId, messages(含方案文本) | append messages |
| turn result | daemon | backend | runId, status=completed, output | running → completed |
| 落 file + 审计 | backend | file/audit | uploaded_by=borrower, owner_type=workspace, owner_id=ws, agent_run_id, lender, usage | 方案落库 + 审计写入 |
| session end | daemon | backend | sessionId, reason | active → ended（复用现有） |

> claim/create session/submit/turn result/session end 复用 collaborative-workspace 既有 lease/session 协议（`daemon/router.py` 回调端点），本变更只新增"创建借用 lease"的派发逻辑 + "落 file+审计"的完成回调钩子，不改协议本身。

## 8. 数据模型

### 修改表
`workspace_member_runtimes`（`backend/app/modules/workspace/member_runtimes/model.py:21-97`）：
- 新增 `shared: bool`，`Column(Boolean, nullable=False, server_default=sa.text("false"))`，默认 false。
- 新增部分索引 `ix_wmr_shared` `WHERE shared=TRUE`（优化借用查询）。

### 新增表
`daemon_borrow_audit`：
| 列 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| borrower_user_id | UUID | FK users.id CASCADE, NOT NULL |
| lender_user_id | UUID | FK users.id CASCADE, NOT NULL |
| daemon_instance_id | UUID | FK daemon_instances.id RESTRICT, NOT NULL |
| workspace_id | UUID | FK workspaces.id CASCADE, NOT NULL |
| agent_run_id | UUID | FK agent_runs.id CASCADE, NOT NULL |
| borrowed_at | DateTime(tz) | NOT NULL |
| usage_summary | JSON | nullable（token/turn 数等） |

### 角色 / 权限
- 新增 permission `daemon:borrow`（`Permission` 枚举）。
- 新增 workspace 级角色 `business_member`（seed 到 `roles` + `role_permissions`：`daemon:borrow` + workspace 读权限集合）。

## 9. 兼容策略（brownfield）

- `shared` 默认 false：现有所有 binding 行为完全不变，现有"自带 daemon"派发路径零回归（helper 第 1 步命中自有 daemon 即原路径返回）。
- `DAEMON_BORROW` 默认不授予任何现有角色：未授 `business_member` 的用户无借用能力，行为不变。
- 4 路 resolver：actor 有自有在线 daemon 时走原路径，仅"无自有 daemon + 有 DAEMON_BORROW"时才回退借用，纯增量。
- 借用 lease/session 协议复用既有，不改 daemon ↔ backend 通信契约（仅新增 sandbox_rootPath / isolated_runtime_id 字段，daemon 未知字段忽略不破坏）。
- 不改 `workspace_member_runtimes` 既有列语义，不改 `collaborative-workspace` 任何既有行为。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 4 路派发 resolver 借用兜底不一致（漏改一路 → decide 通过但 dispatch 报错，重现 D-007） | P0 | 收敛到共享 helper `_resolve_borrowed_or_own_runtime`，4 路统一调用；verify 用单测覆盖每一路 |
| R-02 | 借用复用 lender runtime_id → PolicyEngine 命中 lender 写缓存 → 继承开发人员代码区写权限 | P0 | 借用任务独立 runtime_id 或按 lease 隔离的只读 policy（候选 A/B，plan spike）；verify 写边界测试 |
| R-03 | daemon 并发上限全 daemon 共享（默认 5），业务借用挤占开发人员自己的额度 | P1 | 先不额外限制，借用审计可见；文档注明；后续可按 actor 分配额度 |
| R-04 | `text/markdown` 可能不在 `file_allowed_type_set` 白名单，落方案 415 | P1 | plan 确认白名单，不在则加配置或用 text/plain |
| R-05 | grant DAEMON_BORROW 后 `rbac-permission-cache` 命中旧缓存，首次借用失败 | P1 | grant 走 service 层自动失效；裸 SQL 迁移末尾调 invalidate_all_permissions 或部署刷 Redis |
| R-06 | 跨变更冲突：rbac-permission-cache（权限缓存）/ llm-provider-management（provider 额度）/ platform-file-center（file 落点）同期开发 | P1 | plan 前对齐三个变更设计，借用权限/落点/provider 解析避免重叠 |
| R-07 | `prepare_interactive_dispatch` 走 user 级 `_get_online_runtime` 不看 workspace binding，业务 quick-chat 借用漏接 | P1 | 该路单独改造或调用方前置解析借用 daemon；单测覆盖 |
| R-08 | spec_transport 双模式（shared/tar）对借用产出回传的影响 | P2 | 方案落 file 走 FileService 不走 spec_transport，应不受影响；plan 确认 |
| R-09 | daemon 侧独立 runtime_id 注册模型是否支持（候选 A 可行性） | P2 | plan 阶段 spike daemon runtime 注册；不可行则 fallback 候选 B |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：
- **D-001@v1** 方案落点=文件中心为主（问题相关挂 PPM 问题清单）→ 覆盖 Phase 5、FR-落点
- **D-002@v1** 借用方式=自动用工作空间共享 daemon → 覆盖 Phase 3
- **D-003@v1** 授权=daemon 主人主动共享 + owner 可撤销 → 覆盖 Phase 1
- **D-004@v1** 额度=审计不限额 → 覆盖 Phase 1 审计表、R-03
- **D-005@v1** 共享标记=加 shared 列到 workspace_member_runtimes（不新建表）→ 覆盖 Phase 1、§8
- **D-006@v1** 借用角色=新增 workspace 级 business_member（带 DAEMON_BORROW）→ 覆盖 Phase 2
- **D-007@v1** daemon 沙箱=独立 sandbox slug + 独立 runtime_id/只读 policy（不复用 lender runtime）→ 覆盖 Phase 4、R-02
- **D-008@v1** 派发收敛=共享 helper 4 路统一调用 → 覆盖 Phase 3、R-01
- **D-009@v1** 落点=FileService.upload_file，owner_type=workspace → 覆盖 Phase 5
- **D-010@v1** 落 file 钩子=close_interactive_run/complete_lease 回调 → 覆盖 Phase 5、FR-06

仍需 plan spike 的开放项：R-02 候选 A/B（独立 runtime_id 可行性）、R-04 白名单、R-09 daemon runtime 注册模型。无未解决的核心决策。

## 12. 自审

- [x] 必填章节齐全：背景 / 设计目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 接口定义 / 生命周期契约表 / 数据模型 / 兼容策略 / 风险登记 / 决策追踪 / 自审。
- [x] 生命周期契约表：本变更涉及 daemon/lease/agent_run/session/complete 关键词，已含表（§7.5）。
- [x] decisions.md 引用：D-001~D-009 均在 §11 追踪且映射到 Phase/FR。
- [x] 文件变更清单：每行带文件路径 + 说明。
- [x] 依据：三道闸门、突破口、4 路 resolver、file 入口、daemon 沙箱机制均带 `文件:行号`。
- [x] 兼容策略：明确零回归路径（shared 默认 false / DAEMON_BORROW 默认不授 / helper 第 1 步原路径）。
- ⚠️ 自审存疑：R-02 候选 A（daemon 独立 runtime_id 注册）可行性需 plan spike 确认；若不可行 fallback 候选 B（按 lease 隔离 policy），design 已留双路径。
- ⚠️ 自审存疑：`prepare_interactive_dispatch` 的 `_get_online_runtime`（placement.py:408）是 user 级查询，借用接入方式（改造 vs 前置解析）plan 阶段定夺，已记 R-07。
