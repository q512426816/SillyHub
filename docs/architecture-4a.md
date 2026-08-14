---
author: qinyi
created_at: 2026-08-14T20:42:00+08:00
updated_at: 2026-08-14T20:42:00+08:00
---

# SillyHub（multi-agent-platform）4A 架构总纲

> 把 SillyHub 当作一个企业架构（EA）实例，用 **4A 框架**（业务 BA / 数据 DA / 应用 AA / 技术 TA）自上而下拆解。
> SillyHub 的“业务”不是企业销售/生产，而是 **「企业级托管 AI Agent，按文档驱动流程（SillySpec）开发与编排代码，并对全生命周期做治理」** 这件事——这是整张映射的轴。
>
> **事实源约定**：本文以仓库源码（`backend/app/`、`frontend/src/`、`sillyhub-daemon/`、`deploy/`）为唯一事实源，凡与旧文档/注释冲突处以源码为准。每条论断带 `文件:行号` 依据。已知漂移点见 [§8](#8-已知文档漂移点)。
>
> 与 SillySpec 工具自身的 4A 总纲（`sillyspec/docs/sillyspec/architecture-4a.md`）区分：那份描述的是 *SillySpec CLI 状态机*；本文描述的是 *SillyHub 整个平台*——SillySpec 是本平台集成进来的开发流程引擎，二者是“平台 vs 被平台托管的流程工具”的关系。

## 0. 定位

SillyHub 是一个 **企业级 AI Agent 托管 / 编排 / 管控平台**：企业在平台上建 workspace（项目空间）→ 绑定 daemon（跑在用户本机或服务器的远程运行时）→ 用 **SillySpec** 文档驱动流程管理代码变更（change）的全生命周期 → 在 workspace 内派发 mission 给 AI Agent 执行 → 全程进度同步、审批、审计、凭证治理。它本身就是一个 EA——把“企业用 AI Agent 规范化、可治理地开发与编排代码”这个战略目标，自上而下翻译成 数据 → 应用 → 技术。

平台不是单体服务，而是 **四进程协作的分布式应用**：平台侧（backend FastAPI 编排治理 + frontend Next.js 展示）+ 执行侧（sillyhub-daemon Node，agent 真正执行体）+ LLM 网关（LiteLLM，协议转换）。agent 的真正执行在 daemon，平台侧只编排与治理——这是理解整张架构的关键。

| 4A 层 | 回答 | SillyHub 的一句话映射 |
|---|---|---|
| **BA 业务架构** | 做什么 | 40+ router / 5 大业务域：workspace 托管 + SillySpec 变更流程托管 + Agent 编排（mission）+ 凭证治理 + PPM 项目管理；变更托管 / Agent 编排双主线在 execute 阶段交汇 |
| **DA 数据架构** | 用什么数据 | PostgreSQL 77 表 / 11 域（SQLModel + asyncpg）+ Redis 缓存 + MinIO 对象存储 + spec 文档资产树；platform_sync 同步层缝合 SillySpec CLI 进度 |
| **AA 应用架构** | 怎么做 | 四进程分布式：backend FastAPI（core + 30 模块）/ frontend Next.js（5 层）/ daemon Node（6 层，agent 执行体）/ LiteLLM 网关；Agent 编排引擎 + 两套 MCP |
| **TA 技术架构** | 在什么上做 | Python 3.12 / Node 20 + PG16 / Redis7 / MinIO + Docker Compose 7 服务 + git worktree 隔离 + 跨平台 + 四道门禁 + 安全（加密 / SSRF / RBAC / 审计） |

---

## 1. BA 业务架构（做什么）

> SillyHub 的“业务”是 **「企业级托管 AI Agent 按文档驱动流程（SillySpec）开发/编排代码，并对全生命周期做治理」** 这件事。本节以 `backend/app/` 与 `frontend/src/` 源码为唯一事实源，凡与旧文档冲突处以源码为准（已知缺口见文内标注）。

### 1.1 业务能力清单

路由注册的单一真相源是 `backend/app/main.py` 的 `create_app()`（`main.py:175`），共挂载 40+ 个 router。下面分三层梳理：路由注册总览 → 业务能力域 → 前端功能区。

#### 1.1.1 路由注册总览（`main.py:516-608`）

按落地前缀分组，列关键模块（`include_router` 行号即注册依据）：

| 前缀 | 代表 router | 注册依据 | 业务域 |
|---|---|---|---|
| `/api`（无 router 级 prefix） | `auth_router` / `admin_router` / `settings_router` / `incident_router` / `knowledge_router` / `release_router` / `skills_router` / `tool_gateway_router` / `policy_crud_router` / `runtime_router` / `git_gateway_router` / `change_writer_router` / `workflow_router` / `scan_docs_router` / `task_router` / `git_identity_router` / `llm_provider_router` / `spec_workspace_router` | `main.py:545-590` | 平台级 + workspace 内嵌（路径内含 `{workspace_id}`） |
| `/api`（router 自带 workspace prefix） | `workspace_router` / `members_router` / `member_runtimes_router` / `ppm_project_link_router` / `change_router` / `agent_router` / `agent_profile_router` / `daemon_router` / `mcp_gateway_router` / `mcp_sse_router` / `platform_sync_workspace_router` | `main.py:524-600` | workspace 隔离域 |
| `/api/workspaces/{wid}/...`（lease 维度） | `worktree_router` / `lease_router` | `main.py:569-570` | worktree 租约 |
| `/api/changes/...`（无 workspace prefix） | `platform_sync_router` | `main.py:595` | 进度同步层（token 派生 workspace） |
| `/api/ppm/...` | `ppm_project/plan/task/problem/kanban/workbench_router` | `main.py:579-584` | PPM（平台级，已上线） |
| `/api/file` | `file_router` | `main.py:543` | 平台文件中心 |
| `/api/daemon-chat` | `_register_quick_chat(app)` | `main.py:523` | 免 workspace 快速对话（固定路径，须先于参数化路由注册，`main.py:520-522`） |
| `/mcp` | `mount_mcp(app)` | `main.py:608` | 对外 MCP server（物理隔离 `/api`，`server.py:83-85`） |
| `/daemon/...`（无 `/api`、无认证） | `daemon_dist_router` | `main.py:519` | daemon 分发（install.sh 等，`dist_router.py:83-142`） |

> 注：`worktree` 的 `lease_router` 与 `worktree_router` 同在 `worktree/router.py`（前者 lease 维度无 workspace prefix，后者 workspace 维度），经 `worktree/__init__.py:2` 导出。`platform_sync_router` 故意不带 router 级 prefix 以规避 `GET /changes` 尾斜杠 307 重定向（`platform_sync/router.py:8-9`）。

#### 1.1.2 业务能力域清单

按业务相关性归为 5 大域。每条能力标注对外入口与依据。

**域 A · 项目空间与运行时**

| 能力 | 入口 | 依据 | 说明 |
|---|---|---|---|
| 工作区 CRUD/激活/重扫/软删 | `POST /workspaces` 等 | `workspace/router.py:139,158,330,352,366` | 创建者自动获 `workspace_owner`（`workspace/service.py:807`） |
| 工作区成员管理 | `/workspaces/{wid}/members/*` | `members_router.py:179-338` | 角色白名单 4 种（`members_service.py:46-48`） |
| 成员运行时绑定（per-member） | `/workspaces/{wid}/my-binding` 等 | `member_runtimes/router.py:102-191` | 复合主键 `(workspace_id,user_id)`（`model.py:40`） |
| daemon 共享与借用 | `PUT /my-binding/shared` 等 | `member_runtimes/router.py:161-191` | 业务人员借用他人共享 daemon |
| daemon 注册/心跳/在线 | `POST /daemon/register` / `heartbeat` / `WS /daemon/ws` | `daemon/router.py:300,343,2196` | stale 判定 45s（`runtime/service.py:25,826`） |
| daemon lease 生命周期 | `/daemon/leases/{id}/claim\|start\|heartbeat\|complete` | `daemon/router.py:992-1096` | 状态机 `pending→claimed→completed/expired/cancelled`（`daemon/model.py:351`） |
| spec 工作区同步（全量/增量） | `/workspaces/{wid}/spec-workspace/*` | `spec_workspace/router.py:107-350` | 增量带乐观锁（`router.py:245`） |
| 运行时只读视图 | `/workspaces/{wid}/runtime/*` | `runtime/router.py:24-72` | 读 `.sillyspec/.runtime/` |
| 扫描文档 | `/workspaces/{wid}/scan-docs/*` | `scan_docs/router.py:31-114` | 含 reparse |

**域 B · 变更托管与代码协作（SillySpec 集成核心）**

| 能力 | 入口 | 依据 | 说明 |
|---|---|---|---|
| 变更 CRUD/列表/详情/reparse | `/workspaces/{wid}/changes/*` | `change/router.py:119-273` | 列表支持 `pending_review_only` 过滤 |
| 变更文件树/读写 | `/changes/{cid}/files/*` | `change/router.py:279-430` | 写文件建 pending `DaemonChangeWrite`（`service.py:338-391`） |
| 阶段流转与派发 | `POST /changes/{cid}/transition` / `advance-stage` / `dispatch` | `change/router.py:525,554,908` | 共用 `transition_with_dispatch`（`service.py:749-842`） |
| 4 审核面板 | `proposal-review` / `plan-review` / `human-test` / `archive-confirm` | `change/router.py:718-838` | approve→推进、revise→rerun |
| 审批/驳回/反馈/归档门 | `/approval` / `/approve` / `/reject` / `/feedback` / `/archive-gate` | `change/router.py:436-712` | 归档门 6 项 check（`service.py:928-1025`） |
| 变更创建（server-local/lease） | `POST /changes/create` | `change_writer/router.py:34-95` | 创建后 auto-dispatch brainstorm（未扫描 workspace 拒建，`service.py:82-89`） |
| 变更创建（daemon 代写） | `POST /changes/proxy-create` | `change_writer/router.py:98-132` | 占坑→下发 DaemonChangeWrite→轮询回执（`proxy.py:204-379`） |
| 文档生成/批量模板/触发执行 | `/changes/{cid}/documents/*` / `/execute` | `change_writer/router.py:135-250` | — |
| 进度同步上行 | `POST /changes/{name}/progress` 等 3 端点 | `platform_sync/router.py:45-117` | base_ts 乐观锁（`service.py:63-91`） |
| workspace-scoped 同步 token 签发 | `/workspaces/{wid}/platform-sync-tokens` | `workspace_router.py:86-164` | 明文 `shpsync_` 仅返一次 |
| worktree 租约（acquire/release/extend） | `/workspaces/{wid}/worktrees/*` / `/worktrees/{lease}/*` | `worktree/router.py:31-111` | 状态 `locked→released` |
| 受控 git 操作 | `POST /worktrees/{lease}/git` | `git_gateway/router.py:28-40` | 白名单 + 黑名单 + 脱敏（`service.py:34-57,106-113`） |
| 任务/工作流/审计 | `/workspaces/{wid}/tasks/*` / `/audit` | `task_router` / `workflow/router.py:29-82` | task FSM（`workflow/service.py:39`） |

**域 C · Agent 编排与执行**

| 能力 | 入口 | 依据 | 说明 |
|---|---|---|---|
| AgentRun 创建/查询/kill/输入/日志/SSE | `/workspaces/{wid}/agent/runs/*` | `agent/router.py:341-703` | SSE 短 session 连接池安全（`router.py:521`） |
| daemon 执行上下文拉取 | `GET /agent-runs/{run_id}/execution-context` | `agent/router.py:149-338` | bundle + claudeMd + provider 注入 |
| Mission 建立与编排（3 模式） | `POST /workspaces/{wid}/missions` | `agent/router.py:842-948` | single/team/external 三路分流（`router.py:873`） |
| Mission 查询/取消 | `/missions/{mid}` / `/cancel` | `agent/router.py:951-984` | status 派生不持久化（`mission.py:29`） |
| 主 agent 反向控制（team） | `/missions/{mid}/dispatch_worker` 等 5 端点 | `agent/mcp_tools.py:354-680` | 主 agent 经 MCP tool 动态补派 |
| AgentProfile 配置层 | `/workspaces/{wid}/agent-profiles` / `/agent-profiles` | `profile/router.py:181-407` | 三级 visibility（`profile/model.py:37-46`） |
| 快速对话（免 workspace） | `/api/daemon-chat/*` | `main.py:229-514` | `spec_strategy='quick-chat'` 隔离 |
| 对外 MCP server（12 tool） | `/mcp` | `server.py:62-85`、`tools.py:335-1216` | 三 scope read/dispatch/converge（`auth.py:41-44`） |
| MCP Token 签发/吊销 | `/workspaces/{wid}/mcp-tokens` | `mcp_gateway/router.py:114-191` | sha256 落库（`service.py:1-20`） |
| Mission events SSE | `/workspaces/{wid}/missions/{mid}/events` | `mcp_gateway/sse.py:149-180` | 2s 短轮询 |
| 工具网关执行/策略 | `/worktrees/{lease}/tools` / `/workspaces/{wid}/tool-policies` | `tool_gateway/router.py:24-36` / `policy_router.py:47-165` | **approvals 4 端点当前为 V1 stub 返空**（`router.py:42-89`） |
| 自定义技能 | `/custom-skills` | `skills/router.py:69-135` | per-user（`created_by==user_id`） |

**域 D · 凭证与密钥治理**

| 能力 | 入口 | 依据 | 说明 |
|---|---|---|---|
| Git 身份凭证 | `/api/git/identities/*` | `git_identity/router.py:31-88` | 用户级，xchacha20 加密（`service.py:81`） |
| LLM 供应商凭证 | `/api/llm-providers/*` | `llm_provider/router.py:41-168` | 用户级，掩码回传（`service.py:491-504`），双格式 anthropic/openai |
| API Key（daemon 接入） | `/settings/api-keys`（前端） | `settings/api-keys/page.tsx:89` | daemon 认证 token |

**域 E · 治理与合规**

| 能力 | 入口 | 依据 | 说明 |
|---|---|---|---|
| 平台 admin（org/role/user） | `/api/admin/*` | `admin/router.py:55-640` | 含 session 撤销/重置密码/禁登录（`router.py:555-640`） |
| 平台设置 + MCP 白名单 | `/api/settings/*` | `settings/router.py:69-236` | MCP env 脱敏（`router.py:125-154`） |
| 事故管理（FSM） | `/workspaces/{wid}/incidents/*` | `incident/router.py:29-116` | 见 §1.3 |
| 发布管理（审批门） | `/workspaces/{wid}/releases/*` | `release/router.py:28-128` | 多人审批 + 部署窗口（`service.py:36-42`） |
| 知识库/快速日志（只读） | `/workspaces/{wid}/knowledge/*` | `knowledge/router.py:23-62` | **纯文件系统无 DB**（`service.py:1,16`） |
| 平台文件中心 | `/api/file/*` | `file/router.py:47-140` | S3 兼容（`storage/factory.py:19-29`） |
| 审计日志查询 | `/workspaces/{wid}/audit` / `/admin/users/{id}/audit` | `workflow/router.py:44-61` / `admin/router.py:569-580` | 见 §1.3 |

**PPM 项目管理（独立子产品，已上线）**

| 子域 | 端点族 | 依据 | 说明 |
|---|---|---|---|
| 项目/客户/成员/干系人主数据 | `/api/ppm/project-maintenance` 等 | `ppm/project/router.py:88-625` | 含 Excel 导出 |
| 项目↔工作区关联 | `/api/ppm/projects/{id}/workspaces` | `ppm/project/router.py:654-718` | 双边对称 |
| 项目计划/里程碑/模板 | `/api/ppm/project-plan` / `plan-node` 等 | `ppm/plan/router.py:159-850` | 含版本链审批流 |
| 任务计划/执行/工时 | `/api/ppm/task-plan` / `task-execute` / `work-hour` | `ppm/task/router.py:88-656` | 双维工时统计 |
| 问题清单 + 变更审批 | `/api/ppm/problem-list` / `problem-change` | `ppm/problem/router.py:102-659` | problem-change 标记 deprecated（`router.py:11-12`） |
| 看板 | `/api/ppm/kanban/*` | `ppm/kanban/router.py:56-271` | 工时热力网格 |
| 个人工作台 | `/api/ppm/workbench/*` | `ppm/workbench/router.py:38-90` | 支持经理切换查看 |

> PPM 全域平台级（`main.py:579-584`），鉴权仅 `get_current_principal` 认证不授权，数据可见性由 `data_scope` 按超管/项目经理收敛（`ppm/data_scope.py`、`project/router.py:143`）。

#### 1.1.3 前端业务功能区地图（`frontend/src/app/(dashboard)/`，52 个 page.tsx）

| 功能区 | 代表路由 | 页数 | 说明 |
|---|---|---|---|
| 工作区选择 / 个人中心 | `/workspaces`、`/account` | 2 | 全局入口 |
| Workspace 详情 | `/workspaces/[id]/*` | 19 | 概览/组件/拓扑/成员/文件/扫描文档/运行时/审计/Agent 记录/档案/Mission/Skill/MCP/Token/知识库/审批/发布/事件 |
| 变更中心 | `/workspaces/[id]/changes/*`、`/create-change` | 5 | 列表/新建/详情(阶段流转)/任务看板/任务详情 |
| PPM 项目管理 | `/ppm/*` | 16 | 与主菜单隔离（`ppm/page.tsx:4-8` 重定向 `/ppm/workbench`） |
| 凭证与设置 | `/settings/*` | 6 | 中心/API 密钥/供应商/Git 身份/技能/MCP |
| 守护进程运行时 | `/runtimes`、`/runtimes/[id]/audit` | 2 | 主机视图 + 策略审计 |
| 平台后台 admin | `/admin/users\|roles\|organizations` | 3 | 用户/角色/组织 |
| Agent 编排（跨工作区） | `/agent-profiles` | 1 | 全平台可见档案聚合 |

### 1.2 核心业务流程（端到端）

平台有两条主线业务流程：**变更托管主线**（SillySpec 流程的平台化托管）与 **Agent 编排主线**（workspace 内 mission 派发执行）。两者在 execute 阶段交汇。

#### 1.2.1 变更托管主线（workspace 建档 → archive）

```
① workspace 建档         ② daemon 绑定           ③ 创建 change
   POST /workspaces  ──►  PUT /my-binding    ──►  POST /changes/create
   workspace/router.py:139  member_runtimes/      change_writer/router.py:34
   创建者=workspace_owner    router.py:115         (未扫描 ws 拒建 service.py:82-89)
                            (per-(ws,user) 绑定)   创建后 auto-dispatch brainstorm
        │
        ▼
④ SillySpec 阶段流转（brainstorm→plan→execute→verify→archive）
   POST /changes/{cid}/transition  ──►  transition_with_dispatch
   change/router.py:525                 change/service.py:749-842
   每步: dispatch_next_step 派 AgentRun → daemon lease → 本机跑 CLI
        │
        ▼  (CLI 在用户本机执行，进度实时回灌)
⑤ 进度回灌（两条路径并存）
   路径1 (CLI 主动上行):   POST /api/changes/{name}/progress  (shpsync_ token)
                          platform_sync/router.py:45  →  base_ts 乐观锁写 platform_change_progress
   路径2 (平台主动拉取):   sync_stage_status 经 HostFsDelegate 直读 daemon 侧 sillyspec.db
                          dispatch.py:1479,1758-1781  →  写 change.current_stage / change.stages
        │
        ▼
⑥ 4 审核面板（人机协作决策点）
   proposal-review → plan-review → human-test → archive-confirm
   change/router.py:718-838   (approve 推进 / revise 打回 rerun)
        │
        ▼
⑦ 归档门 + 归档
   GET /changes/{cid}/archive-gate  (6 项 check, service.py:928-1025)
   POST /changes/{cid}/archive-confirm  (仅 Hub 侧记录, service.py:1957-2006)
```

**平台如何集成 SillySpec 状态机**——核心在 `change/dispatch.py`：

- **阶段定义**：`STAGE_ORDER = [brainstorm, plan, execute, verify, archive]`（`dispatch.py:38-44`），合法转换图 `TRANSITIONS`（`model.py:103-109`，每边 `["agent"]`），`can_transition` 校验（`model.py:112-114`）。quick 是辅助独立阶段不进主线（`dispatch.py:128-135`）。
- **统一派发入口** `SillySpecStageDispatchService`（`dispatch.py:1172`），`dispatch_next_step`（`dispatch.py:1286-1422`）：检查 stage config → 清孤儿 run → 检查 active run → 构造 bundle → 记 `last_dispatch` → 派发。
- **`current_stage` 的三条写入路径 + 一条只读投影**：
  1. 创建时初值（`change_writer/service.py:174`）
  2. `transition` 推进（`service.py:727`）
  3. CLI 进度回灌写 `change.current_stage`（`dispatch.py:1765`）
  4. **只读投影**：列表/详情显示时 `_project_current_stage`（`service.py:1325-1355`）read-only join `platform_change_progress` 表，用 CLI 上行的 `latest_progress` 覆盖显示值（D-002，不改 changes 表）。即“工具上行权威值”覆盖“平台字段”。
- **源阶段完成度前置校验** `_check_source_stage_completion`（`service.py:1715-1769`）：手动推进前强制用 sillyspec.db 客观进度证明“干完了”，堵住“没干活就推进”。

> 关键设计：平台**不自动推进**状态机——形态 A（change db5d0ed3）砍掉 `auto_dispatch`，改为按需显式触发（`transition` / `advance-stage` / 对外 MCP `advance_change_stage`）。落库 `current_stage` 与投影值可能短暂不一致（change-stage-control-ownership 记忆）。

#### 1.2.2 Agent 编排主线（mission 派发执行）

```
① 建 mission (3 模式)
   POST /workspaces/{wid}/missions  ──► 按 mode/orchestration_mode 分流 (router.py:873)
   · single : GLM CoordinatorPlanner 预拆 → 扁平 worker run (mission.py:70-133)
   · team   : 主 agent(真 agent) + 动态 dispatch worker (orchestrator.py:130 team_mission_entry)
   · external(team 子模式): 跳过 spawn, caller 自调度 (orchestrator.py:186)
        │
        ▼
② 派发到 daemon (placement)
   RunPlacementService.dispatch_to_daemon (placement.py:313-550)
   · 解析 runtime (per-member binding, placement.py:1014-1023)
   · 构造 metadata → INSERT daemon_task_leases (pending, placement.py:471)
   · INSERT AgentSession → WS wake-up daemon (placement.py:543)
        │
        ▼
③ daemon 认领执行
   POST /daemon/leases/{id}/claim → start → heartbeat → complete
   daemon/router.py:992-1077  (claim_token 鉴权 lease/service.py:975)
   daemon 拉执行上下文: GET /agent-runs/{run_id}/execution-context (agent/router.py:149)
        │
        ▼
④ 结果回灌 + 收敛
   · lease complete → AgentRun 终态 → converge_mission_for_completed_run (agent/finalizer.py)
   · team 模式: 主 agent 调 /converge 触发冲突状态机 (mcp_tools.py:513-630)
   · Mission status 由子 run 派生: derive_status (mission.py:29-54), 不持久化第二套状态机
        │
        ▼
⑤ 实时观测
   SSE: /workspaces/{wid}/missions/{mid}/events (sse.py:149, 2s 短轮询)
   日志: /agent/runs/{run_id}/stream (agent/router.py:482, Redis pub/sub)
```

**编排治理约束**：`MAX_WORKERS=5`（`delegation.py:30`）；budget 硬截断强收标 degraded（`orchestrator.py:326`）；主 agent 硬约束“禁止越权下场写代码”（`orchestrator.py:102-111`）；`effective_allowed_roots = daemon.allowed_roots ∩ profile.overlay`，agent 只能收紧不能放宽（`profile/service.py:543-568`）。

**spec_strategy 维度隔离**（`AgentRun.spec_strategy`，`model.py:122`）：取值 `quick-chat` / `sillyspec` / `platform-managed` 等，用于区分 run 来源；quick-chat 端点查询强制 `WHERE spec_strategy='quick-chat'` 防越权（`main.py:327-329`）。

### 1.3 校验点与审批

按阻断强度排列（HTTP 4xx/422 = 请求硬阻断；FSM 校验 = 状态转换阻断；advisory = 记录不阻断）。

| 校验/审批门 | 触发点 | 阻断方式 | 依据 |
|---|---|---|---|
| **RBAC 权限门** `require_permission` | 所有 workspace 域端点 | 非成员 403 | `auth_deps.py:86-98`、`rbac.py:107` |
| **平台 admin 短路** | `is_platform_admin` | 优先放行 | `rbac.py:121` |
| **变更阶段转换门** | `transition` 非法跳转 | 422 | `model.py:112-114`、`service.py:674-747` |
| **源阶段完成度门** | 手动推进前 | 阻断（须 sillyspec.db 客观证明） | `service.py:1715-1769` |
| **verify gate 三态门** | `run-verify-gate` | exit 0 推进/1 打回/2 卡住 | `dispatch.py:162-194,1012-1061`；连续 exit 1 达 `_GATE_RETRY_LIMIT=3` 升级 exit 2（`dispatch.py:199`） |
| **归档门** 6 项 check | archive 前 | 缺项阻断 | `service.py:928-1025` |
| **incident FSM** | 状态转换非法 | 422 `InvalidTransition` | `incident/service.py:28-33,109-162`、`ppm/common/fsm.py:58-88` |
| **release 审批门** | deploy production | 审批人数不足/窗口外阻断 | `release/service.py:202-288` |
| **worktree fail-closed** | release 有未 apply 交付 | 拒绝清理 | （见 TA 章） |
| **git_gateway 黑名单** | `--force`/`--hard`/push 保护分支 | 拒绝 | `git_gateway/service.py:51-57,133-145` |

**审批（approvals）—— 双套实现并存**：

- **业务审批**（change 模块，前端/业务用户消费）：`approval_status` 字段（`model.py:178-193`，默认 `not_required`），`approve`/`reject` 端点（`change/router.py:458-502`）。
- **CLI execute 审批门**（platform_sync 模块，SillySpec CLI 消费）：`GET /changes/{name}/approval`（`platform_sync/router.py:120-137`），CLI execute 启动时读 status 决定放行/阻断。**当前后端无审批策略，恒返回 approved 放行**，不查库不 404（避免误判 pending 卡死）。

**权限模型**（`auth/permissions.py:34`）——`Permission` StrEnum 按 7 个 `PermissionGroup`（`:15`）组织：PLATFORM / ADMIN / WORKSPACE / AGENT / CHANGE / AUDIT / PPM。授权双轨：`UserWorkspaceRole`（workspace 级，`(user_id,workspace_id,role_id)`，`auth/model.py:255`）+ `UserRole`（平台级，`admin/model.py:111`）。系统角色：`platform_admin`（绑全权限，`auth/service.py:475`）、`workspace_owner`（创建者自动获，`workspace/service.py:807`）、`developer` / `viewer` / `business_member`（无自有 daemon，靠借用，`permissions.py:86-92`）。workspace 级角色白名单显式排除系统角色（`members_service.py:39-48`）。

**审计（audit）—— 双轨设计，注意缺口**：

- **自动 ORM 事件钩子**（`core/audit_hooks.py:290` `register_audit_hooks`）：设计为对所有 `BaseModel` 子类 insert/update/delete 自动写 `AuditLog`。**但 production `main.py` 的 lifespan/create_app 从未调用它**（全仓仅测试命中 `register_audit_hooks(`），运行态实际休眠。
- **手工 AuditLog 插入**（实际生效）：约 20 处 service 内直接构造 `AuditLog(...)`，覆盖改密码（`auth/service.py:190-201`）、权限变更（`admin/roles_service.py:221`）、禁登录/撤 session（`admin/users_service.py:603,630,669,705`）等。
- **写入目标**：DB 表 `audit_logs`（模型物理在 `workflow/model.py:46-82`），字段 `workspace_id`/`actor_id`/`action`/`resource_type`/`resource_id`/`details_json`。审计上下文经 `get_session` 注入 `session.info["audit_context"]`（`core/db.py:116-151`）。
- **已知缺口**：①登录成功/失败**不入审计表**，仅 `log.info` 结构化日志（`auth/service.py:111,129`）；②`settings`/`PlatformSetting` 变更因自动钩子未挂且未手工补，实际无 AuditLog；③daemon 侧另有独立 `PolicyAuditLog` 表（`daemon/audit/model.py:23`）与主审计分离。

### 1.4 多租户 / 多 workspace 隔离

**隔离单元 = workspace，不是 organization**。

- **organization 不参与业务数据隔离**。`Organization`（`admin/model.py:37`）是自引用层级组织树（`parent_id`，`:57`），仅用于 admin 中心用户分组/筛选（`admin/router.py:172`）。权限解析（`auth/rbac.py`）完全不读 Organization 表，只读 `UserWorkspaceRole` + `UserRole`。
- **workspace 是核心隔离单元**。所有 workspace 域 router 的 prefix 含 `{workspace_id}`；`require_permission`（`auth_deps.py:86`）的闭包经 `Path(...)` 自动注入 `workspace_id`（`:92`）调 `has_permission`（`rbac.py:107`）：①`is_platform_admin` 短路（`:121`）→ ②平台级授权（`:124`）→ ③该 workspace 的 `user_workspace_roles` 授权（`:131`），无匹配 403。列表场景对非 admin 调 `allowed_workspace_ids`（`rbac.py:148`）做 SQL 行级过滤（`workspace/router.py:226,237`）。
- **软删隔离**：部分唯一索引限定 `deleted_at IS NULL`（`workspace/model.py:36-48`），软删行保留原值。

**daemon 绑定是 per-(workspace, member)，非 per-workspace**：

- 绑定表 `WorkspaceMemberRuntime` 复合主键 `(workspace_id, user_id)`（`member_runtimes/model.py:40,48`）——同一用户在不同 workspace 各配自己的 daemon。
- `daemon_instances.user_id`（`daemon/model.py:42`）锁 daemon 归属某用户；跨用户复用 `daemon_local_id` 注册被拒（`runtime/service.py:214` `DaemonInstanceOwnershipMismatch`）。
- 绑定时校验 daemon 归属：`daemon.user_id != user_id` → 403（`member_runtimes/service.py:51-58`）。
- **借用（borrow）机制**：业务人员（无自有 daemon）只能命中 `shared=True` 且归属人≠操作者的行（`member_runtimes/model.py:76-80`）；借用 lease 的 cwd 必须是 `borrow-sandbox:<slug>` marker，避免 daemon 用 lender 代码作 cwd（`placement.py:81-117`）。

**越权防护**：

- daemon WS payload 校验 `runtime_id` 必须属于当前连接的 daemon（`daemon/router.py:2388` `_validate_payload_runtime_belongs`）。
- runtime/instance 级操作经 `_get_owned_runtime`/`_get_owned_instance`，越权返 404（不泄露存在性）。
- `list_my_bindings` SQL 固定 `WHERE user_id = :user_id`（`member_runtimes/service.py:94`）。
- AgentProfile `effective_allowed_roots` 只能收紧不能放宽（`profile/service.py:543-568`）。
- quick-chat 查询强制 `WHERE spec_strategy='quick-chat'` 防越权读其他类型 run（`main.py:327-329`）。

> 多 workspace 并发协作：多个 agent 可同时操作同一仓库代码，平台不锁文件——靠 git worktree（TA 层）+ SillySpec CLI 侧的 `detectConcurrentChanges` warn（见 SillySpec 4A §1.4）做协作纪律，平台侧以 lease 归属 + RBAC 做权限隔离。

---

## 2. DA 数据架构（用什么数据）

> SillyHub 的数据分两条轴：**结构化业务数据**（PostgreSQL，SQLModel/SQLAlchemy ORM 承载，约 77 张表跨 11 个业务域）+ **文档资产**（平台托管 spec 目录树，markdown/yaml 即数据）。前者是平台的「黄金记录」，后者是 SillySpec 流程的「意图与进度载体」，二者由 `platform_sync` 同步层缝合。本节以 `backend/app/` 源码为唯一事实源。

### 2.1 数据模型（实体清单）

全部表继承统一基类 `BaseModel`（`backend/app/models/base.py:13`，包一层 `SQLModel`，共享同一份 `BaseModel.metadata` 供 Alembic autogenerate 扫描）。主键统一 UUID（`Uuid(as_uuid=True)`），时间戳统一 `DateTime(timezone=True)`，外键显式声明 `ondelete` 语义。按业务域分组如下。

#### 2.1.1 工作空间域（协作中枢，workspace 是多数实体的隔离边界）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `workspaces` | 工作空间主表，SillySpec 项目根 | `slug`/`root_path`（软删后部分唯一索引 `ux_workspaces_root_path_active` `workspace/model.py:35-48`）/ `status`(active/archived/deleted) / `default_agent_profile_id`(FK SET NULL) / `tech_stack`(JSON) — `workspace/model.py:31` |
| `workspace_member_runtimes` | 每成员的 daemon 实体 + 本地路径绑定（协作工作区 D-002） | 复合 PK `(workspace_id,user_id)` / `daemon_id`(FK RESTRICT) / `runtime_id`(FK RESTRICT) / `shared`(借用开关) / `init_synced_spec_version` — `workspace/member_runtimes/model.py:24` |
| `task_workspaces` / `agent_run_workspaces` / `ppm_project_workspace` | task / agent_run / ppm_project 与 workspace 的 M:N 关联 | 复合 PK 双向 CASCADE — `workspace/model.py:150,212,188` |

> **软删范式**：`workspaces.deleted_at`（`workspace/model.py:141`）非空即归档；`root_path`/`slug` 的唯一约束用 partial index `WHERE deleted_at IS NULL`（PG/SQLite 双方言），让软删行保留原值、新工作区可复用同名。

#### 2.1.2 身份与授权域（RBAC + 组织树 + 会话）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `users` | 平台账号 | `email`(nullable，支持 username-only) / `username` / `password_hash` / `is_platform_admin` / `login_enabled` / `employee_no` / `status`(active/disabled/deleted) — `auth/model.py:31` |
| `sessions` | refresh-token 会话 | `refresh_token_hash`(bcrypt) / `token_id_hmac`(部分唯一索引 `ux_sessions_token_id_hmac`) / `rotated_at`(grace 判定) — `auth/model.py:96` |
| `roles` / `role_permissions` | 角色 + 权限串（复合 PK `(role_id,permission)`） | `key`(unique) / `is_system` / `is_active` — `auth/model.py:154,187` |
| `user_workspace_roles` | workspace 内角色绑定（复合 PK 三元组，一人可持多角色） | `(user_id,workspace_id,role_id)` CASCADE — `auth/model.py:263` |
| `user_roles` | 平台级角色绑定（workspace 无关） | `(user_id,role_id)` role 侧 RESTRICT — `admin/model.py:121` |
| `organizations` / `user_organizations` | 层级组织树（自引用 `parent_id` RESTRICT）+ 直属成员 | `code`(unique) / `status`(CHECK 约束 active/disabled) — `admin/model.py:41,87` |
| `api_keys` | 长效 API key（admin 签发） | `key_hash`(bcrypt) / `key_prefix`(展示用) / `last_used_at`(节流写) / `revoked_at` — `auth/model.py:218` |

#### 2.1.3 Agent 运行域（执行编排 + 交互会话 + 多 agent）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `agent_runs` | 单次 agent 执行（核心状态机表，列最多） | `status`(pending/running/completed/failed/killed) / `task_id`/`lease_id`/`change_id`/`mission_id`/`parent_run_id`(FK) / `agent_profile_id`+`agent_profile_snapshot`(快照) / `idempotency_key`(部分唯一) / `gate_status`/`gate_result`(Driver Gate) / token 用量+cost 列 / `read_only` / `worktree_branch` — `agent/model.py:31` |
| `agent_run_logs` | run 流式日志行 | `channel`(stdout/stderr/tool_call) / `dedup_key`(部分唯一索引幂等去重) / `parent_tool_use_id`+`subagent_type`+`depth`(子代理归属) / `tool_kind`(结构化筛选) / `segment_id`(partial 去重) — `agent/model.py:350` |
| `agent_sessions` | 交互式 SDK 驱动会话（跨多 run） | `agent_session_id`(SDK session) / `lease_id`(kind=interactive) / `change_id`/`workspace_id`(SET NULL) / `status` / `deleted_at`(软删) — `agent/model.py:459` |
| `agent_missions` | 多 agent 委派聚合根（状态不落库，派生自子 run） | `objective` / `worker_preset`/`main_agent_config`(JSON) / `converged_at`(收敛守卫) — `agent/model.py:575` |
| `agent_run_dependencies` / `agent_artifacts` | run 间 DAG 边 / worker 结构化产出 | `(run_id,depends_on_run_id)` / `kind`(summary/patch/test_result/evidence) — `agent/model.py:661,700` |
| `daemon_borrow_audit` | 业务/管理人员借用开发人员 daemon 的审计行 | borrower/lender/workspace/agent_run 均 CASCADE；`daemon_instance_id` **RESTRICT**（审计红线） — `agent/model.py:741` |
| `agent_profiles` | AgentProfile 配置层（人格+工具引用，增强非替代） | `visibility`(private/workspace/platform) / `llm_provider_id`(SET NULL) / `tool_policy_id`/`mcp_refs`/`skill_refs` / `allowed_roots_overlay`(只能收紧) / `is_system_default` — `agent/profile/model.py:59` |

#### 2.1.4 Daemon 域（机器实体 + 任务队列 + 写行为审计）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `daemon_instances` | 物理守护进程实体（一台机一用户一后端） | `id`=daemon 上报的 `daemon_local_id`（后端不自生成） / `user_id`+`hostname`+`server_url` / `build_id` / `allowed_roots`(机器级沙箱) — `daemon/model.py:33` |
| `daemon_runtimes` | 实体下的一种 provider（claude/codex/…） | `daemon_instance_id`(过渡 nullable) / `provider` / `allowed_roots`(per-runtime 下沉) — `daemon/model.py:129` |
| `daemon_task_leases` | daemon 认领的任务租约 | `kind`(batch/interactive) / `status`(pending/claimed/completed/expired/cancelled) / `terminating_at`(终态观测窗口) / 复合索引 `runtime_status_created` 覆盖轮询热路径 — `daemon/model.py:299` |
| `daemon_change_writes` | daemon 代写 changes 文件队列（不启动 agent） | `kind`(create/edit) / `files`(JSON) / `claim_token` / `files_total`+`files_processed`(同步进度计数) — `daemon/model.py:408` |
| `session_dialog_requests` | AskUserQuestion 式持久化对话请求 | `request_id`(session 内唯一) / `dialog_payload`(JSON) / `status`(pending/answered/cancelled) — `daemon/model.py:222` |
| `policy_audit_log` | daemon 文件系统策略 ALLOW/DENY 审计 | `decision` / `provider`/`tool`/`path`/`reason` / 复合索引 `runtime_created_desc` — `daemon/audit/model.py:37` |

#### 2.1.5 变更流程域（SillySpec change/task 的结构化镜像 + 审批/审计）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `changes` | 变更主表（解析自 `.sillyspec/changes/<key>/`） | `change_key`+`workspace_id`(复合唯一 `ux_changes_workspace_key`) / `current_stage` / `stages`(JSON) / `approval_status` / `feedback_*` — `change/model.py:121` |
| `change_documents` | 变更目录内文档（design/plan/tasks…） | `(change_id,doc_type,path)` 复合唯一 / `word_count` — `change/model.py:207` |
| `tasks` | 任务卡（解析自 `tasks/task-NN.md`） | `(change_id,task_key)` 复合唯一 / `allowed_paths`/`depends_on`/`blocks`(JSON) — `task/model.py:21` |
| `change_reviews` | 变更评审裁定 | `verdict`(approve/reject) — `workflow/model.py:18` |
| `audit_logs` | 全变更操作 append-only 审计 | `(workspace_id,timestamp)` + `(resource_type,resource_id)` 索引 — `workflow/model.py:49` |

> 阶段状态枚举与转换合法性由代码常量承担（`change/model.py:29-114`）：`StageEnum` 5 主阶段 + `quick` 辅助；`TRANSITIONS` 编码 brainstorm→plan→execute→verify→archive 主链（quick 不进主线判定）。

#### 2.1.6 Spec 资产域（平台托管 spec 元数据 + 增量同步清单）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `spec_workspaces` | 平台托管 spec 目录（与 workspace 1:1） | `spec_root` / `strategy`(platform-managed/repo-mirrored/repo-native) / `spec_version`(整数，server 权威) / `sync_status` — `spec_workspace/model.py:43` |
| `spec_file_manifest` | 增量同步的 server 权威 per-file 清单 | `(workspace_id,path)` 复合唯一 / `content_hash`(SHA-256) / `version`(乐观锁基线) / `exists`(软删) — `spec_workspace/model.py:125` |
| `scan_documents` | 解析自 `.sillyspec/docs/<component>/scan/*.md` | `(workspace_id,path)` 复合唯一 / `content`/`content_hash`/`source_member_id`(协作溯源) — `scan_docs/model.py:21` |
| `spec_profile_manifests` | 导入的 SillySpec profile 清单（stages/gates 契约） | `manifest_json`(Text 全 blob) / `is_active`(service 层唯一) — `spec_profile/model.py:38` |
| `spec_conflicts` | 平台与 spec profile 的冲突记录 | `conflict_type`(gate/schema/path/validation) / `status`(open/approved/rejected/resolved) — `spec_profile/model.py:73` |

#### 2.1.7 发布与运维域（release + incident + postmortem）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `releases` | 发布单（捆绑多 change 部署） | `change_ids`(JSON) / `deploy_policy`(JSON) / `pre_check_result`/`post_check_result`/`deploy_output` — `release/model.py:17` |
| `release_approvals` | 发布审批票 | `(release_id,approver_id)` 复合唯一 / `verdict` — `release/model.py:89` |
| `incidents` / `postmortems` | 事故 + 复盘 | `severity`/`status`/`root_cause` / `action_items`(JSON) — `incident/model.py:15,47` |

#### 2.1.8 网关与策略域（worktree 租约 + git/tool 操作审计 + 工具策略）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `worktree_leases` | 隔离 git worktree 租约 | `path`(unique) / `branch_name` / `status`(locked/...) / `expires_at` — `worktree/model.py:21` |
| `git_operation_logs` / `tool_operation_logs` | git / 工具操作审计（每次调用落一行） | `operation`/`tool_type` / `result_code` / `redacted_output` / `(lease_id,timestamp)` 索引 — `git_gateway/model.py:20`、`tool_gateway/model.py:19` |
| `git_identities` | 用户绑定的 git 凭证 | `provider` / `encrypted_credential`(LargeBinary) / `key_id` / `allowed_repositories`(JSON) — `git_identity/model.py:24` |
| `tool_policies` | workspace 级工具执行策略 | `allowed_tools`/`blocked_commands`/`allowed_paths`/`allowed_domains`(JSON) / `max_timeout`/`max_output_size` — `tool_gateway/tool_policy.py:49` |

#### 2.1.9 凭证与集成域（LLM 凭证 + 技能 + 对外 MCP）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `llm_providers` | 用户级 LLM 供应商凭证（claude/codex/…） | `encrypted_api_key`(LargeBinary) / `key_id` / `api_format`(anthropic/openai) / `model_role_mappings`(JSON) / `is_default`((user_id,agent_kind) 维度互斥) — `llm_provider/model.py:26` |
| `custom_skills` | 用户自撰技能（SKILL.md body 入库） | `(created_by,name)` 联合唯一 / `content`(Text body) — `skills/model.py:33` |
| `mcp_tokens` | 第三方接入平台的 MCP token | `token_hash`(sha256，唯一索引) / `scope`(read/dispatch/converge) / `revoked_at` — `mcp_gateway/model.py:48` |
| `mcp_webhooks` | worker 终态回调注册 | `token_id`(CASCADE) / `secret`(HMAC 密钥) / `events`(JSON) / `active` — `mcp_gateway/model.py:113` |

#### 2.1.10 平台同步与配置域（CLI 进度落库 + KV 设置 + 文件中心）

| 表 | 用途 | 关键列 / 依据 |
|---|---|---|
| `platform_change_progress` | SillySpec CLI 六表进度聚合存储（裸 JSON 透传） | `(workspace_id,change_name)` 复合唯一约束（nullable 列 + 复合唯一，非复合 PK，过渡期 NULL 可写） / `latest_progress`(JSON) / `last_pushed_at`/`last_pusher`(**String** 存 ISO 字典序原值) — `platform_sync/model.py:53` |
| `platform_sync_tokens` | workspace 级进度同步 token（前缀 `shpsync_`） | `created_by`(**NOT NULL**，派生归属用户) / `token_hash`(sha256 唯一) / `revoked_at` — `platform_sync/token_model.py:42` |
| `platform_settings` | KV 平台设置 | PK=`key`(String) / `value` / `updated_by` — `settings/model.py:15` |
| `file` | 平台文件中心元数据（对象存储业务侧索引） | `stored_key`(unique 对象存储键) / `owner_type`+`owner_id`(多态归属，新建可空) / `mime_type`/`size` / `deleted_at`(软删) — `file/model.py:33` |

#### 2.1.11 PPM 业务域（已上线，项目管理 + 问题 + 计划 + 任务工时 + 看板，22 张表）

平台级（无 `workspace_id`），源 Java/Long 主键统一升 UUID，字段名 Java 驼峰转 snake_case。

| 子域 | 表 | 用途与关键列 / 依据 |
|---|---|---|
| 项目 | `ppm_project_maintenance` | 项目核心实体；`project_code`(unique) / `organization_id`(FK SET NULL，历史字段) — `ppm/project/model.py:49` |
| 项目 | `ppm_customer_maintenance` / `ppm_project_member` / `ppm_project_stakeholder` | 客户 / 成员（`user_id` 升 UUID FK，`(pm_project_id,user_id)` 唯一）/ 干系人 — `ppm/project/model.py:139,197,285` |
| 问题 | `ppm_problem_list` | 问题清单主表；`status`(中文三态 新建/进行中/已完成) / `now_node`(10/20/30/40 流程节点) / `file_urls`(JSON，弃源 9 字段) — `ppm/problem/model.py:63` |
| 问题 | `ppm_problem_change` | 问题变更（`resource_id`→problem_list，独立审批流 1/2/3） — `ppm/problem/model.py:179` |
| 问题 | `ppm_problem_list_process_task` / `_change_process_task` | 在办流程任务（每次流转删旧插新） — `ppm/problem/model.py:257,288` |
| 问题 | `ppm_problem_list_process_log` / `_change_process_log` | 流程履历 append-only — `ppm/problem/model.py:322,357` |
| 计划 | `ppm_plan_node` / `ppm_plan_node_detail` / `ppm_plan_node_module` | 计划模板三层（节点/明细/模块，`has_module` 决定二层 or 三层） — `ppm/plan/model.py:59,91,133` |
| 计划 | `ppm_ps_project_plan` / `ppm_ps_plan_node` / `ppm_ps_plan_node_detail` | 项目计划实例（金额/人天保 String 对齐源录入语义）/ 里程碑 / 里程碑明细（`status` 状态机 + `parent_id` 版本链 + `file_urls`） — `ppm/plan/model.py:183,263,319` |
| 计划 | `ppm_ps_plan_node_detail_process` | 明细流程履历 — `ppm/plan/model.py:408` |
| 任务 | `ppm_plan_task` / `ppm_task_execute` / `ppm_work_hour` | 计划任务（`kanban_order` 看板排序）/ 执行（状态机 10→20→30→40→90）/ 工时（丢弃源 tenant_id） — `ppm/task/model.py:46,141,218` |
| 看板 | `ppm_kanban_comment` / `ppm_kanban_subtask` | 任务评论 / checklist 子任务 — `ppm/kanban/model.py:37,65` |

**外键级联总览**：CASCADE 为主体清理语义（workspace/user 删→其下实体级联删）；`agent_profiles.agent_profile_id`、`tool_policies`、`change_id`(session 侧) 等「审计/历史保留」场景用 SET NULL；`daemon_borrow_audit.daemon_instance_id` 与 `user_roles.role_id`/`user_organizations.organization_id` 用 RESTRICT 作审计/引用红线。

### 2.2 Migration（Alembic 版本管理）

- **框架与配置**：Alembic（`backend/alembic.ini:7` `script_location = migrations`），`sqlalchemy.url` 留空、由 `migrations/env.py:58` 运行时从 `get_settings().database_url` 注入——连接串不落文件，避免硬编码凭证。
- **异步引擎复用**：`env.py:86-96` 用 `async_engine_from_config` + `NullPool` 自建临时引擎跑迁移，与应用运行时引擎解耦但共享同一 URL/pool 配置，永不一致性漂移。
- **autogenerate 元数据源**：`target_metadata = BaseModel.metadata`（`env.py:60`）；`env.py:20-50` 显式 `import` 约 24 个 feature model 模块，确保它们的 `SQLModel(table=True)` 类在 autogenerate 前注册到同一 metadata。**已知漂移点**：显式登记清单未含 `admin`、`skills`、`mcp_gateway`、`file`、`agent.profile`、`daemon.audit`、`workspace.member_runtimes`、`ppm.kanban` 等较新模块——它们靠运行时 router/service import 链被间接加载建表，但 autogenerate 若不被间接触发会漏判，新增表建议同步补登记。
- **版本线规模**：`backend/migrations/versions/` 共 **136 个版本文件**，时间跨度 2026-05-25（`202605251400_create_health_probe.py`）至 2026-08-13（`20260813173000_daemon_change_write_progress.py`）。命名混合两种风格：`YYYYMMDDHHMM_描述.py`（主流量）与 Alembic autogenerate 哈希（`4d9236aa3abb_merge_heads.py` 等 merge head）。
- **多分支合并**：存在多个 `merge_heads` 迁移（`4d9236aa3abb`、`1e69522e288c`、`b16bf63a5d05`、`dceb0c45ab3e`、`d5d239112387`、`20260706_merge_heads.py`），反映多 change 并行开发产生分支头后的人工/自动合并，是「多 agent 并发改同一 schema」留下的拓扑痕迹。
- **演进要点**：`platform_change_progress` 主键从 `change_name` 改 `id` + 复合唯一约束（`20260813170000_platform_change_progress_id_pk.py`，根治跨 workspace 重名 500）；PPM 外键源 Long ID 批量 `ALTER` 为 UUID（`202607220900_alter_ppm_fk_to_uuid.py`，残留 Long 降级 NULL 故多列 nullable）。

### 2.3 数据治理

#### 2.3.1 凭证加密（`backend/app/core/crypto.py`）

`CredentialCipher` 基于 libsodium `secret.SecretBox`（**xchacha20-poly1305** AEAD）。主密钥（KEK）从环境变量 `SILLYSPEC_MASTER_KEY` 读取（`crypto.py:37`），格式 `<key_id>:<32 字节 hex>`，裸 hex 兼容作 `v1`。**版本化轮换**：每个 cipher 实例绑单一 `key_id`，`decrypt` 校验 `key_id` 不匹配抛 `CipherKeyMismatch`（`crypto.py:72-77`），旧 key 保留供解密历史密文。消费方：`git_identities.encrypted_credential`、`llm_providers.encrypted_api_key`（均 `LargeBinary` 列）。

#### 2.3.2 SSRF 防护（`backend/app/core/ssrf.py` + `backend/app/modules/tool_gateway/tool_policy.py`）

统一 façade `assert_public_url`（`ssrf.py:34`）：scheme 白名单（http/https）+ 解析 host → `ToolPolicyService.assert_public_hostname`（`tool_policy.py:350`）。IP 原语双栈覆盖：`_PRIVATE_NETWORKS`（IPv4 私网/保留段）+ `_PRIVATE_NETWORKS_V6`（`::1`/`fc00::/7`/`fe80::/10`，`tool_policy.py:188-192`），阻塞 DNS 用 `asyncio.to_thread` 包 `socket.getaddrinfo` 防事件循环卡死，safe-side 策略（不可解析即拒）。三个入口复用：MCP webhook 回调、worktree git clone、http_get 工具——每跳重解析防 DNS 重绑定。git 仓库 URL 另走 `assert_safe_repo_url`（`ssrf.py:56`）：放行 https/ssh/git + scp-like，绝对拒 `ext::`（RCE）与 Windows 盘符（file:// 变体）。

#### 2.3.3 权限缓存（`backend/app/core/permission_cache.py`）

Redis 缓存 `rbac.has_permission` 与 PPM `data_scope` 热路径。**三键分离**（`permission_cache.py:96-104`，闭合 platform/all/workspace 互相覆盖污染）：`perm:{user_id}:platform` / `:all` / `:{workspace_id}`；PPM 数据范围独占 `ppm-scope:{user_id}`。**降级范式**：任何 Redis 故障静默降级回查 DB，鉴权永不因缓存层失败；唯独 `invalidate_all_permissions` 失败升 **ERROR** 级日志（安全事件必须告警，`permission_cache.py:255`）。**熔断器**（`permission_cache.py:36-83`，进程级模块变量三态 CLOSED/OPEN/HALF_OPEN）：连续失败达阈值后跳过 Redis 直查 DB，cooldown 后试探恢复。**类型安全要点**：`ppm-scope` 反序列化强制 `manager_project_ids` 还原为 `set[uuid.UUID]`（`permission_cache.py:194`），否则 `uuid-in-set[str]` 恒 False 致经理权限静默失效。

#### 2.3.4 Redis 客户端（`backend/app/core/redis.py`）

进程级单例 `redis.asyncio.Redis`（`redis.py:16`，自带连接池）。QueuePool 修复：`socket_timeout=3` + `socket_connect_timeout=3`（`redis.py:29-31`），publish/health-check 卡死时抛异常被调用方捕获，而非永久 hang 占线程并间接长期持 DB 连接。`health_check_interval=30`。用途：权限缓存 + 全量失效（`invalidate_all_permissions` 扫 `perm:*`/`ppm-scope:*` 批删）。

#### 2.3.5 DB 连接与事务（`backend/app/core/db.py`）

异步 SQLAlchemy（asyncpg 生产 / aiosqlite 测试）。进程级懒加载引擎（`db.py:67`），池参数面向多 agent 负载调优：`pool_size=20` / `max_overflow=30` / `pool_timeout=30s` / `pool_recycle=300s` / `pool_pre_ping=True`（`db.py:31-34`）。**PG 会话级超时**（`db.py:39-45`，经 `server_settings` 连接建立时下发，aiosqlite 忽略）：`statement_timeout=30s`（单语句上限）、`idle_in_transaction_session_timeout=120s`（放宽自 10s——误伤合法长事务致全站周期卡顿）、`lock_timeout=5s`（拿锁 fail fast）。慢查询日志：SQL >500ms 打 `slow.query`（`db.py:83` `setup_slow_query_logging`）。**审计上下文注入**（`db.py:116-151`）：`get_session` 从 Bearer token 解出 `actor_id` + path_param `workspace_id` 写入 `session.info["audit_context"]`，失败静默跳过。Session 工厂 `expire_on_commit=False` / `autoflush=False`。

### 2.4 文档资产（文档即数据）

与结构化进度互补的 markdown/yaml 资产，落在 workspace 的 `spec_root`（由 `SpecPathResolver` `backend/app/core/spec_paths.py:26` 统一解析，按 `spec_workspaces.strategy` 切换 `.sillyspec` 包裹 vs 平台扁平布局 `spec_paths.py:65-97`）。

| 资产 | 位置 | 消费者 | 血缘要点 |
|---|---|---|---|
| change 四件套 | `.sillyspec/changes/<key>/`（MASTER/proposal/requirements/design/plan/tasks/verify-result/module-impact，文件名常量 `spec_paths.py:32-50`） | daemon、platform_sync、前端变更中心 | **多阶段血缘核心**：CLI 产 → daemon 代写（`daemon_change_writes`）→ backend 解析入 `changes`/`change_documents`/`tasks` 表 |
| scan 文档 | `.sillyspec/docs/<component>/scan/*.md`（7 份） | brainstorm/plan 参考 | reparse 入 `scan_documents` 表（`content_hash` 去重，`source_member_id` 协作溯源） |
| 模块文档 + `_module-map.yaml` | `.sillyspec/docs/<component>/modules/` | archive 同步、架构资产 | 跨仓多 component：`SillyHub`/`backend`/`frontend`/`sillyhub-daemon`/`multi-agent-platform` 各一份（见 `.sillyspec/docs/`） |
| projects 清单 | `.sillyspec/projects/*.yaml` | workspace 初始化、组件识别 | 多组件项目拓扑（如 `sillyhub-daemon.yaml` 声明 daemon 子组件） |
| QUICKLOG | `.sillyspec/quicklog/` | quick 流程进度、人类对账 | 按 ql-ID 条目追加，CLI 接管 |
| local.yaml | `.sillyspec/local.yaml` | daemon 本地配置（platform 段 + mcp 段） | 双独立段：`platform:` 同步 url+token / `mcp:` 派发 url+token |
| knowledge / workflows / ROADMAP | `.sillyspec/knowledge/` `.sillyspec/workflows/` `.sillyspec/ROADMAP.md` | 知识库、流程模板、路线图 | 架构资产库 |

**platform_sync 同步层**（把 SillySpec CLI 进度落库的缝合层）——3 端点（`backend/app/modules/platform_sync/router.py:45,89,100,120`），双鉴权：`shpsync_` token（workspace 隔离，`require_platform_sync` 派生 `(user,workspace_id)`）或 `shk_live_`/JWT（过渡全局）。核心算法 `PlatformSyncService.upsert_progress`（`platform_sync/service.py:63`）按跨仓契约 §4.2 的 **base_ts ISO 8601 UTC 字符串字典序**乐观锁冲突检测：

- `base_ts` 空/缺失 → 无条件接受（首次同步）
- `stored > base_ts`（字典序，不转 datetime）→ **409 冲突**，返回平台当前完整六表，**绝不 auto-merge**
- 否则 → upsert

`latest_progress` 按裸 JSON 透传客户端 `serializeForSync` 六表（`platform_change_progress.latest_progress`，NG-6 不强类型化）。并发自愈（`service.py:115-140`）：客户端新建 change 首推并发双发撞复合唯一约束 → catch `IntegrityError` 回退 UPDATE（跨 SQLite/PG 方言一致，免 `ON CONFLICT` 分支）。`list_lightweight`（`service.py:154`）从裸 JSON 抽 `changes[0].current_stage` 供变更中心轻量列表。

### 2.5 运行时数据与存储目录

平台数据分四个独立存储卷（`deploy/docker-compose.yml` volumes）+ daemon 本地运行时目录：

| 存储 | 卷 / 路径 | 内容与治理 | 依据 |
|---|---|---|---|
| **平台 DB** | `pgdata:/var/lib/postgresql/data`（PG 16-alpine） | 全部结构化业务数据（§2.1 的 77 张表）；独立于 LiteLLM 自带 DB | `docker-compose.yml:13-14` |
| **LiteLLM DB** | `litellm-db-data:/var/lib/postgresql/data`（独立 PG 16） | LiteLLM 网关自身的 alembic_version + 用量/虚拟 key，**刻意独立**避免与项目 alembic_version 表冲突 | `docker-compose.yml:171-172` |
| **Redis** | `redisdata:/data`（redis:7-alpine，`--appendonly yes`） | 权限缓存 + PPM data_scope + 发布订阅；AOF 持久化 | `docker-compose.yml:28-29` |
| **对象存储** | `minio-data:/data`（MinIO，S3 兼容） | 平台文件中心（`file` 表元数据 + 对象实体），S3 兼容端点 `s3_endpoint`（未来可零改动换 OSS）；配置 `backend/app/core/config.py:247-258` | `docker-compose.yml:47-48` |
| **Spec 存储** | `${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces` | 平台托管 spec 根（`spec_data_root`，`config.py:192`），按 workspace 分桶；经 `resolve_spec_data_root`（`paths.py:41`）相对路径锚定到 repo root 而非 CWD，避免 `backend/data/...` 误解析 | `docker-compose.yml:96` |

**daemon 本地运行时目录**（每台用户机）：`~/.sillyhub/` + 各 workspace 的 `.sillyspec/.runtime/`（由 SillySpec CLI 管理，非平台 DB 落盘）——含 `sillyspec.db`（CLI 进度 SQLite）、`local.yaml`（本机 platform/mcp 配置，由 daemon `writeLocalYaml` 写）、`.sillyspec-platform.json`（`spec_version` 本地基准，与平台 `spec_workspaces.spec_version` 比对决定是否拉新 bundle）、`changes/`（daemon 代写的变更文件树）。平台与 daemon 间的状态缝合由 `platform_sync` 上行（进度→`platform_change_progress`）与 `daemon_change_writes` 下行（文件写任务队列）双向承担。

---

## 3. AA 应用架构（怎么做）

> 本章以 `backend/`、`frontend/`、`sillyhub-daemon/` 源码为唯一事实源。凡涉及具体行为的论断均带 `文件:行号` 依据。SillyHub 的“应用”不是单个服务，而是 **平台（backend FastAPI + frontend Next.js）+ 守护进程（sillyhub-daemon Node）+ LLM 网关（LiteLLM）+ CLI（SillySpec）** 四者协作的分布式应用——agent 的真正执行体在 daemon 侧，平台侧只编排与治理。

### 3.1 模块分层

#### 3.1.1 后端分层（FastAPI，四层）

| 层 | 代表文件 | 职责 |
|---|---|---|
| **L0 入口装配** | `backend/app/main.py:175 create_app` + `:78 lifespan` | FastAPI 实例、CORS、request-id / 慢请求中间件（`main.py:196,207`）、异常处理注册（`main.py:213`）、约 35 个 router 的 `include_router` 装配（`main.py:516-600`）、MCP mount（`main.py:608`）、lifespan 内的 bootstrap（RBAC seed `:100`、stale run 清理 `:102`、gate reconcile `:113`、profile seed `:131`、存储初始化 `:149`、MCP session_manager `:159`） |
| **L1 横切层 `core/`** | `config.py`（`Settings` 11 组配置，`:42`）、`db.py`/`redis.py`、`auth_deps.py`（鉴权依赖，`:56/:86/:140`）、`security.py`（bcrypt+JWT，`:47/:91`）、`permission_cache.py`（Redis+熔断器，`:36`）、`audit_hooks.py`（SQLAlchemy event 审计，`:290`）、`ssrf.py`（`:34/:56`）、`errors.py`（`AppError`+`register_exception_handlers:363`）、`monitoring.py`（慢请求+事件循环看门狗，`:30/:74`）、`logging.py`、`telemetry.py`、`crypto.py` | 跨模块复用的非业务原语：配置、数据访问、鉴权、审计、安全、可观测性 |
| **L2 业务模块 `modules/`** | 30 个子目录，每个遵循 `router.py`/`service.py`/`model.py`/`schema.py` 四件套 | 一个业务域一个模块，router 只做 HTTP 适配，service 持业务逻辑，model 持 ORM，schema 持 Pydantic |
| **L3 工具/原语** | `core/paths.py`、`core/spec_paths.py`、各模块内 `*_service.py` 的 helper | 底层路径与纯函数 |

> **router 不带 prefix 的约定**：多数 router 自带完整路径（如 `agent/router.py` 写 `/workspaces/{id}/agent/runs`），`main.py` 仅 `include_router(..., prefix="/api")` 落地 `/api/...`（`main.py:551`）。`platform_sync/router.py` 刻意不自带 prefix 以规避 FastAPI 尾斜杠 307（`platform_sync/router.py:8-9`）。

**L2 的 30 个业务模块**（`ls backend/app/modules/`）按域分组：

| 域 | 模块 | 核心职责 |
|---|---|---|
| Agent 编排（核心，见 3.2） | `agent/`、`agent/profile/` | mission 编排、worker 派发、收敛、AgentProfile 配置层 |
| Daemon 协作 | `daemon/`（含 `lease/`、`host_fs/`、`session/`、`runtime/`、`reaper/`、`audit/`、`run_sync/`、`patch/`）、`workspace/member_runtimes/` | lease 生命周期、WS hub、宿主文件系统 RPC、permission 审批、member binding |
| Spec 同步 | `platform_sync/`、`spec_workspace/`、`spec_profile/`、`scan_docs/` | SillySpec 进度上行、spec 目录托管、profile 门控 |
| 对外集成 | `mcp_gateway/`、`tool_gateway/`、`llm_provider/` | 对外 MCP server、工具策略、LLM 供应商 |
| 变更/任务 | `change/`、`task/`、`change_writer/`、`worktree/`、`workflow/`、`release/`、`incident/` | 变更/任务/工作树/工作流/发布/故障 |
| 组织/权限 | `auth/`、`admin/`、`workspace/`、`skills/`、`settings/` | 用户/角色/RBAC/工作区/技能/设置 |
| 文件/网关 | `file/`、`git_gateway/`、`git_identity/`、`storage/` | 平台文件中心、Git 读写、Git 凭据、对象存储 |
| 业务应用 | `ppm/`（6 子 router）、`health/`、`runtime/`、`knowledge/` | 项目管理、健康检查、运行时、知识库 |

#### 3.1.2 前端分层（Next.js App Router，五层）

| 层 | 代表文件 | 职责 |
|---|---|---|
| **F1 路由 `app/`** | `(auth)/login/`、`(dashboard)/`（`workspaces/`、`admin/`、`ppm/`、`settings/`、`runtimes/`、`account/`、`agent-profiles/`）、`m/`（移动）、`page.tsx` | 路由组（auth）登录守卫、（dashboard）工作区守卫（`layout.tsx:16 WORKSPACE_WHITELIST` + `:46` 客户端工作区守卫） |
| **F2 API 代理 `app/api/`** | `daemon/sessions/[sessionId]/stream/route.ts`、`daemon-chat/[runId]/stream/route.ts`、`workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts` | Next.js Route Handler 作 **无缓冲 SSE 代理**，解决浏览器 EventSource 不能自定义 header（token 走 query → 转 `Authorization` header，`sessions/.../stream/route.ts:36-47`）+ `compress:false` 关 undici 缓冲（`:57`） |
| **F3 组件 `components/`** | `app-shell.tsx`、`agent/`、`agent-log/`、`agent-profile/`、`daemon/`、`workspace/`、`ppm/`、`changes/`、`charts/`、`ui/`（12 个基础组件）、`layout/`、`mobile/`、`permissions/` | 业务组件按域分目录，`ui/` 是设计系统基础组件（对标 style-system 总纲） |
| **F4 API client `lib/`** | `api.ts`（fetch wrapper，`:46 ApiError`）、`api-types.ts`（**自动生成，禁止手写**，`:1-3`）、`auth/`（`route-guard.ts`）、按域的 `*.ts`（`agent.ts`/`daemon.ts`/`workspace.ts`/`changes.ts`/`ppm/`…）、`token-refresh.ts`、`query-client.ts`（React Query） | 每个后端域一个 client 文件，统一经 `api.ts` fetch 包装 |
| **F5 状态 `stores/`** | `session.ts`（zustand+persist，token/user）、`workspace.ts`（**非 persist**，URL 为真相源，`workspace.ts:9-12`）、`kanban.ts` | 客户端状态；session 持久化、workspace 仅缓存 |

#### 3.1.3 守护进程分层（sillyhub-daemon Node，六层）

> 入口是 `dist/cli.js`（`package.json:7 main` / `:8 bin`），即源码 `src/cli.ts`（commander）。`src/index.ts` 是占位（`index.ts:6 export {}`）。Node ≥ 20，纯 ESM，依赖 `@anthropic-ai/claude-agent-sdk`+`@modelcontextprotocol/sdk`+`ws`+`commander`+`zod`（`package.json:28-34`）。

| 层 | 代表文件 | 职责 |
|---|---|---|
| **D1 CLI 入口** | `cli.ts`（`createProgram:312`、`startAction:425` 全对象图装配 → `daemon.start()`） | 进程入口、PID/日志管理、top-level 异常兜底（`:1020`） |
| **D2 编排核心** | `daemon.ts`（`class Daemon:616`、`start():861`、`_registerDaemon:1048`、三循环 `_heartbeatLoop:1912`/`_pollLoop:2107`/`_wsLoop:2163`、`_runLeaseStateMachine:3512`、`_startInteractiveSession:2946`） | 注册→三循环→lease/session 状态机，**只编排不实现**，委托给 taskRunner/sessionManager |
| **D3 通信** | `hub-client.ts`（REST 客户端，`class HubClient:254`，register/claim/complete/spec-sync/team MCP 全在这里，`:359/:436/:504/:877/:1135`）、`ws-client.ts`（WS 客户端，`class WsClient:164`，5s 重连 `:32`+keepalive ping）、`protocol.ts`（`MSG:21` 消息常量 + `WS_PATH:332`/`REST_PREFIX:339`） | WS 主推 + HTTP REST 生命周期 + 轮询兜底 |
| **D4 执行** | `task-runner.ts`（batch lease 9 步，`class TaskRunner:243`/`runLease:378`）、`interactive/`（`claude-sdk-driver.ts:310` 用官方 SDK 同进程多轮、`session-manager.ts:426` 会话生命周期、`codex-app-server-driver.ts`）、`adapters/`（6 wire protocol × 12 provider 的 stdout 解析，`index.ts:52 PROTOCOL_PROVIDERS`：stream-json/json-rpc/jsonl/ndjson/pi-json/text） | 真正 spawn/驱动 agent CLI |
| **D5 集成** | `mcp-server.ts`（**注入给主 agent 的 stdio MCP**，`createMcpServer:143` 注册 5 个 tool `:158-310`，路由到 backend `mcp_tools.py`）、`spec-sync.ts`（spec bundle 拉取/增量推送，`resolveSpecDir:39`=`~/.sillyhub/daemon/specs/{ws}`、`postSpecSync:504` 增量 manifest）、`credential-injector.ts`（provider→env，`:54 ClaudeCredentialInjector`）、`local-yaml-writer.ts`（字节级 YAML 段替换写 `.sillyspec/local.yaml`）、`skill-manager.ts`、`mcp-config.ts` | agent 与平台反向交互、spec 同步、凭据注入 |
| **D6 治理/韧性** | `policy/`（`runtime-policy.ts` PolicyCache、`filesystem-policy.ts` PolicyEngine.canWrite、`audit-sink.ts` AuditBatchSender）、`resilience/`（`service.ts:71` 重试编排、`outbox.ts:69` 文件 JSONL 溢出、`error-classify.ts:39` isRetryable）、`permission-rules.ts`、`runtime-lock.ts`（一机一人一 provider 一 daemon）、`agent-detector.ts` | 文件系统策略、网络重试、权限规则、运行时锁 |

### 3.2 Agent 编排引擎（AA 核心）

Agent 编排是本平台 AA 的核心能力。**关键架构事实**：backend 侧的 `agent/adapters/` 目录是空的（只有 `__init__.py`），`base.py:129 AgentAdapter(ABC)` 是抽象但**无具体子类**——backend 不在进程内执行 agent，所有执行走 daemon lease/subprocess 路径（`placement.py` + daemon `task-runner.ts`）。backend 的职责是**编排、治理、收敛**，不是执行。

#### 3.2.1 两种编排模式

| 模式 | 入口 | 拆解者 | 触发 |
|---|---|---|---|
| **single** | `MissionService.start_mission`（`mission.py:70`） | GLM `CoordinatorPlanner.plan`（`delegation.py:161`）直接 API 调用（非 agent CLI，spike 04 结论） | 预先拆成 N 个 pending worker run |
| **team** | `OrchestratorService.team_mission_entry`（`orchestrator.py:130`） | 主 agent（真 agent，走 daemon lease + MCP tool）**动态**拆解 | 建主 agent run（role=orchestrator）+ 派 daemon lease，worker 由主 agent 经 MCP 反向 dispatch |
| **external**（路径A） | `OrchestratorService` `orchestration_mode="external"`（`orchestrator.py:186`） | caller（SillySpec execute）自己在 worktree 派 worker | 只建 mission，**跳过**主 agent run + daemon lease，constraints 落 `orchestration_mode:external` |

路由由 `delegation.route`（`delegation.py:39`）三档（single/team/auto，auto 用关键词+长度启发式 `:51`）。`MAX_WORKERS=5`（`delegation.py:30`）。

#### 3.2.2 派发链路（backend → daemon）

派发的单一入口是 `RunPlacementService`（`placement.py:244`），三类 lease：

| 方法 | 用途 | lease kind | 过期 |
|---|---|---|---|
| `dispatch_to_daemon`（`:313`） | stage run / mission worker / quick-chat worker | `interactive`（`:477`） | 由 `complete_lease` 管 |
| `prepare_interactive_dispatch`（`:575`） | 新建交互会话首轮 | `interactive` + `lease_expires_at=NULL`（`:709`，永不超时） | `DaemonService.end_session` 管 |
| `prepare_scan_interactive_dispatch`（`:747`） | scan 真阻塞 | 同上 + scan bundle metadata | 同上 |

**核心链序**（以 `dispatch_to_daemon` 为例，`placement.py:365-550`）：
1. `_resolve_dispatch_runtime`（`:967`）解析目标 runtime——**per-member binding 是唯一真相源**（`WorkspaceMemberRuntime` 行），无 binding 抛 `NoOnlineDaemonError`。
2. profile.provider 优先级（D-014，`:1009`）：`profile.provider > caller provider > workspace.default_agent`；`_resolve_profile_provider`（`:1097`）对 `agent_profile_id=None` 零查询（C-07）。
3. 组装 lease `metadata` JSON（prompt/provider/model/repo_url/branch/allowed_paths/tool_config/root_path/spec_root/...，`:391-435`），强制 `manual_approval=True`+`ask_user_only=True`（`:434-435`，scan 模式，AskUserQuestion 走人审其余放行）。
4. raw SQL INSERT `daemon_task_leases`（`:471`）+ INSERT `agent_sessions`（`:503`）+ 关联 `agent_runs.agent_session_id`（`:523`）。
5. `_send_ws_wakeup`（`:1382`）经 `DaemonWsHub` 发 `task_available` 唤醒 daemon。

**Worker 的 per-worktree 隔离**（`execution.py:217-268`）：每个 worker 在 `ws.root_path/.worktrees/<run.id[:8]>/` 建 git worktree 副本 + 分支 `workers/<run.id[:8]>`（`:224-225`），副本作 daemon `root_path`（worker cwd=副本，并发写不互覆）。`worker_tool_config`（`:83`）按 read_only 白名单工具：read-only=`{Read,Glob,Grep}`+plan 模式+25 turns，write=`+Edit/Write/Bash`+acceptEdits+30 turns——**daemon 端 live 强制**（`execution.py:14-31` 实测修正，stream-json.ts 映射 `--allowedTools`/`--permission-mode`）。

#### 3.2.3 借用（borrow）—— 无自有 daemon 的兜底

`_resolve_borrowed_or_own_runtime`（`borrow_resolver.py:43`）是 4 路派发 resolver 的统一入口（D-008），两步：
1. **自有路径**（零回归）：actor 的 member binding 有在线自有 daemon → 返回 `(runtime, False, None)`。
2. **借用路径**：无在线自有 → `DAEMON_BORROW` 权限闸（`:103 has_permission`）→ `resolve_shared_daemon_for_borrow` 单 SQL 解析 shared+online lender → 返回 `(runtime, True, lender_user_id)`。

三重校验顺序：**权限 → shared → online**（`borrow_resolver.py:67`）。借用 lease 写沙箱隔离 marker（`placement.py:81 _BORROW_SANDBOX_MARKER`，值 `borrow-sandbox:` + `:94 _stamp_borrow_sandbox_metadata`），daemon 侧 `prepareWorkspace` 建空沙箱目录 + `SessionManager.registerBorrowSandbox` 按 lease 隔离只读 policy。每次借用显式写 `daemon_borrow_audit` 审计行（`placement.py:138 _insert_borrow_audit_row`，D-004 不限额）。

#### 3.2.4 收敛（converge）—— 单锚点单写者

`converge_mission_for_completed_run`（`finalizer.py:470`）是收敛唯一入口，在 `complete_lease` 末尾触发（D-007 单锚点）。链序：
1. `collect_completed_artifacts`（`execution.py:400`）回灌 worker 产出为 `AgentArtifact`（summary + write worker 的 patch）。
2. `derive_status`（`mission.py:29`，纯函数，mission 状态**不落库**，从子 run 派生）判 done/degraded。
3. **R5 原子抢占**（`finalizer.py:531`）：`UPDATE AgentMission SET converged_at WHERE converged_at IS NULL`，`rowcount=0` 者放弃，杜绝并发重复 finalize。
4. 路由分流：execute mission（有 patch/worktree_branch）→ `finalize_execute_mission`（`:219`）逐个 `git_merge` worker 分支到 workspace root；bootstrap mission（只读 summary）→ `finalize_bootstrap_mission`（`:157`）GLM 合并。

**可重入解冲突**（`mcp_tools.py:514 converge_mission`）：merge 冲突返 `status=conflict`+conflicts 给主 agent，主 agent 自己用 SDK Read/Edit 解决后 `git add` 重入；R-07 上限默认 3 轮（`mcp_tools.py:218`，存 `AgentMission.constraints.conflict_attempts`），超限标 `needs_manual`+副本保留（X-003）。全 merged 成功 → `cleanup_mission`（`finalizer.py:348`）清 worker worktree 副本。

**三重收敛信号**（`orchestrator.schedule_loop:263`，backend 兜底巡检）：worker 全终态 / 主 agent 自主 converge / budget 硬截断。

#### 3.2.5 主 agent 反向控制（MCP tool）

主 agent 通过 daemon 注入的 stdio MCP server（daemon `mcp-server.ts:143`）调 5 个 tool，转发到 backend `agent/mcp_tools.py` 的 5 个 endpoint（`/workspaces/{wid}/missions/{mid}/dispatch_worker|workers|workers/{id}/result|converge|progress`，`mcp_tools.py:354/464/493/513/646`）。鉴权双路径：浏览器/直调走 JWT，daemon MCP server 走 `X-API-Key`（`mcp_tools.py:10-16`）。这 5 个 endpoint 另有镜像版本作为对外 MCP tool（`mcp_gateway/tools.py`，见 3.3）。

#### 3.2.6 治理门（control）

`MissionControlService`（`control.py:33`）：`can_dispatch_worker`（`:69`）派发前门——mission_cancelled / `running_worker_count>=MAX_WORKERS`（用 running 非 active，D-008）/ budget 超支；`cancel`（`:89`）标 `cancelled_at` + 委托 `DaemonLeaseService.cancel_lease` 真发取消信号（batch 心跳 SIGTERM、interactive WS SESSION_INTERRUPT）。

#### 3.2.7 上下文构建（context_builder）

`context_builder.py` 产出 `AgentSpecBundle`（`base.py:56`，adapter 消费的主数据结构），三个 builder：
- `build_spec_bundle`（`:97`）task 级、`build_stage_bundle`（`:211`）stage 级（带 `stage_meta` 供 daemon 注入 `STAGE_META` 环境变量驱动 skill）、`build_scan_bundle`（`:354`）workspace scan（构造 sillyspec scan 命令模板注入 prompt）。
- scan bundle 的 `resolve_prompt_spec_root`（`:328`）恒返回 `~/.sillyhub/daemon/specs/{ws_id}`，与 daemon `spec-sync.resolveSpecDir` 逐字符一致。

#### 3.2.8 执行可靠性（coordinator）

`ExecutionCoordinatorService`（`coordinator.py:82`）提供 6 个能力点：幂等（idempotency_key `:129`）、乐观锁（version `:142`）、上下文指纹 SHA-256（`:190`）、resume_token（`:219/:236`）、checkpoint（`:317/:372`）、approval_token（`:390/:421`）。注意 `start_sillyspec_run`（`:473`）已 `@deprecated`（`:502`），改走 `SillySpecStageDispatchService`。

### 3.3 集成方式

#### 3.3.1 daemon ↔ backend 通信（WS 主推 + REST 生命周期 + 轮询兜底）

| 通道 | 方向 | 机制 | 依据 |
|---|---|---|---|
| **WebSocket（主）** | 双向 | 单 WS `/api/daemon/ws?daemon_local_id=...`（`protocol.ts:332 WS_PATH`）。server→daemon 推 `task_available`/`session_*`/`permission_response`/`lease_cancel`/`provider_config_changed`/`self_update` + 双向 `heartbeat/ack` + `rpc/rpc_result`。5s 固定退避重连 + 30s ping keepalive | backend `daemon/ws_hub.py:42 DaemonWsHub`（`send_wakeup:254`/`send_session_control:313`/`send_permission_response:339`/`send_rpc:404`/`resolve_rpc:497`）；daemon `ws-client.ts:164`（`RECONNECT_INTERVAL_MS:32`/`WS_PING_INTERVAL_MS:49`） |
| **HTTP REST（生命周期）** | daemon→server | `HubClient`（`hub-client.ts:254`）经 Node 原生 fetch（G-05 零 HTTP 库），`REST_PREFIX=/api/daemon`（`protocol.ts:339`）：`register:359`/`heartbeat:399`/`claimLease:436`/`startLease:451`/`leaseHeartbeat:466`/`submitMessages:482`/`completeLease:504`/`getPendingLeases:523`（唯一 GET） | backend 对应 `LeaseService`（`lease/service.py:92`：`create_lease:108`/`claim_lease:141`/`complete_lease:287`/`expire_leases:772`） |
| **轮询兜底** | daemon→server | WS 断线时 `_pollLoop`（`daemon.ts:2107`）周期拉 `getPendingLeases` | daemon 三循环并发：`_heartbeatLoop:1912`/`_pollLoop:2107`/`_wsLoop:2163` |
| **宿主文件 RPC** | 双向 | backend→daemon 经 `DaemonWsHub.send_rpc`（`ws_hub.py:404`）发 `daemon:rpc`，daemon `ws-client.ts:477 _dispatchRpc` 分发到 `file-rpc.ts`（list_dir/git_worktree_add/git_merge/git_rev_parse/...）回 `daemon:rpc_result` | backend `daemon/host_fs/delegate.py`（`HostFsDelegate`）+ `host_fs/ws_rpc.py` |

> **lease 完成回写**（`complete_lease`，`lease/service.py:287`）是 batch 与 interactive lease 的**单一收口点**——mission 收敛（3.2.4）挂在这里。`_sync_stage_status_from_run`（`:683`）同步 stage 状态。

#### 3.3.2 MCP 集成（两套 MCP，职责不同）

| MCP server | 位置 | transport | 消费者 | 工具数 |
|---|---|---|---|---|
| **对外 MCP（平台）** | `mcp_gateway/server.py:59 mcp`（FastMCP `streamable_http_path="/"`） | streamable HTTP，挂 `/mcp/`（尾斜杠，`server.py:62 mount_mcp`） | 第三方 MCP client / 外部 agent（经 `McpToken` `shmcp_` 鉴权，`auth.py:150 McpAuthMiddleware`） | **12 个**（`tools.py`，`server.py:57` 注释写“8”已过时）：`dispatch_worker`/`get_worker_result`/`list_workers`/`converge_mission`/`report_progress`/`list_agent_profiles`/`create_mission`/`get_run_logs`/`advance_change_stage`/`submit_stage_review`/`run_verify_gate`/`get_change_stage`（`tools.py:335-1182`），分 `read`/`dispatch`/`converge` 三 scope |
| **daemon 内置 MCP（注入主 agent）** | `sillyhub-daemon/src/mcp-server.ts:143 createMcpServer` | **stdio**（注入 agent 的 `--mcp-config`） | 主 agent（orchestrator） | 5 个（`mcp-server.ts:158-310`）：`dispatch_worker`/`get_worker_result`/`list_workers`/`converge_mission`/`report_progress`，经 `X-API-Key` 转发到 backend `agent/mcp_tools.py` 5 endpoint |

两者工具重叠 5 个（team 编排），对外 MCP 多 7 个（stage 推进/profile/mission 创建）——前者给外部 agent，后者给平台 spawn 的主 agent。鉴权物理隔离（`server.py:84` middleware 挂子 app，CC-06）。

#### 3.3.3 platform_sync 同步层（SillySpec 进度上行）

`platform_sync/router.py` 4 端点（无 prefix，挂 `/api`）：
- `POST /changes/{name}/progress`（`:45`）上行 + `base_ts` **字典序乐观锁**冲突检测（200 接受 / 409 冲突，`service.py:63 upsert_progress`，算法 `service.py:72-91`：base_ts 空无条件接受、stored>base_ts 字典序则 409 绝不 auto-merge）。读 3 个 `X-SillySpec-*` header（Base-Ts/Pushed-At/User）。
- `GET /changes`（`:89`）轻量列表（裸数组）、`GET /changes/{name}/progress`（`:100`）完整六表 JSON、`GET /changes/{name}/approval`（`:120`）execute 审批门控。
- workspace 隔离：`shpsync_` token 派生 workspace_id（`token_service.py:71`，sha256 直存 O(1)），`require_platform_sync`（`auth.py:45`）Bearer 三分派（`shpsync_`/`shk_live_`/JWT）。

daemon 侧 `spec-sync.ts` 负责 spec bundle 的拉取（`pullSpecBundle:91` tar 拉取）与增量推送（`postSpecSync:504`，本地 manifest 缓存 `~/.sillyhub/daemon/manifests/{ws}.json` 算增量 diff，失败回退全量 tar）。

#### 3.3.4 SillySpec CLI 集成

平台不直接跑 SillySpec 业务逻辑，而是：① `context_builder.build_scan_bundle`（`:354`）/`build_stage_bundle`（`:211`）构造 sillyspec 命令模板注入 agent prompt；② daemon 在 lease cwd 执行 sillyspec CLI（`task-runner.ts` spawn）；③ sillyspec 经 daemon `spec-sync.ts` 把进度上行到 platform_sync 端点；④ stage 派发经 `AgentService.start_stage_dispatch`（`service.py:1216`）+ `SillySpecStageDispatchService`（change 模块）。lifespan 启动时 `reconcile_pending_gate_decisions`（`main.py:113`）扫孤儿 gate 任务重 enqueue。

#### 3.3.5 LiteLLM 网关（Anthropic↔OpenAI 转换）

`deploy/docker-compose.yml:180`（`ghcr.io/berriai/litellm:v1.95.0` **pin 不滚动**，`:192` 注释：1.96.0 起 anthropic adapter 不认 `model_info.mode=chat`→打上游 `/responses`→OpenAI 兼容上游 404）。独立 `litellm-db`（`:161`，LiteLLM 自带 alembic 与项目 `alembic_version` 同名冲突，必须独立实例）。`deploy/litellm-config.yaml:15 model_list:[]` 起步空，openai 供应商 set-default 时 backend 经 admin API `POST /model/new` 注册 `model_name=usr-<uid>-<pid>`（`litellm-config.yaml:5-7`）。`drop_params:true`（`:20`）丢弃 anthropic-only 参数。**不暴露端口**（`docker-compose.yml:223`，仅同 network 可达，master key 泄漏=所有上游 key 暴露）。凭据注入由 daemon `credential-injector.ts:95 ClaudeCredentialInjector` 的 `openai_chat` 分支处理（`ANTHROPIC_BASE_URL=litellm`）。

### 3.4 可复用判定 / 中间件

| 中间件 | 文件 | 判定什么 | 设计要点 |
|---|---|---|---|
| **permission_cache** | `core/permission_cache.py` | RBAC 权限 + PPM data_scope 的 Redis 缓存 | 三键分离（platform/all/workspace，`perm:{uid}:{scope}`）防互相覆盖污染；**熔断器** CLOSED/OPEN/HALF_OPEN（`:36 _BreakerState`/`:43 _breaker_is_open`），Redis 故障静默降级查 DB（D-002），仅 `invalidate_all_permissions` 失败升 ERROR（安全事件）；`ppm-scope` 的 `manager_project_ids` 必须反序列化为 `set[uuid]`（D-005） |
| **auth_deps** | `core/auth_deps.py` | 身份 + 权限依赖注入 | **无全局中间件**，每个受保护路由显式声明（`:1-9`）。`get_current_user:56`（仅 JWT）、`get_current_principal:140`（**双路径**：JWT→API Key fallback，供 daemon 长期凭据）、`require_permission:86`（factory，按 path `{workspace_id}` 校验）、`require_permission_any:110`、`require_platform_admin:128` |
| **audit_hooks** | `core/audit_hooks.py` | 自动审计所有表变更 | SQLAlchemy **ORM event**（非 engine event），`after_insert/update/delete`（`:182/:213/:256`）捕获所有 `BaseModel(table=True)` 子类（除 `audit_logs` 防递归 `:25`），Core 级 `AuditLog.__table__.insert()` 与变更同事务原子写（`:146`）；actor 从 `connection.info["audit_context"]` 取；`register_audit_hooks:290` 幂等注册 |
| **post_scan_validator** | `agent/post_scan_validator.py` | scan 结果平台侧校验 | 纯判定逻辑留 backend（ERROR_PATTERNS 正则 `:71`/状态机 `_determine_status:307`），原语（git_rev_parse/pollution_archive/read_package_json）经 `HostFsDelegate` RPC（D-009 方案 B），RPC 失败语义安全降级不抛（D-006）；三态 SUCCESS/FAILED_POST_CHECK/COMPLETED_WITH_WARNINGS |
| **control 治理门** | `agent/control.py:69 can_dispatch_worker` | mission 派发前预算/并发/取消门 | concurrency 用 `running_worker_count`（非 active，`:58`，否则 N pending 未派发就触顶） |
| **borrow_resolver** | `agent/borrow_resolver.py:43` | 自有/借用 runtime 解析 | 4 路派发统一入口（D-008），避免“decide 通过但 dispatch 报错”割裂（R-01） |
| **ssrf** | `core/ssrf.py` | URL/repo 安全 | `assert_public_url:34`（scheme 白名单+每次重解析 IP 防 DNS rebinding）、`assert_safe_repo_url:56`（拒绝 `ext::`RCE/`file://`） |
| **errors** | `core/errors.py` | 统一错误信封 | `AppError:28`（instance 级 code/status/details 覆盖，非 class 级防共享态泄漏）、~30 子类、`register_exception_handlers:363` 四类 handler |

### 3.5 接口契约

#### 3.5.1 OpenAPI → 前端类型（强契约，禁止手写）

`backend/app/main.py:183 openapi_url="/api/openapi.json"` 暴露 OpenAPI spec → `pnpm gen:types`（openapi-typescript）生成 `frontend/src/lib/api-types.ts`（文件头 `:1-3`「auto-generated, do not make direct changes」）。**项目硬规则**（CLAUDE.md 规则 20）：后端 DTO 改动必须同 change 跑 `pnpm gen:types` 并提交 `api-types.ts` + `backend/openapi.json`，禁止手写类型形成债。daemon 侧同构：`sillyhub-daemon/scripts/gen-api-types.mjs` 生成 `src/api-types.ts`（`package.json:19`）。

#### 3.5.2 SSE stream 契约（log/事件流）

- **backend SSE 生成器** `AgentService.stream_run_logs`（`service.py:1021`）：订阅 Redis Pub/Sub `agent_run:{run_id}` + `agent_session:{session_id}`（permission_request/turn_completed 事件），发 `data` / `done` / `: keepalive`（~30s）。**连接池安全**：用 `get_session_factory()` 短 session，不占请求级连接（`:1039-1043`）。
- **前端代理** Route Handler（`app/api/.../stream/route.ts`）无缓冲转发：`compress:false` 关 undici 缓冲（`sessions/.../stream/route.ts:57`）、token 从 query 转 `Authorization` header（`:36-47`，不进 backend access log）、`X-Accel-Buffering:no`。
- **mission SSE** `mcp_gateway/sse.py:149 stream_mission_events`：短轮询 AgentRun 每 2s 推 worker_status 帧 + 终态 done 帧。
- **stream 端点清单**：`agent/router.py:482`（run 级）、`main.py:339`（quick-chat run 级）、`mcp_gateway/sse.py:149`（mission 级）、backend `daemon` 模块（session 级）。

#### 3.5.3 MCP 工具契约

对外 MCP（`mcp_gateway/tools.py`）12 个 `@mcp.tool()` 用 FastMCP 的 inputSchema（Pydantic 推导），三 scope（read/dispatch/converge，`auth.py:41-44`），经 `McpAuthMiddleware`（`auth.py:150`）鉴权挂 `McpAuthContext` 到 `request.state.mcp_auth`。daemon 内置 MCP（`mcp-server.ts`）5 tool 用 zod schema，经 `X-API-Key` 转发到 backend REST endpoint（非走 /mcp）。

#### 3.5.4 platform_sync envelope 契约

- 上行：`POST /changes/{name}/progress` body=裸 `serializeForSync` 六表 JSON（NG-6 透传不强类型校验）+ 3 个 `X-SillySpec-*` header（Base-Ts/Pushed-At/User）。响应 200 `{ok:true}`（`ProgressSyncOk`）/ 409 `{conflict:true, platform_progress, last_pushed_at}`（`ConflictResponse`，`schema.py:21`）。
- base_ts **ISO 8601 UTC 字符串字典序**比较（`service.py:82`，不转 datetime，§7）。
- 鉴权：`shpsync_` token（workspace 派生）/ `shk_live_` API key（全局 None）/ JWT 三分派（`auth.py:45`）。

#### 3.5.5 WS 消息契约

`daemon/protocol.py`（backend）与 `sillyhub-daemon/src/protocol.ts:21 MSG` **逐字镜像**（R-05 必须同步）。消息类型：`TASK_AVAILABLE`/`HEARTBEAT`/`HEARTBEAT_ACK`/`LEASE_CLAIM/START/COMPLETE`/`LEASE_MESSAGES`/`RPC`/`RPC_RESULT`/`SESSION_INJECT/INTERRUPT/END/RESUME`/`PERMISSION_REQUEST/RESPONSE`/`SELF_UPDATE`/`LEASE_CANCEL`/`PROVIDER_CONFIG_CHANGED`。路径常量 `WS_PATH=/api/daemon/ws`（`:332`）/ `REST_PREFIX=/api/daemon`（`:339`）。tool_kind 分类（`agent/tool_kind.py:55 classify_tool_kind`）与 daemon `tool-kind.ts` 镜像同步（R-05）。

---

## 4. TA 技术架构（在什么上做）

> 事实源约定：以仓库源码为唯一事实源，凡论断均带 `文件:行号` 依据。

### 4.1 运行时

SillyHub 是三进程异构栈：后端 Python（FastAPI）、前端 Node（Next.js）、远程执行器 Node（daemon），外加 LiteLLM 网关（Python）。各运行时版本下限如下：

| 运行时 | 版本下限 | 依据 |
|---|---|---|
| Python | **≥ 3.12** | `backend/pyproject.toml:5` `requires-python = ">=3.12"`；mypy 锁 `python_version = "3.12"`（`pyproject.toml:76`）；容器基础镜像 `python:${PYTHON_VERSION}-slim`，`ARG PYTHON_VERSION=3.12`（`backend/Dockerfile:5,19,44`） |
| Node（前端） | **≥ 20.0.0** | `frontend/package.json:62` `engines.node ">=20.0.0"`；CI `setup-node node-version: 20`（`.github/workflows/frontend-ci.yml:33`）；包管理器 `pnpm@9.6.0`（`package.json:64`） |
| Node（daemon） | **≥ 20.0.0** | `sillyhub-daemon/package.json:24-26` `engines.node ">=20.0.0"`；**纯 ESM** `"type": "module"`（`package.json:6`）；构建工具链 `tsc` + `@vercel/ncc` 打包（`package.json:16,18,52`） |
| 后端容器内 Node 工具链 | 20（slim） | `backend/Dockerfile:6,11` `node:${NODE_VERSION}-slim AS node-tools`，用于在镜像内全局安装 Claude Code CLI + sillyspec |

关键框架版本：

| 框架/库 | 版本 | 依据 |
|---|---|---|
| FastAPI | ≥ 0.115 | `backend/pyproject.toml:8` |
| Uvicorn（ASGI） | ≥ 0.30（standard） | `pyproject.toml:9`；启动命令 `uvicorn app.main:app --host 0.0.0.0 --port 8000`（`deploy/docker-compose.yml:136`） |
| Pydantic | ≥ 2.8 + pydantic-settings ≥ 2.4 | `pyproject.toml:10-11`；配置全走 `BaseSettings`（`backend/app/core/config.py:42`） |
| Next.js | **14.2.5**（App Router） | `frontend/package.json:33` |
| React | 18.3.1 | `frontend/package.json:34-35` |
| TypeScript | 5.5.4（前端 + daemon 统一） | `frontend/package.json:58`、`sillyhub-daemon/package.json:54` |
| 包管理 | uv 0.4.18（后端）/ pnpm 9.6.0（前端 + daemon） | `backend/Dockerfile:29`、`backend-ci.yml:29`；`frontend/package.json:64`、`sillyhub-daemon/package.json:27` |

> 后端进程入口为 `app.main:app`（`backend/app/main.py:613` `app = create_app()`），`create_app()` 组装 30+ 个业务 router（`main.py:516-600`）并 `mount_mcp(app)` 挂载对外 MCP server（`main.py:608`）。lifespan 内完成日志/遥测初始化、RBAC 种子、孤儿 gate 任务对账、对象存储单例初始化（`main.py:77-160`）。

### 4.2 数据库与缓存

**主库 = PostgreSQL 16**，异步驱动 asyncpg，ORM 用 SQLModel + SQLAlchemy 2.0 异步栈：

| 组件 | 事实 | 依据 |
|---|---|---|
| 数据库引擎 | PostgreSQL 16-alpine | `deploy/docker-compose.yml:7`；dev 同（`docker-compose.dev.yml:7`） |
| 连接串形态 | `postgresql+asyncpg://...` | `docker-compose.yml:102`；`config.py:52-55` `database_url` 字段示例 |
| 异步驱动 | asyncpg ≥ 0.29 | `pyproject.toml:14` |
| ORM | SQLModel ≥ 0.0.22 + SQLAlchemy[asyncio] ≥ 2.0 | `pyproject.toml:12-13`；引擎经 `create_async_engine`（`backend/app/core/db.py:72`）、会话经 `async_sessionmaker`（`db.py:91`） |
| 迁移 | Alembic ≥ 1.13 | `pyproject.toml:15`；容器启动强制 `alembic upgrade head`（`docker-compose.yml:136`） |
| 测试替身 | aiosqlite（in-memory SQLite） | `pyproject.toml:53`；`db.py:56` 按方言分支——仅 `postgresql*` 才下发 `server_settings`，SQLite 忽略 |

**连接池与会话级超时**（`backend/app/core/db.py`）面向多 agent 负载调优：

| 参数 | 值 | 依据 |
|---|---|---|
| pool_size / max_overflow / timeout | 20 / 30 / 30s | `db.py:31-33` |
| pool_recycle | 300s（快速回收泄漏/陈旧连接） | `db.py:34` |
| pool_pre_ping | True | `db.py:78` |
| statement_timeout | 30s（单语句上限） | `db.py:39`，经 asyncpg `server_settings` 下发（`db.py:57-63`） |
| idle_in_transaction_session_timeout | 120s（放宽自 10s，覆盖长事务内 await 外部调用） | `db.py:45` |
| lock_timeout | 5s（拿锁 fail-fast） | `db.py:46` |

**缓存 = Redis 7**，全异步单例（`backend/app/core/redis.py`）：

- 引擎 `redis:7-alpine` + appendonly 持久化（`docker-compose.yml:25,27`）；驱动 `redis>=5.0` 的 `redis.asyncio.Redis`（`pyproject.toml:16`；`redis.py:9`）。
- 进程级单例 + 自管连接池（`redis.py:16-32`），`socket_timeout=3` / `socket_connect_timeout=3` / `health_check_interval=30`（`redis.py:29-31`）——防止 publish/健康检查卡死间接长持 DB 连接。
- Redis 在本平台承担多类热数据缓存（见 `config.py` 字段注释）：API key 认证正/负缓存（`config.py:107,117`）、RBAC 权限缓存（`config.py:149`）、登录限流计数（`config.py:128`）、权限缓存熔断器（`config.py:159,168`）。

**对象存储 = MinIO（S3 兼容）**：

- `minio/minio`（`docker-compose.yml:37`），异步客户端 `aiobotocore>=3.8,<4`（`pyproject.toml:29`）；`storage_backend` 默认 `minio`，端点 `http://minio:9000`（`config.py:247,251`）。

**LiteLLM 网关（Anthropic↔OpenAI 转换）**：

- 独立服务 `ghcr.io/berriai/litellm:v1.95.0`（`docker-compose.yml:192`，pin 版本，禁滚动 tag）+ 独立 store DB `litellm-db`（postgres:16，`docker-compose.yml:161-165`，与主库隔离避 alembic_version 冲突）。
- 平台代码不实现协议转换，外包给 LiteLLM（`config.py:276-280` `litellm_base_url` 默认 `http://litellm:4000`）；openai 供应商 set-default 时后端经 admin API 动态注册 `model_name=usr-<uid>-<pid>`（`litellm-config.yaml:15` `model_list: []` 起步为空 + `drop_params: true`）。
- master key 走 env 不进配置文件/镜像（`litellm-config.yaml:9`；`docker-compose.yml:202` `LITELLM_MASTER_KEY:?must set`）。

### 4.3 隔离架构

平台在三层维度上做隔离，自上而下递进：

**① workspace 隔离（业务顶层边界）**

`workspaces` 是多数业务表的外键根。RBAC 权限强制在 `{workspace_id}` 路径参数内判定（`backend/app/core/auth_deps.py:86-107` `require_permission` 把 `workspace_id` 作为鉴权维度）。派发队列、文件中心、变更代写等均带 `workspace_id`（如 `worktree/model.py:26`、`daemon/model.py:420`）。

**② daemon 远程运行时隔离（机器 + 用户 + provider 三维）**

远程执行器是两层实体表（`backend/app/modules/daemon/model.py`）：

| 实体 | 粒度 | 关键字段 / 依据 |
|---|---|---|
| `DaemonInstance` | 一行 = 一个用户在一台机器上、连某一后端的守护进程 | 主键 `id` = daemon 上报的 `daemon_local_id`（**后端不自生成**，`model.py:38-41`）；复合索引 `(user_id, server_url, hostname)`（`model.py:35`）；机器级沙箱 `allowed_roots` 默认 `~/.sillyhub`（`model.py:76-79`）；记录 os/arch/version/build_id（`model.py:56-74`） |
| `DaemonRuntime` | 一行 = 某 daemon 实体下的一种 provider（如 Claude Code / Codex） | FK `daemon_instance_id`（`model.py:142-149`）；**per-runtime 沙箱** `allowed_roots`（`model.py:171`，CC/Hermes 互不影响） |
| `DaemonTaskLease` | 任务租约，按 `runtime_id` 认领 | FK `runtime_id`（`model.py:323`）；复合索引 `(runtime_id, status, created_at)` 覆盖 daemon 高频轮询热路径（`model.py:311-316`） |

防劫持：同一 `daemon_local_id` 已归属另一用户时注册 → 403（`backend/app/modules/daemon/runtime/service.py:42-52` `DaemonInstanceOwnershipMismatch`）。即 daemon 身份由本地 uuid 承载，跨用户伪造即拒。

**③ SillySpec git worktree 隔离（并发改动物理隔离）**

平台用 `WorktreeLease` 表（`backend/app/modules/worktree/model.py:17`）登记每个 agent task 的独立 git worktree：

- 多维 FK 隔离：`workspace_id` / `component_id` / `change_id` / `task_id` / `user_id`（`model.py:26-60`），一行 = 一次隔离执行。
- `path` 唯一（`model.py:68-70`）、`branch_name`（`model.py:71`）、`status` locked/released + `expires_at` 过期（`model.py:75,88`）。
- 索引 `ix_worktree_active(task_id, status)`（`model.py:93`）防止同一 task 并发重复租约。

底层由 SillySpec CLI 的 worktree 机制承担（每个 change 在独立工作区 + 分支 `sillyspec/<change>` 上工作，多 agent 并发改动物理隔离；详见 SillySpec 自身 4A 总纲 §4.3）。平台通过 `WORKTREE_BASE_DIR`（容器内 `/data/sillyspec-workspaces`，`docker-compose.yml:121`）托管这些工作区树，并以 `spec_transport=tar` 模式（`config.py:216`，backend 为真理源，daemon pull 缓存）把 spec 文档同步到远程 daemon。

### 4.4 跨平台（Win/Linux/macOS）

代码须兼容三平台（项目规则 13），关键处理点：

| 维度 | 处理方式 | 依据 |
|---|---|---|
| 平台相关默认路径 | `sys.platform == "win32"` 三分支：`worktree_base_dir`（win32→`C:/data/sillyspec-workspaces`，else→`/data/...`）、`spec_data_root`、`spec_data_host_dir` | `config.py:182-189,192-196,202-206` |
| daemon 跨平台二进制 | pnpm `overrides` 把 `@anthropic-ai/claude-agent-sdk` 的 **6 个平台三元组**（win32/linux/darwin × x64/arm64，含 linux-x64-musl / linux-arm64-musl）统一解析到同一 SDK 版本 | `sillyhub-daemon/package.json:36-46` |
| 容器内路径重写 | `host_path_prefix` ↔ `container_path_prefix` 把宿主机风格路径重写为容器挂载路径 | `config.py:301-310`；compose 卷 `${HOST_PROJECTS_DIR:-C:/Users/qinyi/IdeaProjects}:/host-projects`（`docker-compose.yml:90`） |
| spec 目录宿主/容器共享 | bind mount 让宿主 daemon 与 backend 容器共享同一物理目录 | `docker-compose.yml:96` `${SPEC_DATA_HOST_DIR:-C:/data/spec-workspaces}:/data/spec-workspaces` |
| 国内构建兼容 | Dockerfile 用 npmmirror（`Dockerfile:16`）+ 清华 PyPI 镜像（`Dockerfile:25-26`），规避海外网络抖动 |
| Python 路径处理 | `pathlib.Path` + `resolve_spec_data_root`（`config.py:224-230`）相对仓库根解析 |

### 4.5 依赖栈

**后端（`backend/pyproject.toml`）**——均为运行时依赖：

| 依赖 | 用途 | 依据 |
|---|---|---|
| `fastapi>=0.115` / `uvicorn[standard]>=0.30` | ASGI 框架 + 服务器 | `pyproject.toml:8-9` |
| `pydantic>=2.8` / `pydantic-settings>=2.4` | 数据校验 + 配置加载（`BaseSettings`） | `pyproject.toml:10-11` |
| `sqlmodel>=0.0.22` / `sqlalchemy[asyncio]>=2.0` / `asyncpg>=0.29` | ORM + 异步 PG 驱动 | `pyproject.toml:12-14` |
| `alembic>=1.13` | 数据库迁移 | `pyproject.toml:15` |
| `redis>=5.0` | 异步缓存/发布订阅 | `pyproject.toml:16` |
| `structlog>=24.4` | 结构化日志 | `pyproject.toml:17` |
| `python-jose[cryptography]>=3.3` / `passlib[bcrypt]>=1.7` / `pynacl>=1.5` | JWT 签发/校验 + 密码哈希 + libsodium 对称加密 | `pyproject.toml:18-20` |
| `httpx>=0.27` | 异步 HTTP 客户端（出站调用） | `pyproject.toml:21` |
| `python-frontmatter>=1.1` | 解析 spec 文档 frontmatter | `pyproject.toml:22` |
| `openpyxl>=3.1` / `Pillow>=10` | PPM Excel 读写 + 图像处理 | `pyproject.toml:23-25` |
| `aiobotocore>=3.8,<4` | S3 兼容对象存储异步客户端 | `pyproject.toml:29` |
| `mcp>=1.29,<2` | 对外 MCP server（FastMCP，锁 v1 线避 v2 breaking） | `pyproject.toml:34` |
| `psutil>=5.9` / `python-multipart>=0.0.9` | 进程/系统指标 + 表单解析 | `pyproject.toml:26-27` |

> dev 组：`pytest` + `pytest-asyncio` + `pytest-xdist`（并行 `-n auto`）+ `pytest-rerunfailures`（CI flaky 兜底）+ `ruff` + `mypy` + `aiosqlite`（测试 DB 替身）（`pyproject.toml:38-54`）。

**前端（`frontend/package.json`）**：

| 依赖 | 用途 |
|---|---|
| `next@14.2.5` / `react@18.3.1` | App Router 框架 + 视图层 |
| `antd@^6.4.4` / `@ant-design/*` | 组件库 + 图标 + Next.js registry |
| `@tanstack/react-query@^5.51` | 服务端状态/数据获取 |
| `@xyflow/react@^12.10` / `echarts` + `echarts-for-react` | 流程图 / 图表可视化 |
| `zustand@^4.5` / `zod@^3.23` | 客户端状态 + schema 校验 |
| `tailwindcss` + `tailwindcss-animate` + `class-variance-authority` + `clsx` + `tailwind-merge` | 原子 CSS + 样式系统 |
| `@radix-ui/*`（dialog/dropdown-menu/avatar） | 无样式交互原语 |
| `dayjs` / `@uiw/react-markdown-preview` | 时间 / Markdown 渲染 |
| dev：`vitest` + `@testing-library/react` + `jsdom` + `openapi-typescript`（后端 OpenAPI→TS 类型生成）+ `playwright`/`puppeteer`（E2E） | `package.json:41-60` |

**daemon（`sillyhub-daemon/package.json`）**：

| 依赖 | 用途 |
|---|---|
| `@anthropic-ai/claude-agent-sdk@0.3.181` | Claude Code agent SDK（驱动 agent 执行） |
| `@modelcontextprotocol/sdk@^1.29.0` | MCP 客户端/服务端 |
| `ws@^8.18.0` | 与 backend 的 WebSocket 长连接（lease polling / RPC） |
| `commander@^12.1.0` | CLI 参数解析 |
| `js-yaml@^4.1.0` | 解析/写 local.yaml |
| `zod@^4.4.3` | 运行时 schema 校验 |

### 4.6 部署与门禁

**Docker Compose 编排**（`deploy/docker-compose.yml`）共 **7 个服务**：

| 服务 | 镜像 / 构建 | 角色 | 依据 |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 主库 | `docker-compose.yml:6-22` |
| `redis` | redis:7-alpine | 缓存 | `docker-compose.yml:24-35` |
| `minio` | minio/minio | 对象存储（S3 兼容） | `docker-compose.yml:37-54` |
| `backend` | `multi-agent-platform-backend:latest`（多阶段构建） | FastAPI API + 对外 MCP server | `docker-compose.yml:56-137` |
| `frontend` | `multi-agent-platform-frontend:latest` | Next.js SSR | `docker-compose.yml:139-159` |
| `litellm-db` | postgres:16-alpine | LiteLLM 独立 store DB | `docker-compose.yml:161-178` |
| `litellm` | `ghcr.io/berriai/litellm:v1.95.0` | Anthropic↔OpenAI 转换网关 | `docker-compose.yml:180-230` |

启动约束：backend `depends_on` postgres/redis/minio 均 `service_healthy`（`docker-compose.yml:80-86`）；command 为 `alembic upgrade head && exec uvicorn ... --ws-max-size 104857600`（`docker-compose.yml:136`，100MB WS 帧上限兜底 spec import）。内存上限：backend 800m / frontend 400m / litellm 1g（允许 prisma 迁移尖峰）/ postgres 256m / redis 128m / minio 256m。

网络隔离：LiteLLM **不暴露 ports**，仅 default network 内 `litellm:4000` 可达（`docker-compose.yml:223`）；backend 不 `depends_on` litellm，其宕机不拖垮 anthropic 链路（故障域隔离，`docker-compose.yml:225`）。

**阿里云部署**：服务器不现场构建，改用镜像 save/load——`deploy/scripts/build-and-save.sh` 本地构建打包，`load-and-up.sh` 远程加载启动（`docker-compose.yml:57-58` 注释）。

**dev 编排**（`deploy/docker-compose.dev.yml`）：只起 postgres/redis/minio/litellm-db/litellm 五个基础设施，backend/frontend 在宿主以 `--reload` / `next dev` 跑以加快迭代（`docker-compose.dev.yml:2-3`）。

**门禁分四道**：

| 门禁 | 触发 | 内容 | 依据 |
|---|---|---|---|
| pre-commit | `git commit`（backend） | `ruff format` + `ruff check --fix`（`uv run`，python3.12） | `backend/.pre-commit-config.yaml:1-19` |
| backend-ci | push/PR 触及 `backend/**` | ruff check + ruff format check + mypy app + pytest `-n auto --cov-fail-under=60 --reruns 2 --reruns-delay 1`（Python 3.12 / uv 0.4.18 / postgres_test / redis[15]） | `.github/workflows/backend-ci.yml:37-56` |
| frontend-ci | push/PR 触及 `frontend/**` | pnpm lint + typecheck + test + build（Node 20 / pnpm 9.6.0 / frozen-lockfile） | `.github/workflows/frontend-ci.yml:36-51` |
| scan-drift | PR 触及 `.sillyspec/docs/**` 等 | scan 文档漂移检测，**warn-only 不阻断**（exit 0 + GitHub warning 注解 + 去重 PR 评论） | `.github/workflows/scan-drift.yml:1-5,40-44` |

**安全架构（凭据/认证/审计/SSRF）**：

| 域 | 机制 | 依据 |
|---|---|---|
| 凭据加密 | libsodium `secretbox`（xchacha20-poly1305）对称加密；KEK 从 `SILLYSPEC_MASTER_KEY` env（`<key_id>:<hex 32B>` 格式），版本化支持 key rotation；compose 强制 `SILLYSPEC_MASTER_KEY:?must set` | `backend/app/core/crypto.py:1,31-55,58-78`；`docker-compose.yml:120` |
| 认证 | **双路径** `get_current_principal`：JWT（`Authorization: Bearer`）优先，回落 API key（`X-API-Key`）；workspace 级 RBAC（`require_permission`）+ 平台管理员（`require_platform_admin`） | `backend/app/core/auth_deps.py:140-171,86-137` |
| 登录防护 | 弱口令黑名单（bootstrap 阶段 fail-fast）+ 登录限流（5 次/分钟/IP）+ 连续失败 3 次触发滑块验证码 + bcrypt rounds 12 | `config.py:24-39,128-147,96` |
| 审计 | SQLAlchemy `after_insert/update/delete` 事件钩子，自动写 `AuditLog`；actor 从 Bearer token 解码注入 `session.info["audit_context"]`；排除 `audit_logs` 表防递归 | `backend/app/core/audit_hooks.py:25,182-282,290-327`；`db.py:116-151` |
| SSRF | 统一 façade `assert_public_url`（scheme 白名单 + host 解析到公网，IPv4+IPv6，每次重解析防 DNS 重绑定）+ `assert_safe_repo_url`（git URL 白名单，拒 `ext::`/`file://`/Windows 盘符）；覆盖 mcp webhook / worktree git clone / http_get 三入口 | `backend/app/core/ssrf.py:34-53,56-106` |
| API key 性能/安全 | 认证正/负缓存（命中跳过 bcrypt O(n) 扫描）+ last_used_at 写入节流（防行锁串行化雪崩） | `config.py:97-126` |
| 必填密钥 | compose 用 `:?must set` 语法强制 `SECRET_KEY` / `SILLYSPEC_MASTER_KEY` / `LITELLM_MASTER_KEY` 三密钥必填，缺即拒启动 | `docker-compose.yml:104,120,202` |

---

## 5. 驱动链路（自上而下驱动 / 自下而上支撑）

```
战略：企业用 AI Agent 规范化、可治理地开发与编排代码，人类在关键点审批
  │
  ▼ 驱动（需要哪些能力）
BA  40+ router/5 域 · 变更托管 + Agent 编排双主线 · RBAC + 多 workspace 隔离 · 审批/审计/incident
  │
  ▼ 驱动（每能力依赖什么状态/产物）
DA  PG 77 表/11 域 · spec 文档资产（四件套+scan） · platform_sync 缝合 CLI 进度 · 凭证加密/SSRF/权限缓存
  │
  ▼ 指导（能力由哪些模块实现）
AA  backend core+30 模块（编排治理） · daemon 6 层（执行体） · Agent 编排引擎 · 两套 MCP · LiteLLM
  │
  ▼ 支撑
TA  Python3.12/Node20 · PG16/Redis7/MinIO · Docker Compose 7 服务 · git worktree 隔离 · 四道门禁 · 安全架构
```

自下而上也成立：**TA 的 daemon + worktree** 撑起 **AA 的 Agent 执行与隔离**，**AA 的编排引擎** 撑起 **DA 的进度回灌与收敛**，**DA 的进度库 + spec 资产** 让 **BA 的变更托管主线能“记住每个 change 在哪一步”**——抽掉 daemon 执行体或 worktree 隔离，整条“AI 按流程把代码做对”的业务链就退化成口头约定。

---

## 6. 概念对照（4A 术语 → SillyHub 实例）

| 4A 术语 | SillyHub 实例 |
|---|---|
| 业务能力地图 | `backend/app/main.py:175 create_app` 注册的 40+ router（§1.1.1） |
| 业务流程（端到端） | 变更托管主线 brainstorm→plan→execute→verify→archive + Agent 编排主线 mission 派发收敛 |
| 业务-IT 对齐 | spec 文档资产（意图）↔ daemon 落盘代码（实现）经 platform_sync 对账 |
| 主数据（黄金记录） | PG `changes` / `agent_runs` / `daemon_task_leases` / `workspaces` 行 |
| 数据治理 | 凭证加密（crypto）/ SSRF / 权限缓存熔断 / DB 池调优 / 软删 partial index |
| 数据资产 | spec 四件套 + scan 文档 + module-map + QUICKLOG |
| 应用 / 功能模块 | backend `modules/` 30 个业务域（router/service/model/schema 四件套） |
| 应用集成 | daemon↔backend WS/REST + 两套 MCP + platform_sync + LiteLLM + SillySpec CLI |
| 服务化 / 能力中心 | Agent 编排引擎（orchestrator/coordinator/borrow/converge/control） |
| 接口契约 | OpenAPI→api-types.ts（强契约）/ MCP schema / platform_sync envelope / WS 镜像协议 |
| 基础设施 | Docker Compose 7 服务（PG/Redis/MinIO/backend/frontend/litellm-db/litellm） |
| 安全架构 | 凭据加密 + RBAC + SSRF + 审计 + worktree fail-closed + 三密钥必填 |
| 避免“技术债” | 源阶段完成度前置校验（不干活不能推进）+ archive 6 项归档门 |
| 消除“信息孤岛” | platform_sync 把 CLI 进度落库 + spec 文档资产入表，平台与 CLI 不脱节 |
| TOGAF / ADM | dogfood：平台自己用 SillySpec 流程开发自己（`.sillyspec/` 即架构资产库） |
| 中台（能力沉淀） | daemon 6 层（执行韧性/策略/通信）+ backend core 横切层（鉴权/审计/安全/可观测） |

---

## 7. 关键设计特征

1. **平台只编排不执行**（`backend/app/modules/agent/adapters/` 空目录 + `base.py:129 AgentAdapter(ABC)` 无具体子类）——backend 不在进程内跑 agent，所有执行走 daemon lease + subprocess（`placement.py` + daemon `task-runner.ts`）。平台职责是编排、治理、收敛，不是执行。平台进程与 agent 执行隔离，故障域分离。
2. **双主线在 execute 交汇**——变更托管主线（SillySpec brainstorm→...→archive 的平台化托管）与 Agent 编排主线（mission 派发→daemon 执行→收敛）在 execute 阶段汇合：change 的每个 stage 派发即是一次 mission/agent run。两条主线共享同一套 daemon lease + worktree 隔离基础设施。
3. **代码即真相，文档是契约**——spec 文档资产（design/plan/tasks/scan）是意图契约，daemon 落盘的代码是真相，二者经 platform_sync + module-impact 对账，不两张皮。这是平台区别于“图/模型驱动”平台（图为主、代码为生成物、易脱节）的根本立场：4A 的“业务-IT 对齐”靠对账机制保证，而不是靠架构图与实现各自维护。
4. **三重隔离**——workspace（业务顶层边界，多数表外键根）+ per-(workspace,user) daemon binding（成员各自配 daemon，可借用）+ git worktree（每 worker/每 change 物理隔离并发改动，`ws.root_path/.worktrees/<run.id>/`）。RBAC 在 workspace 维度判定，platform_admin 短路。
5. **两套 MCP 物理隔离**——对外 MCP（`mcp_gateway`，12 tool，第三方经 `shmcp_` token）与 daemon 内置 MCP（注入主 agent，5 tool，`X-API-Key` 转发）职责不同、鉴权隔离，只在 team 编排 5 个工具上重叠。
6. **current_stage 双轨**——落库字段（transition/CLI 回灌写）+ 只读投影（读时 join platform_change_progress 用 CLI 上行值覆盖显示）。平台不自动推进状态机（形态 A 砍 auto_dispatch，按需显式触发）；落库值与投影值可能短暂不一致，是有意设计。
7. **韧性下沉到 daemon**——三循环（heartbeat/poll/ws）+ WS 主推 + REST 生命周期 + 轮询兜底；网络重试编排 + 文件 outbox 溢出 + 运行时锁（一机一人一 provider）。backend 侧重试/幂等/乐观锁/收敛原子抢占（R5）。

---

## 8. 已知文档漂移点

落盘时以源码为准校正，列出供后续同步。**2026-08-14 状态更新**：9 个漂移点中 8 个已修复（#1/#2/#3 随审计体系补全 change `503655a0`；#5/#6/#8 随注释/登记清理 quick `b3c15f5b`；#7 死代码随同 quick 删除；#9 注释早已自行修正）。仅 #4（approvals stub）待澄清。

| 漂移点 | 旧文档/注释措辞 | 源码事实（当前） | 状态 / 依据 |
|---|---|---|---|
| 自动审计钩子未挂载 | `core/audit_hooks.py:290 register_audit_hooks` 设计为自动审计所有表变更 | **已修复**：production `main.py` lifespan 现挂载 `register_audit_hooks(get_engine())`（77 表注册+幂等） | ✅ 2026-08-14 audit change `503655a0` |
| 登录不入审计表 | 审计应覆盖登录 | **已修复**：login 成功/失败/禁登三分支手工 AuditLog（占位 UUID + reason） | ✅ 2026-08-14 audit change `503655a0` |
| settings 无审计 | PlatformSetting 变更应审计 | **已修复**：settings router 两条写路径 per-key 手工审计（CREATE/UPDATE） | ✅ 2026-08-14 audit change `503655a0` |
| approvals 是 stub | `tool_gateway` approvals 能力 | 4 端点仍为 V1 stub 返空（未动） | ⏳ 待澄清：产品意图未定（用则补实现，不用则标 deprecated） |
| MCP tool 数量注释过时 | `mcp_gateway/server.py` 注释称“8 个 tool” | **已修复**：三处注释改 12（以 `tools.py` 实际为准） | ✅ 2026-08-14 quick `b3c15f5b` |
| adapters 空目录 | `agent/adapters/` 应有 adapter 实现 | **已修复**：`__init__.py` 补 docstring 说明“故意空，backend 不在进程内执行 agent，执行走 daemon lease/subprocess” | ✅ 2026-08-14 quick `b3c15f5b` |
| start_sillyspec_run 已弃用 | `agent/service.py:473` | **已删除**：deprecated 簇（start_sillyspec_run + _short_db + _run_sillyspec_background + helper）整体移除，零生产 caller | ✅ 2026-08-14 quick `b3c15f5b` |
| env.py model 登记不全 | autogenerate 应覆盖全部表 | **已修复**：补登记 8 类较新模块 model（admin/agent.profile/daemon.audit/file/mcp_gateway/ppm.kanban/skills/workspace.member_runtimes） | ✅ 2026-08-14 quick `b3c15f5b` |
| daemon tool_config 强制 | `execution.py` 注释曾称 daemon“不强制 tool_config” | **已修复**：注释早已自行修正为 live 强制（`--allowedTools`/`--permission-mode`） | ✅ 无需改动（spike-B 已证） |




