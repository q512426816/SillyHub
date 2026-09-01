# SillyHub 项目分析报告

> 分析基线：主仓 `b38b922a`（2026-09-01，分析在其 worktree 快照中进行）。
> 方法：只读分析——通读 `README.md`、`.sillyspec/docs/SillyHub/scan/`（ARCHITECTURE / STRUCTURE 等 8 篇）、`flows/` 9 篇流程文档、`modules/` 模块文档，结合 `git ls-files` / `grep` / `wc -l` 对源码实测统计。所有数字均可由文末「统计口径」中的命令复现。

---

## 1. 项目定位与核心功能

**SillyHub 是一个多智能体协作管理平台**（全栈私有项目，License: Private），一句话定位：**把规范驱动开发（SillySpec）从单人命令行工具升级成团队级协作平台，让 AI Agent 真正在团队里落地写代码。**

它解决的核心问题：AI Agent 写代码"黑箱化"、不可追溯、多 Agent / 多人协作无序。SillyHub 的答案是——变更规格驱动（需求 → 设计 → 计划 → 执行 → 验收 → 归档），每一步有结构化文档与评审门禁；Agent 写的每一行代码有规可循、有迹可查、有人把关。

面向用户：使用 AI Agent（Claude Code / Codex 等）进行软件开发的**团队/组织**——多用户、多项目、多工作空间，RBAC 权限 + Git 凭据网关隔离。

核心能力清单（摘自 README 并经代码印证）：

| 能力 | 说明 |
|---|---|
| 工作空间管理 | 注册 Git 仓库为工作空间，自动扫描规范目录，组件拓扑可视化 |
| 变更全生命周期 | brainstorm → plan → execute → verify → archive，状态机 + 阶段评审门禁（四类人工审核面板） |
| AI Agent 编排 | 实时流式执行、中断恢复、上下文指纹、双层审批（工具级 + 阶段级）、多 worker 团队 mission |
| 多 Provider 适配 | 12 种宿主 Agent（claude/codex/copilot/opencode/hermes/gemini/pi/cursor/kimi/kiro/antigravity/openclaw），新增只加驱动不动控制面 |
| Git Worktree 隔离 | 每个变更在独立 worktree 执行，并行不冲突 |
| 文件中心 | MinIO/S3 兼容对象存储，上传/下载/流式分发 |
| LLM 提供商管理 | 多供应商切换，统一经 LiteLLM 网关出口 |
| PPM 项目计划管理 | 项目/计划节点/任务执行/问题清单/看板，完整项目交付域（已上线的模块） |
| 知识库·事件·发布 | 经验沉淀、线上事件复盘、发布审批工作流 |

项目特色是"**吃自己的狗粮**"：SillyHub 自身就用 SillySpec 规范驱动开发，`.sillyspec/` 目录沉淀了全部变更规格（4809 个文件、约 39 万行 Markdown），项目演进本身就是方法论的活样本。

---

## 2. 整体架构

三端 + 一套基础设施。**backend 是唯一持久化与鉴权中心；daemon 是本机执行边缘节点（无独立 HTTP 服务）；frontend 是 BFF + 渲染层；LLM 出口统一收敛到 LiteLLM 网关。**

```
 浏览器(桌面/移动 m/)
    │ HTTP /api/* + SSE
    ▼
 frontend  Next.js 14 (:3000)
    │  ├ app/api/* Route Handlers：三条 SSE stream 中继
    │  │   (daemon/sessions、daemon-chat、agent/runs)
    │  └ REST/SSE 转发
    ▼
 backend  FastAPI (:8000) ── PostgreSQL 16 (alembic, ~104 表)
    │        │                 Redis 7 (缓存 + pub/sub + 日志扇出)
    │        │                 MinIO (S3 兼容, 文件中心)
    │        └───────────────▶ LiteLLM 网关 (:4000, pin v1.95.0) ──▶ LLM 上游
    │                              (openai_chat 类代理; master key 不出 backend)
    │
    │◄══ WebSocket 主动拨号 /ws (ws-max-size 100MB) ════════════╗
    │                                                            ║
 sillyhub-daemon (Node ≥20, 开发者本机)                          ║
    ├ hub-client.ts：REST 调 backend (Bearer / X-API-Key)        ║
    ├ TaskRunner：claim lease → spawn Claude Agent SDK           ║
    │     └──▶ Claude Code / Codex 等 12 种宿主 Agent            ║
    ├ 内置 stdio MCP server (5 tools) ──▶ backend mcp_tools      ║
    └ 读写宿主文件系统 / .sillyspec 文档 / skills                 ║
              (Runtime Policy 引擎 + worktree 隔离)              ║
    │                                                            ║
    └─ SillySpec CLI (agent 进程内) ──platform_sync REST──▶ backend
          (shpsync_ workspace token：回传 progress/documents/
           approval/quicklog；spec 文件增量 ops / 整树 bundle)

 外部 MCP client (Claude Code 等) ──/mcp 网关 (shmcp_ token)──▶ backend
          (12 个 MCP 工具：派 worker / 推进变更阶段 / SSE 事件流)
```

**通信方式与数据流要点**：

- **鉴权四轨**：JWT 会话（浏览器）/ `X-API-Key`（daemon 长期 key）/ `shpsync_` 前缀 token（CLI ↔ 平台同步，写通道仅接受它）/ `shmcp_` McpToken（外部 MCP 编排入口）。
- **实时双通道**：WS（daemon ↔ backend `/ws`，双向消息 + lease 轮询领任务）+ SSE 三路（快捷聊天流、MCP EventSource worker 事件流、前端经 Next.js Route Handler 中继的 run 流）。
- **单一 API 真相**：前后端与 daemon 的类型均由 backend OpenAPI 生成（`pnpm gen:types` → `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts`，各约 4 万行），CI 用 `gen:types:check` 卡漂移。
- **远端写盘通道**：daemon-client 唯一模式下 backend 无可达文件系统，写盘任务（建变更目录、编辑文档、spec 回灌）经 `daemon_change_writes` 代写队列下发 daemon 执行并收回执。

---

## 3. 目录结构与模块划分

```
multi-agent-platform/
├── backend/            # FastAPI 后端（app/core 基础设施 + app/modules 34 个业务域 vertical slice）
├── frontend/           # Next.js 14（src/app · components · lib · stores · hooks）
├── sillyhub-daemon/    # 本地执行守护（task-runner · interactive · mcp · policy · resilience）
├── deploy/             # Docker Compose 编排（生产 7 服务 + dev 栈）
├── docs/               # 设计与审计文档（含多份平台审计/安全审计/架构分析报告）
├── scripts/            # 仓库级脚本（gen-api-types、scan-drift-check 等）
├── .github/            # CI（backend / frontend / daemon / e2e / scan-drift 5 条流水线）
├── .sillyspec/         # 规范驱动工作区：changes(含 archive 数百个变更规格) · docs(scan/modules/flows) · knowledge · quicklog
└── Makefile            # 统一开发入口（dev/backend/frontend/聚合 test、lint、up）
```

### backend（`backend/app/`）

- `core/`：基础设施——db / redis / config / logging(structlog) / errors / auth_deps(四轨鉴权依赖) / audit_hooks / security / crypto / **ssrf** / permission_cache / monitoring / telemetry / paths / spec_paths。
- `models/`：共享模型基座（`base.py`）。
- `modules/`：**34 个业务域**（实测目录数；scan 文档写 29，已滞后），每域典型结构 `router.py + service.py + model.py + schema.py + tests/`：

| 域分组 | 模块 |
|---|---|
| 认证/组织 | auth · admin · settings · notification |
| 工作空间 | workspace(members/member_runtimes) · runtime · explorer |
| 变更流/文档 | change · change_writer · task · scan_docs · spec_workspace · spec_profile · knowledge · skills · session_attachment · preview_office · git_log |
| Agent 编排 | agent(profile/ placement/ mcp_tools) · workflow · worktree |
| Daemon | daemon(dist 分发 · lease · run_sync · session · llm-proxy 透传) |
| 网关 | git_gateway · git_identity · tool_gateway(+policy) · mcp_gateway(FastMCP+SSE) · llm_provider(+LiteLLM client) · file · storage |
| 跨仓同步 | platform_sync（CLI ↔ 平台 10 个端点） |
| DevOps | incident · release · health |
| PPM 子域 | ppm/（project · plan · task · problem · kanban · workbench，统一前缀 /api/ppm） |

实测 **541 个路由端点**（`@router.*` 装饰器计数）、**177 个 alembic 迁移文件**。

### frontend（`frontend/src/`）

- `app/`：`(auth)/login`；`(dashboard)/` 顶层组（workspaces · admin · ppm · runtimes · sessions · settings · account · agent-profiles）；`(dashboard)/workspaces/[id]/` 工作空间内 **17 个子域**（agent · approvals · audit · changes · files · incidents · knowledge · mcp · mcp-tokens · members · missions · releases · runtime · scan-docs · sessions · skills · agent-profiles）；`m/` 移动端布局；`api/` 三条 SSE 中继 Route Handlers。
- `components/`：按域组织的组件（agent · changes · daemon · files · ppm · layout · charts …），代表组件 `session-panel.tsx`(5999 行)、`agent-run-panel.tsx`。
- `lib/`（api.ts + 生成的 api-types.ts + 各域 client）、`stores/`(Zustand)、`hooks/`、`styles/`(双主题 token，blue/ai-native)、`config/`、`test/`。

### sillyhub-daemon（`sillyhub-daemon/src/`）

| 模块组 | 职责 |
|---|---|
| 入口/生命周期 | cli.ts(commander：start/stop/status/logs) · daemon.ts(主循环+心跳) · ws-client.ts(WS 拨号，http↔ws 自动转换) · autostart/ |
| 任务执行 | task-runner.ts(claim lease 执行) · interactive/(交互式会话 driver) · terminal-launcher/observer · agent-detector · runtime-lock · spawn-env · preflight |
| 工具/RPC | mcp-server.ts + mcp-config.ts(内置 stdio MCP server，5 tool) · host-fs-handler · roots-rpc · file-rpc(宿主文件读写) · spec-sync(.sillyspec 回写) · skill-manager · permission-rules · tool-kind |
| 凭证 | credential.ts + credential-injector.ts(API key 注入，CLAUDE_CONFIG_DIR 隔离) · local-yaml-writer.ts |
| 适配/韧性 | adapters/(12 种宿主 Agent 驱动) · resilience/(重试+FileOutbox) · policy/(Runtime Policy 引擎) · model-error/ |
| 协议 | protocol.ts(WS 消息信封) · hub-client.ts(HTTP) · api-types.ts(OpenAPI 生成) |

---

## 4. 代码规模统计

统计口径：`git -c core.quotepath=false ls-files`（只统计 **git 跟踪文件**，node_modules / .venv / dist 等未跟踪目录天然排除）+ `xargs cat | wc -l`。基线 commit `b38b922a`。

### 按顶层目录（跟踪文件数）

| 目录 | 文件数 | 说明 |
|---|---|---|
| .sillyspec/ | 4809 | 规格文档工作区（5040 个 md 中的绝大部分） |
| backend/ | 1200 | Python 源码 + 177 迁移 + 配置 |
| frontend/ | 689 | Next.js 源码 |
| sillyhub-daemon/ | 338 | daemon 源码 + tests |
| .claude / .zcode / .codex | 198/195/23 | 各 Agent 宿主的技能/配置 |
| docs/ | 160 | 设计与审计文档 |
| deploy/ · scripts/ · .github/ | 9 · 4 · 5 | 编排、脚本、CI |

### 代码行数（按语言）

| 子系统 | 语言 | 生产代码 | 测试代码 | 备注 |
|---|---|---|---|---|
| backend/app | Python | **123,347 行** | **179,783 行**（554 个测试文件） | 测试行数 > 生产代码 |
| backend/migrations | Python | 177 个文件（未计行数） | — | alembic |
| frontend/src | TS/TSX | **≈119,280 行**（手写） | **78,339 行**（257 个测试文件） | 另有生成文件 api-types.ts 40,184 行 |
| sillyhub-daemon/src | TypeScript | **48,390 行**（手写） | —（src 内无测试） | 另有生成文件 api-types.ts 40,051 行 |
| sillyhub-daemon/tests | TypeScript | — | **82,556 行**（251 个文件） | |
| .sillyspec | Markdown | **391,307 行**（4809 个 md） | — | 规格文档资产 |

**合计**：三端手写生产代码 ≈ **29.1 万行**，测试代码 ≈ **34.1 万行**，规格文档 ≈ **39.1 万行**——三者体量同数量级，是这个项目最鲜明的形态特征。另有全仓约 130 个 html（原型/页面）、106 个 csv（多为数据/测试夹具）。

### 测试用例数（函数级计数）

| 端 | 计数方式 | 用例数 |
|---|---|---|
| backend | `def test_` / `async def test_` | **5,188** |
| frontend | vitest `it(`/`test(` | **2,983** |
| daemon | vitest `it(`/`test(` | **3,217** |
| 合计 | | **≈11,388** |

（backend CI 注释自述"套件已 5300+ 用例且持续增长"，与实测吻合。）

---

## 5. 核心领域模型

数据库 **104 张表**（`__tablename__` 计数；scan 文档 8 月中旬口径为 94，两周内在增长）。按域分组的主要实体与关系：

```
组织/多租户枢纽（FK 被引中心度：users 37 次、workspaces 36 次）
  User ─< UserRole >─ Role ─< RolePermission          (RBAC)
  User ─< UserOrganization >─ Organization
  User ─< UserWorkspaceRole >─ Workspace              (工作空间成员+角色)
  Workspace ─< WorkspaceMemberRuntime >─ DaemonRuntime (成员绑定哪台机器的哪个 runtime)
  User ─< ApiKey / Session (登录会话)

变更流（规范驱动核心）
  Workspace ─< Change ─< ChangeDocument / ChangeReview / ChangeEvent
                     ├─< Task ─< TaskWorkspace          (tasks/*.md frontmatter 落库)
                     ├─< ChangeSessionLink              (变更↔会话绑定)
                     ├─< SpecFileManifest               (spec 文件清单+删除墓碑)
                     ├─< PlatformChangeProgress         (CLI 进度回传投影)
                     └─< QuicklogEntry                  (quick 条目)
  SpecWorkspace / SpecConflict / ScanDocument (工作空间扫描)

Agent 编排
  AgentRun ─< AgentRunLog / AgentRunModelUsage / AgentRunWorkspace / AgentArtifact
  AgentMission ─< (worker) AgentRun                    (多 worker 团队)
  AgentSession ─< AgentSessionQueuedMessage / AgentSessionLog   (交互会话)
  AgentProfile (claude-agent-sdk 配置档案：模型/MCP/skills/凭证/allowed_roots)
  AgentRunDependency (run 间依赖)

Daemon 运行时
  DaemonInstance (物理安装) ─< DaemonRuntime (实例内 runtime)
  DaemonRuntime ─< DaemonRuntimeGrant (跨用户借用授权) / DaemonBorrowAudit
  DaemonTaskLease (claim/heartbeat/complete 租约) ←─ AgentRun/AgentSession
  DaemonChangeWrite (远端代写队列) / DaemonControlCommand

网关/审计
  GitIdentity / GitOperationLog · ToolPolicy / ToolOperationLog / PolicyAuditLog
  McpToken / McpWebhook · LlmProvider · File (元数据→MinIO 对象) / AuditLog

DevOps / PPM 子域(约 20 张)
  Release ─< ReleaseApproval · Incident ─< Postmortem
  PpmProjectMaintenance ─< PpmProjectMember/Stakeholder/Workspace · PlanNode
  ─< PlanNodeDetail · PpmProblemList ─< Process* · PpmKanban* · TaskExecute · WorkHour
```

**关系要点**：users 与 workspaces 是全库 FK 枢纽（多租户隔离强约束）；`AgentMission : AgentRun` 是 1:N（团队多 worker）；`DaemonInstance : DaemonRuntime` 拆两级（一台机器多个 runtime，runtime 再被 workspace 成员绑定）；变更进度走"CLI 回传投影"双轨（`platform_change_progress` 为权威、读时覆盖落库值）。

---

## 6. 关键业务流程

### 6.1 变更全生命周期（SillySpec 主线）

```
创建(会话驱动)：平台已无新建表单——用户在会话中让 agent 在宿主 .sillyspec/changes/<key>/ 落四件套
   → daemon spec-sync 增量推送 → platform_sync → spec_workspace.apply_ops 落盘(容器内)
   → 触发 change reparse(parser 解析入库、涉及文件反查模块 id)
进度同步：SillySpec CLI 每阶段推进 POST /changes/{name}/progress(shpsync_ token、base_ts 乐观锁)
   → 落 platform_change_progress → 变更中心读时 join 投影覆盖 current_stage
人工审核门：StageProjectionService 只读 sillyspec.db 投影四类面板
   (proposal_review / plan_review / human_test / archive_confirm) → 用户放行/打回
按需派发(形态A，auto_dispatch 已砍)：advance_stage(HTTP/MCP) → dispatch_next_step
   ├─ execute → _dispatch_execute_team 多 worker 并行(可选 GLM 兜底 mission)
   └─ verify → run_verify_gate：daemon 侧跑 sillyspec gate verify
归档：check_archive_gate 门槛 → 会话内 agent 执行 sillyspec archive → apply_ops 全量 reparse
```

失败兜底设计细致：FSM 非法迁移 409、同 change 并发派发单 run 保证、verify gate 失败 kickback 不自动归档、进度上行冲突返回平台侧 latest 不改数据、卡死 run 由 reconcile/cleanup 定时收敛。

### 6.2 AgentRun 派发与 daemon 执行（批量任务链路）

```
(前端/变更中心) POST /workspaces/{ws}/agent/runs 或 advance_stage/scan/init 派发入口
(backend agent) AgentService.start_*_dispatch
   ├─ profile 解析(run 显式 → workspace 默认 → 系统默认兜底)
   ├─ 需写盘 → worktree.acquire(WorktreeLease 隔离执行目录)
   ├─ 幂等：check_idempotency + AgentSpecBundle 指纹 compute/validate(支持断点续跑)
   └─ placement 选在线 daemon → 建 daemon_task_lease(pending)
(backend daemon) WS notify_task_available 唤醒 → lease/context 组装 claim payload
   └─ 供应商四级解析；openai_chat 类经 LiteLLM 代理(明文 key 不出 backend)
(daemon Node) claim(claim_token) → TaskRunner 执行
   ├─ credential-injector 注入凭证(CLAUDE_CONFIG_DIR 隔离)
   └─ 消息上行 resilience.submitWithRetry(退避重试→用尽入 FileOutbox→心跳恢复后 drain)
(backend) run_sync.submit_messages：segmentId 去重 + 原子条件 UPDATE 防覆盖终态
   → SSE /agent/runs/{id}/stream 转发前端
(daemon 完成 → lease complete) → _trigger_stage_completion_callback 驱动变更阶段收口
```

kill 统一走 `cancel_lease`：交互会话下发 SESSION_END，批量任务 LEASE_CANCEL WS 即时推送 + 心跳周期检测兜底（两通道幂等）。

### 6.3 daemon 代写队列（远端写盘通道）

backend 容器内无宿主文件系统可达，"远端写盘"任务与 agent-run 语义分离、独立成表 `daemon_change_writes`：

```
三类生产者：会话需远端建变更目录(proxy_create_change) / 变更文档在线编辑 / 「同步到服务器」spec 整树回灌
   → resolve_runtime_for_writeback 现算目标 runtime(成员 binding + online + 心跳新鲜)
   → DaemonChangeWrite outbox 行(pending)
   → daemon lease 轮询领取 → 宿主写盘 → progress/complete 回执
   → change_writer 占坑行与 reparse 并发对账，失败回滚
```

另有 **MCP Token 派发 Worker 流程**（`/mcp` 外部编排）：第三方编排者经 `shmcp_` token 连 FastMCP 网关，12 个 MCP 工具（派 worker / 读产出 / 列 worker / 收敛 / 推进变更阶段…）落到与平台侧同一条派发链路——本次团队分身机制（dispatch_worker / get_worker_result / converge）正是经此链路实现。

---

## 7. 部署与配置

### Docker Compose 拓扑（`deploy/docker-compose.yml`，7 服务）

| 服务 | 镜像 | 要点 |
|---|---|---|
| postgres | postgres:16-alpine | 127.0.0.1 绑定，256m，健康检查 |
| redis | redis:7-alpine | appendonly，128m |
| minio | minio/minio | 9000/9001 仅本机绑定，256m，文件中心 |
| backend | 本地构建 `multi-agent-platform-backend:latest` | **启动即 `alembic upgrade head`**；`--ws-max-size 100MB`（容纳 spec bundle RPC 单帧）；800m；additional_contexts 打包 daemon 分发物与 .claude/skills；bind mount 宿主项目目录（扫描）与 spec-workspaces（宿主 daemon 与容器共享 spec 物理目录） |
| frontend | 本地构建 | 400m，NEXT_PUBLIC_API_BASE_URL 注入 |
| litellm-db | postgres:16-alpine | LiteLLM 专属 DB（与项目 alembic_version 表隔离，故独立实例） |
| litellm | ghcr.io/berriai/litellm:**v1.95.0(硬 pin)** | 1g（首启 prisma 142 步迁移内存尖峰）；**不暴露端口**（master key 网络隔离）；backend 不 depends_on 它（故障域隔离） |

另 `deploy/docker-compose.dev.yml`（make dev-up：仅 PG+Redis）。部署走"本地 build → save/load 镜像"（服务器不现场构建）。

### 环境变量要点（compose 实测）

- **fail-fast 密钥族**（`:?must set`，未设直接拒启）：`SECRET_KEY`、`POSTGRES_PASSWORD`、`S3_ACCESS_KEY/SECRET_KEY`、`LITELLM_MASTER_KEY`、`LITELLM_DB_PASSWORD`、`SILLYSPEC_MASTER_KEY`。
- 引导管理员：`PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD/DISPLAY_NAME`（create-only）。
- 路径映射：`HOST_PROJECTS_DIR`（宿主项目根 → 容器 /host-projects）、`HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX`（宿主风格路径重写）、`SPEC_DATA_HOST_DIR`（spec-workspaces bind mount）、`WORKTREE_BASE_DIR`。
- daemon 可达地址：`HUB_PROXY_BASE_URL`（daemon 异机时须指向实际可达 hub 地址）。
- `COMMIT_SHA` 打进镜像；LiteLLM pin v1.95.0 的原因在注释中详细记录（1.96.0 起 anthropic adapter 走 /responses，国产上游 404）。

### CI（5 条流水线）

| workflow | 内容 |
|---|---|
| backend-ci.yml | ruff check + format + mypy + `pytest -n auto --cov=app --cov-fail-under=60 --reruns 2`（45min 超时；**覆盖率门坎 60%**） |
| frontend-ci.yml / daemon-ci.yml | 对应端的 lint/typecheck/test（含 gen:types 漂移卡点） |
| e2e-ci.yml | 端到端 |
| scan-drift.yml | `.sillyspec/docs` 与代码漂移检测门（**warn-only**：::warning 注解 + PR 评论，不阻塞） |

---

## 8. 代码质量与风险观察

> 以下为只读观察，附证据，不作武断结论。

### 质量面

- **测试极厚且分层**：三端 ≈1.14 万用例 / ≈34 万行测试代码；backend 测试行数（18.0 万）**超过**生产代码（12.3 万）。CI 含 flaky 重试策略、覆盖率硬门坎 60%、超时经实测校准（15→30→45 分钟的注释留痕）。
- **文档与代码双资产**：scan 8 篇 + modules 38 篇 + flows 9 篇构成活文档体系，且 scan-drift CI 门监控漂移；每个 change 的 design.md 沉淀在 `.sillyspec/changes/archive/`（数百个）。
- **TODO 极少**：生产代码中 TODO/FIXME 仅 **18 处**，集中于 ppm/workbench(7)、llm_provider/probe(3)、spec_profile(4)，且多带有意搁置的上下文。
- **安全工程化痕迹明显**：SSRF 校验原语（core/ssrf）、凭证不出进程（master key 不出 backend、daemon 经 llm-proxy 透传）、弱口令 fail-fast、审计三表（AuditLog/ToolOperationLog/PolicyAuditLog）、docs/ 下有 security-audit-2026-07-28.md 等多份审计报告。
- **韧性设计成体系**：daemon FileOutbox 断网补发、segmentId 去重、原子条件 UPDATE 防终态覆盖、幂等指纹 + checkpoint 断点续跑、卡死 run 定时收敛、kill 双通道幂等。

### 风险与可改进点

1. **巨型文件**：backend `daemon/session/service.py` 6608 行、`daemon/router.py` 5006 行、`change/service.py` 3611 行；frontend `session-panel.tsx` 5999 行。单文件巨型化提高维护与 review 成本，vertical slice 内部缺二次拆分。
2. **规模增长与门坎的赛跑**：backend-ci 注释自述用例 5300+ 持续增长、超时两次撞顶后放宽到 45min；45 分钟的 CI 对迭代节奏是可见负担（可考虑分片/优先级队列）。
3. **scan 文档滞后**：ARCHITECTURE.md 写 29 个业务域（实测 34）、94 张表（实测 104）；漂移门是 warn-only，依赖人工回填——文档密度本身（39 万行）也是维护成本。
4. **架构耦合点**：daemon 与 backend 经 WS 大帧（100MB spec bundle，tar+base64 单帧）通信，治本方案（daemon 侧 gzip）注释自认尚未实施；backend `mem_limit: 800m` 下承载 100MB WS 帧需关注内存峰值。
5. **多份"进行中"审计债**：docs/ 下 risk-assessment / deep-audit / platform-audit 等多轮报告显示问题在持续收敛，但 PPM 模块已上线而其余未上线，两套成熟度并存。
6. **跨平台复杂度内化**：Windows 路径（HOST_PATH_PREFIX 重写、bind mount 默认值 C:/Users/qinyi/IdeaProjects 硬编码在 compose 默认值中）、CLAUDE_CONFIG_DIR 隔离等都有精细处理，但配置面较大（必填 env 七项 + 路径映射三项），部署门槛不低。

---

## 9. 总结

**现状**：SillyHub 是一个工程成熟度相当高的全栈多智能体协作平台——backend(34 域 / 104 表 / 541 端点) + frontend(工作空间内 17 个子域) + daemon(12 种宿主 Agent 适配) 三端约 29 万行手写生产代码，以 ≈1.14 万测试用例与 39 万行规格文档双资产支撑演进；规范驱动开发不是口号而是贯穿每个 commit 的工作方式（commit message 即以 ql-ID/变更名锚定）。亮点在于：执行链路的韧性工程（租约/重试/Outbox/幂等/断点续跑）、安全边界设计（四轨鉴权、密钥不出进程、SSRF 原语）、以及"平台自身即方法论样本"的自举闭环。

**建议**（3-5 条）：

1. **拆巨型文件**：对 daemon/session/service.py、daemon/router.py、session-panel.tsx 等 >3000 行文件按职责二次拆分，降低 review 与合并冲突成本（多 agent 并行开发时尤甚）。
2. **CI 分片提速**：backend 套件按模块分组分片并行（xdir 已在用，可加 `--dist worksteal` 或按模块 select），把 45min 压回两位数分钟，避免下次再撞顶。
3. **scan 文档同步自动化升级**：把 scan-drift 从 warn-only 升级为可自动回填关键计数（模块数/表数/端点数等机械指标），减少人工滞后（本次分析已发现 29↔34、94↔104 两处漂移）。
4. **spec bundle 传输治本**：落地 daemon 侧 gzip（或分片上传），替代 100MB WS 单帧 + 800m mem_limit 的防御性兜底组合。
5. **沉淀部署模板**：将必填 env + 路径映射组合成交互式引导脚本或 .env 校验器，降低新机器/新成员接入门槛（当前七项 fail-fast 密钥 + 三项路径映射全靠文档指引）。

---

## 附：统计口径（可复现命令）

```bash
# 基线
git -C <repo> log --oneline -1                      # b38b922a
# 文件数（quotepath off 处理中文路径）
git -c core.quotepath=false ls-files | awk -F/ '{print $1}' | sort | uniq -c | sort -rn
git -c core.quotepath=false ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn
# backend 生产/测试行数
git -c core.quotepath=false ls-files 'backend/app' | grep '\.py$' | tr '\n' '\0' | xargs -0 cat | wc -l   # 303130
git -c core.quotepath=false ls-files 'backend/app/**/tests/*.py' | tr '\n' '\0' | xargs -0 cat | wc -l     # 179783
# frontend / daemon
git -c core.quotepath=false ls-files 'frontend/src' | grep -E '\.(ts|tsx)$' | tr '\n' '\0' | xargs -0 cat | wc -l   # 238035
git -c core.quotepath=false ls-files 'sillyhub-daemon/src' | grep '\.ts$' | tr '\n' '\0' | xargs -0 cat | wc -l    # 88441
git -c core.quotepath=false ls-files 'sillyhub-daemon/tests' | tr '\n' '\0' | xargs -0 cat | wc -l                  # 82556
# 用例数 / 表数 / 端点数 / TODO
grep -rh -E '^\s*(async )?def test_' backend/app --include='*.py' | wc -l            # 5188
grep -rh -E "^\s*(it|test)\(" frontend/src --include='*.ts' --include='*.tsx' | wc -l  # 2983
grep -rh -E "^\s*(it|test)\(" sillyhub-daemon/tests --include='*.ts' | wc -l           # 3217
grep -rh '__tablename__' backend/app --include='*.py' | wc -l                          # 104
grep -rh -E '@router\.(get|post|put|delete|patch|websocket)' backend/app --include='*.py' | wc -l  # 541
```

*报告由 analyst 分身基于只读分析生成（2026-09-01），未修改任何现有文件。*
