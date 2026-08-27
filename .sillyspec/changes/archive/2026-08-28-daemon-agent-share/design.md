---
author: qinyi
created_at: 2026-08-28 00:25:14
scale: large
---

# 设计文档（Design）— 守护进程共享与平台共享智能体

> 原型：`prototype-daemon-agent-share.html`（本目录，浏览器直接打开）。
> 决策台账：`decisions.md`（D-001~D-006）。

## 1. 背景

平台当前有两类用户痛点：

1. **工作区业务人员没有自己的守护进程**。2026-07-25 已落地「daemon 借用」机制
   （`WorkspaceMemberRuntime.shared` + `borrow_resolver` 自动回退 + 审计 + 沙箱），
   但它只覆盖 agent-run / quick-chat 的**自动选址回退**路径——交互式会话显式
   钉定 `runtime_id` 的路径是硬 owner-only
   （`backend/app/modules/daemon/session/service.py:932-937` 非 owner 直接 404），
   且守护进程页面（/runtimes）的数据源对非 platform admin 固定 `user_id==actor`
   （`daemon/runtime/service.py` list_machines/list_runtimes），**共享来的 daemon
   在页面上完全不可见**。业务人员「看到 → 点会话 → 用起来」的体验断链。
2. **新用户/无 daemon 用户体验平台成本高**，且页面注入的悬浮小助手只能答
   「页面说明书」（page_docs 静态 md），无法基于真实平台源码回答更具体的功能问题。

用户决策（D-006）：采用**方案 B 统一授权表**，新建 `daemon_runtime_grants`
承载工作区共享与平台共享两种授权，换取未来按人/按团队共享的零扩展成本。

## 2. 设计目标

- FR-01：共享的守护进程在守护进程页面对「同工作区 + `daemon:borrow` 权限」的
  成员可见（「共享给我的」区块，带共享人/来源工作区标识）。
- FR-02：上述成员可钉定共享 daemon 的 runtime 创建交互式会话（写借用审计）；
  悬浮助手/会话门户的机器选择器数据源同步包含共享机器。
- FR-03：共享不改变配置权——别名/可写目录/升级/禁用/移除等修改类端点保持
  owner-only（现状 `_get_owned_runtime`/`_get_owned_instance` 不动，前端共享卡片
  不渲染修改入口）。
- FR-04：平台管理员可配置「平台共享智能体」= 智能体档案 + 自己名下在线 runtime
  + 平台源码工作区 + **共享输出目录 writable_dir**，共享后**全体用户**可用其
  开会话；此类会话服务端强制：钉定 runtime + `cwd=源码工作区 root_path` +
  写操作限制在 writable_dir 内（读源码不受限，可产出文档/原型图等——
  D-002@v2 用户实答）。
- FR-05：共享机器与共享智能体进入会话创建的机器/档案选择器，由**用户显式
  选择**使用（D-004@v2 用户实答：不做悬浮助手自动回退）；选中共享智能体的
  会话头显示「平台共享」徽标。

## 3. 非目标（Non-Goals）

- 不做按个人/按团队的共享（`grantee_type` 仅 `workspace`/`platform`，`user` 预留枚举位）。
- sillyhub-daemon 子项目**仅一处增量**（D-011 收窄）：session-manager.ts 写守卫
  增加 session 级 overlay 交集收紧（spike-02 实证 B 后的必要修复）；其余零改动
  （`allowed_roots` 沙箱与 `tool_config.allowedTools` 白名单链路复用既有）。
- 不做共享配额/限流/用量统计报表（审计表延续记录，报表另议）。
- 不做 `WorkspaceMemberRuntime.shared` 列的物理删除（保留为开关状态缓存，物理
  清理留给后续变更）。
- 不做共享 daemon 的离线告警/自动切换（active 列表带在线状态，前端禁用会话按钮即可）。

## 4. 拆分判断

单变更不拆分（D-005）：三块能力强耦合——FR-01~03（grants 授权 + 会话钉定 +
页面可见）是 FR-04（平台共享复用同一授权表与钉定机制）的基础，FR-05 消费
FR-04 的产物。Wave 顺序交付：数据层 → 后端鉴权 → 平台共享 API → 前端。
非批量模式（无「模板×数据」重复实例）。

## 5. 总体方案

### Phase 1 · 数据层：`daemon_runtime_grants` 统一授权表

新表（模型放 `backend/app/modules/daemon/grants/model.py`，daemon 模块拥有
DaemonInstance/DaemonRuntime 实体，授权属 daemon 域）：

- 授权对象 = **机器级** `daemon_instance_id`（对齐现有 shared 绑定语义：共享的是
  「我的守护进程」整机；使用时按 provider 解析到具体 `DaemonRuntime`）。
- platform 类型行额外携带绑定列（`agent_profile_id` / `source_workspace_id` /
  `pinned_runtime_id`），service 层强制三列非空 + `read_only=True`。
- `enabled` 软开关（撤销不删行，对齐现有 owner 撤销置 `shared=False` 语义）。
- 唯一约束 `(daemon_instance_id, grantee_type, grantee_id, granted_by_user_id)`
  ——同工作区允许多个 lender 各自共享（granted_by 区分）。

存量迁移（Alembic，项目未上线直接迁移）：`WorkspaceMemberRuntime.shared=true`
→ 逐行生成 workspace 级 grant（grantee_id=workspace_id、granted_by=binding.user_id、
daemon_instance_id=binding.daemon_id）；**跳过 `daemon_id IS NULL` 的行**（现存此类
binding，原借用 SQL 本就过滤它们——Grill B-03）并写迁移日志。迁移后**授权唯一
判定源 = grants**；`shared` 列保留由开关端点双写（同事务），不再参与任何鉴权查询。

唯一约束采用 `NULLS NOT DISTINCT`（PG16 支持，项目 PG 版本满足）：platform 行
`grantee_id=NULL` 在 PG 默认 `NULLS DISTINCT` 语义下 NULL≠NULL 会使唯一约束失效、
允许重复建共享智能体行（Grill B-02 实证缺陷）。

### Phase 2 · 后端鉴权切换（三处统一切 grants）

1. **会话钉定校验**（`daemon/session/service.py:932-937`）：owner 短路 →
   `grants.queries.authorize_pinned_runtime(actor, runtime_id, workspace_id)`：
   platform grant 的 runtime 不经档案直接钉定 → 404（D-012）；共享路径唯一
   入口=档案检测（Phase 3）。workspace grant（actor 是 grantee 工作区成员 +
   持 `daemon:borrow` 权限 + grant.enabled + daemon 在线）→ 放行并按借用
   会话处理（审计 + 沙箱 marker，语义对齐批任务借用）。
   placement 侧二次复查 `agent/placement.py` `_query_pinned_online_runtime`
   同步增加授权分支（复用 `pinned_skip_owner_check` 旗标先例）。
2. **页面可见**：`daemon/runtime/service.py` 的 machines/runtimes-page 列表装配
   附加 `shared_to_me` 数据（grants join 我的 `user_workspace_roles` 成员资格；
   带 lender 显示名 / 来源工作区 / 在线状态）。修改类端点零变化。
3. **借用回退**：`agent/borrow_resolver.py` 数据源从
   `resolve_shared_daemon_for_borrow`（`workspace/member_runtimes/queries.py:171`）
   切到 grants 版查询，SQL 语义逐条等价（enabled + 在线 + granted_by != actor +
   同工作区成员）——agent-run 自动借用零行为变化，借用测试全量回归兜底。

### Phase 3 · 平台共享智能体（platform admin）

- 管理端点（`require_platform_admin`）：`GET/POST/PATCH/DELETE
  /api/daemon/shared-agents`。创建校验：runtime 属**管理员自己名下且在线**
  （D-003）；档案存在且 `visibility=platform`（私有/workspace 档案 → 服务端自动
  升级为 platform 并在响应中提示）；源码工作区存在；`writable_dir` 必填且
  **⊆ 管理员 runtime 的 allowed_roots**（service 层校验，防指定任意路径）。
- 公共端点：`GET /api/daemon/shared-agents/active`（任意登录用户，仅生效摘要：
  id/档案 id+名称/provider/pinned runtime 在线状态），供选择器与守
  护进程页管理卡展示。
- **会话强制**：`create_session` 在 **runtime_id/provider 二选一校验之前**先检测
  `agent_profile_id` 是否为生效 platform grant 的绑定档案（Grill B-01：若检测
  放在原二选一校验 `session/service.py:950-954` 之后，「只传档案」形态将被拒）
  → 是则无视请求中的 runtime_id/workspace 语义，强制 `pinned_runtime_id`
  （`pinned_skip_owner_check`）+ `cwd = source_workspace.root_path` + 写约束
  `allowed_roots_overlay = [writable_dir]` 下推（复用 AgentProfile 既有
  「只能收紧：∩ daemon.allowed_roots 后下推」机制，daemon 沙箱强制；读源码
  不受限——D-002@v2）+ `tool_config.allowed_tools` 枚举不含 Bash/NotebookEdit
  （mode=acceptEdits，保留 Edit/Write/mcp——Bash 正则提取可逃逸故整体不给，
  D-009；作用域风险 R-09/D-010 需 task-05 实证）。防伪造：约束由服务端强制，请求参数不可放宽。
  platform 会话**不写** `daemon_borrow_audit`（它不是工作区借用而是平台授权，
  且该表 `workspace_id/agent_run_id` NOT NULL 与无 workspace 的交互式会话不
  兼容；用量计量走 AgentSession 现有口径——Grill B-04）。

### Phase 4 · 前端

- `/runtimes` 页（`frontend/src/app/(dashboard)/runtimes/page.tsx`）：统计行加
  「共享给我」计数；新增「共享给我的」区块（新组件 `shared-machines-section.tsx`，
  虚线卡：共享人/来源工作区/徽标，操作仅「会话」；离线禁用）；新增
  「平台共享智能体」管理卡（新组件 `platform-shared-agents-card.tsx`，仅
  platform admin 渲染：创建表单（档案/自己在线 runtime/源码工作区/
  writable_dir）+ 生效列表 + 停用）。
- 会话创建选择器（会话门户/悬浮抽屉/`/runtimes` 弹窗共用数据源）：机器候选
  = 自有 + 共享给我的（共享徽标，D-004@v2 用户显式选择）；档案选择器自然
  呈现共享智能体（platform visibility 既有行为，补「共享」标识展示）；
  悬浮助手回退链逻辑**不变**（不做自动回退）。
- 会话头（`session-panel.tsx`）：选中共享智能体的会话显示「平台共享」徽标
  （生成物落在 writable_dir）。
- 现有共享开关 UI（`shared-daemon-toggle.tsx` / `shared-daemon-manager.tsx`）
  **零交互变化**（端点与响应结构不变，仅后端内部实现切 grants；`shared-daemons`
  响应新增 `grant_id` 字段走 gen:types）。

## 6. 文件变更清单

### backend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/grants/__init__.py | 模块包 |
| 新增 | backend/app/modules/daemon/grants/model.py | `DaemonRuntimeGrant` 表模型（§8） |
| 新增 | backend/app/modules/daemon/grants/schema.py | `SharedAgentCreateRequest`/`SharedAgentView`/`SharedAgentActiveView`/`SharedMachineView` DTO |
| 新增 | backend/app/modules/daemon/grants/queries.py | 授权判定 SQL：`authorize_pinned_runtime` / `list_machines_shared_to_me` / `resolve_granted_daemon_for_borrow` |
| 新增 | backend/app/modules/daemon/grants/service.py | 共享智能体 CRUD + 校验（runtime 归属 admin/在线、档案 visibility 升级、writable_dir ⊆ allowed_roots） |
| 新增 | backend/app/modules/daemon/grants/router.py | shared-agents 管理端点（require_platform_admin）+ active 公共端点 |
| 新增 | backend/app/modules/daemon/grants/tests/ | grants 单测（鉴权矩阵/CRUD/迁移等价性） |
| 新增 | backend/migrations/versions/<rev>_create_daemon_runtime_grants.py | 建表 + `daemon_borrow_audit` 加 `grant_id` 列 + 存量 shared=true 迁移为 grants |
| 修改 | backend/migrations/env.py | 登记 grants 模型 import（alembic autogenerate 扫描，task-01 审查跟进补列） |
| 修改 | backend/app/modules/daemon/session/service.py | :932-937 owner 校验替换为 `authorize_pinned_runtime`；platform 档案检测→强制 pinned/cwd/allowed_roots_overlay=[writable_dir]；借用会话写审计 |
| 修改 | backend/app/modules/agent/placement.py | `_query_pinned_online_runtime` 授权分支；借用审计 INSERT（:148-182）补 grant_id |
| 修改 | backend/app/modules/agent/execution.py | `platform_shared_tool_config`：platform 共享会话 tool_config 白名单组装（验收审查文档漂移补登） |
| 修改 | backend/app/modules/agent/borrow_resolver.py | 数据源切 grants.queries（语义等价改写） |
| 修改 | backend/app/modules/agent/model.py | `DaemonBorrowAudit` 加 `grant_id`（nullable，无 FK 硬约束——审计行允许 grant 先删） |
| 修改 | backend/app/modules/workspace/member_runtimes/router.py | PUT `/my-binding/shared` 开关端点内部写穿 grants（同事务双写 shared 列）；`GET /shared-daemons` 数据源切 grants |
| 修改 | backend/app/modules/workspace/member_runtimes/service.py | 开关/撤销/列表实现切 grants 调用 |
| 修改 | backend/app/modules/workspace/member_runtimes/queries.py | `resolve_shared_daemon_for_borrow` 改薄壳委托 grants.queries（保留签名防破坏调用方） |
| 修改 | backend/app/modules/daemon/runtime/service.py | machines / runtimes-page 装配附加 `shared_to_me`（调 grants.queries.list_machines_shared_to_me） |
| 修改 | backend/app/modules/daemon/schema.py | machines/runtimes-page 响应模型（DaemonMachineListResponse / DaemonRuntimeListResponse）新增 `shared_to_me` 字段（计划审查补列） |
| 修改 | backend/app/modules/daemon/router.py | 挂 grants router；machines/page 端点响应装配 shared_to_me 块 |

**字段数据流标注**（新增对外字段）：

**`shared_to_me`（machines/runtimes-page 响应）**：producer=`grants.queries.list_machines_shared_to_me`（SQLModel 对象）→ `daemon/schema.py` 响应模型序列化 → `backend/openapi.json` → `pnpm gen:types` → consumer=`frontend/src/lib/use-daemon-machines.ts`（useDaemonMachines hook）→ `/runtimes` 页 + 会话门户（session-config-bar）/悬浮抽屉机器选择器渲染（共享徽标，D-004@v2 用户显式选择）。
**`active shared agents`**：producer=`grants.router` GET `/daemon/shared-agents/active` → api-types → consumer=`platform-shared-agents-card.tsx` 管理卡 + 档案选择器共享标识。
**`grant_id`（borrow 审计）**：producer=placement/session 借用路径 → `daemon_borrow_audit` 列（迁移）→ consumer=审计查询接口与 `shared-daemons` 管理列表（撤销追溯）。
**`writable_dir` 写约束（platform 共享会话）**：producer=`create_session` platform 档案分支（覆写 allowed_roots_overlay=[writable_dir]）→ lease metadata 既有 allowed_roots 下推链路（「只能收紧：∩ daemon.allowed_roots」）→ daemon 沙箱强制写路径（consumer，零改动）；读源码不受限。

### frontend

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/(dashboard)/runtimes/page.tsx | 统计行「共享给我」计数 + 渲染 SharedMachinesSection + PlatformSharedAgentsCard（admin） |
| 新增 | frontend/src/components/daemon/shared-machines-section.tsx | 「共享给我的」只读机器区块（仅「会话」操作） |
| 新增 | frontend/src/components/daemon/platform-shared-agents-card.tsx | admin 管理卡（创建表单/生效列表/停用） |
| 新增 | frontend/src/components/daemon/__tests__/shared-machines-section.test.tsx | 渲染与按钮隐藏断言 |
| 新增 | frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx | 表单校验/停用交互断言 |
| 修改 | frontend/src/components/floating/floating-session-host.tsx | 机器选择候选含共享机器（数据源 shared_to_me）+ 共享徽标渲染；**回退链逻辑不变**（D-004@v2 不做自动回退） |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 门户机器选择器渲染共享机器徽标（消费 useDaemonMachines 的 shared_to_me，计划审查补列） |
| 修改 | frontend/src/lib/use-daemon-machines.ts | useDaemonMachines hook 类型随 api-types 更新透传 shared_to_me（计划审查补列；原数据流标注误写 daemon.ts，此为实际 hook 所在） |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 「平台共享」会话徽标（会话元信息区）+ 档案选择器共享智能体标识 |
| 修改 | frontend/src/lib/daemon.ts | sharedAgents CRUD/active API 封装 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（随 backend schema 变更，见 CLAUDE.md 规则 21） |

### sillyhub-daemon

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | _judgeWriteViaPolicyEngine 增加 session 级 overlay 交集收紧（D-011，spike-02 B 修复；无字段会话零变化） |
| 新增 | sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts | overlay 生效/交集/无字段零变化单测 |

## 7. 接口定义

```python
# daemon/grants/queries.py
async def authorize_pinned_runtime(
    session: AsyncSession, *, actor_user_id: uuid.UUID,
    runtime_id: uuid.UUID, workspace_id: uuid.UUID | None,
) -> GrantAuthorization | None
# GrantAuthorization: kind="platform_grant"|"workspace_grant",
#   （owner 短路归调用方；D-012@v1 后 authorize 的 platform 分支命中即 None，
#   实际仅产生 workspace_grant，"platform_grant" 枚举保留为契约位）
#   grant_id, lender_user_id, platform_binding(PlatformBinding|None)
#   PlatformBinding: agent_profile_id, source_workspace_id, writable_dir
# 返回 None = 未授权（调用方维持现有 404 语义）

async def list_machines_shared_to_me(
    session: AsyncSession, *, actor_user_id: uuid.UUID,
) -> list[SharedMachineRow]  # 机器信息+lender 显示名+来源工作区+在线状态

async def resolve_granted_daemon_for_borrow(
    session: AsyncSession, *, actor_user_id: uuid.UUID,
    workspace_id: uuid.UUID, provider: str | None,
) -> tuple[DaemonRuntime, uuid.UUID lender_user_id, uuid.UUID grant_id] | None
```

```python
# daemon/grants/router.py（挂 /api/daemon 前缀）
POST   /api/daemon/shared-agents          # platform admin；body: agent_profile_id, pinned_runtime_id, source_workspace_id, writable_dir（⊆ 管理员 runtime allowed_roots）
PATCH  /api/daemon/shared-agents/{id}     # platform admin；{enabled: bool}
DELETE /api/daemon/shared-agents/{id}     # platform admin
GET    /api/daemon/shared-agents          # platform admin；全部（含停用）
GET    /api/daemon/shared-agents/active   # 任意登录用户；生效摘要列表
```

`create_session` 签名不变（`SessionCreateRequest` 无新增字段）：platform 档案
检测在 service 层**入口前置**（runtime_id/provider 二选一校验之前）完成，请求
参数不可放宽服务端强制项（Grill B-01）。

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| grant create（workspace 开关 on / admin 建共享） | lender 开关端点 / platform admin | grants 表 | daemon_instance_id, grantee_type, grantee_id?, granted_by_user_id,（platform: agent_profile_id, source_workspace_id, pinned_runtime_id, writable_dir） | 无行 → enabled 行 |
| grant disable（开关 off / 撤销 / admin 停用） | lender / owner / admin | grants 表 | grant_id, enabled=false | enabled true→false（行保留） |
| create session（workspace 共享钉定） | 前端会话入口 | backend daemon/session | runtime_id, workspace_id?, prompt | authorize_pinned_runtime 放行 → AgentSession 创建 + interactive lease pending + 借用审计行 |
| create session（platform 共享智能体） | 前端（机器/档案选择器显式选择，D-004@v2） | backend daemon/session | agent_profile_id=共享档案, prompt | 服务端强制 pinned_runtime/cwd/allowed_roots_overlay=[writable_dir] 下推 → AgentSession 创建 |
| claim lease | daemon | backend | leaseId, claimToken, runtime_id | pending → running（现状不变；interactive lease metadata 新增 allowed_roots 下推透传） |
| borrow audit append | backend placement/session | daemon_borrow_audit 表 | grant_id, lender_user_id, borrower_user_id, session_id 或 run_id | 新审计行（新增 grant_id 列） |
| session end | daemon / 用户 | backend | sessionId, reason | active → ended（现状不变） |

事件 → 任务映射：grant create/disable → grants service+router 任务与单测；
create session 两分支 → session/service 改造任务 + 鉴权矩阵单测；claim lease
tool_config 透传 → placement/mcp_tools 任务；borrow audit → placement/session
审计任务（详见 tasks.md）。

## 8. 数据模型

```python
class DaemonRuntimeGrant(BaseModel, table=True):
    __tablename__ = "daemon_runtime_grants"
    id: uuid.UUID PK
    daemon_instance_id: uuid.UUID  # FK daemon_instances.id, index
    grantee_type: Literal["workspace", "platform"]  # "user" 预留
    grantee_id: uuid.UUID | None   # workspace_id；platform 为 NULL
    granted_by_user_id: uuid.UUID  # FK users.id（lender / 管理员）
    # —— platform 绑定列（grantee_type=platform 时 service 层强制非空）——
    agent_profile_id: uuid.UUID | None
    source_workspace_id: uuid.UUID | None
    pinned_runtime_id: uuid.UUID | None
    writable_dir: str | None      # platform 行必填；共享输出目录（写约束锚点），
                                  # service 校验 ⊆ 管理员 runtime 的 allowed_roots
    enabled: bool = True
    created_at / updated_at
    # 唯一约束：(daemon_instance_id, grantee_type, grantee_id, granted_by_user_id)
    # 索引：(grantee_type, grantee_id) 授权查询；(granted_by_user_id) lender 视图
```

`daemon_borrow_audit` 加列 `grant_id: uuid.UUID | None`（nullable，无 FK——
grant 物理删除后审计行仍可读）。

## 9. 兼容策略

- **零配置零变化**：grants 空表时 `authorize_pinned_runtime` 仅 owner 短路路径
  命中，行为与现状 `_rt.user_id != user_id` 逐字节等价；未共享/无共享智能体时
  前端不渲染新区块（数据为空）。
- **agent-run 自动借用**：grants 版查询与原 `resolve_shared_daemon_for_borrow`
  SQL 语义等价（enabled↔shared、在线、非本人、同工作区成员），存量迁移后行为
  不变；借用相关测试全量回归兜底。
- **修改类端点/API 形态不变**：别名/可写目录/升级/禁用/删除 owner-only 不动；
  `PUT /my-binding/shared`、`GET /shared-daemons`、owner 撤销端点签名与响应
  结构不变（内部切 grants；响应新增 `grant_id` 为纯增量字段）。
- **shared 列双写**：开关端点同事务写 `shared` 列（UI 缓存）与 grants 行，
  鉴权只读 grants——单侧不一致不影响判定正确性。
- **daemon 协议零变化**：`allowed_roots` 下推/沙箱 marker 链路既有；写约束走
  overlay「只能收紧」语义。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | grants 切换引入借用链路回归（placement/borrow_resolver/session 三处） | P0 | 查询语义等价改写 + 存量迁移 + agent 模块借用测试全量跑（local.yaml modules.agent / daemon 子集） |
| R-02 | 交互式共享会话的 cwd/沙箱策略 | ~~P0~~ 已实证消解 | Grill C-02 实证：interactive 借用路径 placement.py:792-811 已写 borrow-sandbox marker + 审计；daemon.ts:3741-3778/4124-4125 已检测 marker、prepareWorkspace 沙箱、registerBorrowSandbox，失败 fail-open——interactive 与批处理行为一致。降级为 execute 阶段回归确认 |
| R-03 | platform 档案检测位置与 runtime/provider 二选一校验顺序冲突 | P1 | Grill B-01：检测**前置**到二选一校验之前（见 §5 Phase 3）；单测覆盖「只传共享档案（无 runtime_id/provider）」「同时传 runtime_id+共享档案被覆写」两个 case |
| R-08 | ~~Bash 写逃逸需实证~~ **已实证关闭（D-009）**：Write/Edit 走 PolicyEngine fail-closed 强制；Bash 正则提取可逃逸 → 共享会话 allowed_tools 不含 Bash（gate 直接拒绝） | P2（残余） | D-009 落地于 task-05；execute 回归确认 Write/Edit 逃不出 writable_dir |
| R-04 | 管理员 daemon 离线 → 共享智能体全体不可用 | P1 | active 列表带在线状态；前端禁用 + 提示；不做自动切换（Non-Goal） |
| R-05 | 档案 visibility 自动升级的副作用（私有→platform 全员可见） | P1 | 创建端点仅接受 platform 可见档案或显式带 `promote_visibility=true` 参数；响应提示升级结果 |
| R-06 | gen:types 前端类型滞后（CLAUDE.md 规则 21） | P1 | backend schema 改动同变更内跑 `pnpm gen:types` 并提交两文件 |
| R-07 | shared 列双写一致性 | P2 | 同事务写；鉴权单源 grants，单侧漂移不影响判定 |
| R-09 | ~~overlay 作用域未实证~~ **已实证并修复（D-011）**：spike-02 结论 B——claim payload 的 effectiveAllowedRoots 在 policyEngine 装配下不进写守卫（fallback 块不可达）；修复=task-12 daemon 交集收紧增量 + backend 注入；选项 I（降级验收口径）被否（违背 D-002@v2 用户实答语义） | 已关闭 | task-12 单测三态覆盖 + 管理员普通会话零变化断言 |

## 11. 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 沿用现有共享机制补缺口 | accepted（用户重问轮追认） | FR-01/02/03，§5 Phase 2 |
| D-002@v2 源码只读 + writable_dir 指定目录可写 | accepted（用户重问轮实答，supersedes D-002@v1） | FR-04，§5 Phase 3 |
| D-003@v1 共享 daemon 限管理员自己名下 | accepted（用户重问轮追认） | FR-04，§5 Phase 3（创建校验） |
| D-004@v2 用户在会话选择器显式选择共享机器/智能体 | accepted（用户重问轮实答，supersedes D-004@v1） | FR-05，§5 Phase 4 |
| D-005@v1 单变更不拆分 | accepted | §4 |
| D-006@v1 方案 B 统一授权表 | accepted（用户实选） | §5 全部、§8 |
| D-007@v1 platform 档案检测前置 + platform 会话不写借用审计 | accepted（Grill B-01/B-04 修正） | §5 Phase 3、R-03 |
| D-008@v1 grants 唯一约束 NULLS NOT DISTINCT + 迁移跳过 daemon_id NULL 行 | accepted（Grill B-02/B-03 修正） | §5 Phase 1、§8 |
| D-012@v1 platform grant 的 runtime 不经档案直接钉定 → 404 | accepted（验收审查 gap-2 封堵） | FR-04，§5 Phase 2.1/Phase 3、task-03/task-05 |
| D-013@v1 共享机器可见性=成员资格+daemon:borrow 双条件 | accepted（验收审查 gap-1 补过滤） | FR-01，§5 Phase 2.2、task-02/task-13 |

未解决残留：R-09（overlay 收紧的 policy_update 作用域，D-010）在 task-05 实证。
四个原默认决策已全部经用户重问轮实答（D-001/D-003 追认，D-002/D-004 推翻升级 v2）；
D-009/D-010 为 plan 期新增（R-08 实证定案 + 新风险锚点）；D-011 为 spike-02
裁决新增（daemon 写守卫增量）；D-012/D-013 为验收审查收口新增（gap-2 直传
钉定封堵 / gap-1 可见性权限过滤）。

## 12. 自审（Self-Review）

- [x] 章节齐全：背景/目标/非目标/拆分/方案/文件清单（含数据流）/接口/生命周期
  契约表/数据模型/兼容/风险/决策追踪/自审。
- [x] frontmatter：author/created_at/scale=large（多模块 + schema + 权限变更）。
- [x] 生命周期契约表：含 session/lease/daemon/claim 关键词，事件×任务映射已标注。
- [x] 原型已生成（prototype-daemon-agent-share.html，必须生成级：新增页面区块
  + 管理卡 + 助手回退标识）。
- [x] 文件清单路径已逐一核验存在（daemon/session、daemon/runtime、
  workspace/member_runtimes、agent/{placement,borrow_resolver,model}、前端组件）。
- [x] 新增对外字段全部标注 producer→consumer 数据流（shared_to_me/active/
  grant_id/tool_config）。
- [x] 决策 D-001~D-006 全部引用且映射 FR/章节。
- ⚠️ 自审存疑 1（已消解）：R-02 交互式共享会话沙箱策略——Design Grill C-02
  实证 daemon 侧 interactive 与批处理 marker 行为一致（见 §10 R-02 更新）。
- ⚠️ 自审存疑 2：machines 响应以 `shared_to_me` 附加块呈现（vs 独立端点）——
  选附加块因前端单次拉取即可渲染，若 OpenAPI 响应模型嵌套过深再调整为独立
  端点（plan 定稿）。
