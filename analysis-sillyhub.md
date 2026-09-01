# SillyHub 代码库分析报告

> 分析日期：2026-09-01 · 分析方式：只读调研（本报告基于主仓库 main @ `58871190` 的 worktree 副本）
> 分析人：团队分身（worker）

---

## 1. 项目定位与用途

**SillyHub（仓库名 multi-agent-platform）是一个多智能体协作管理平台**，核心目标是"让 AI Agent 真正在团队里落地写代码"。

它把规范驱动开发工具 [SillySpec](https://github.com/q512426816/sillyspec) 从单人命令行工具升级为团队级平台：

- **变更规格驱动**：Agent 写代码不是黑箱——需求（brainstorm）→ 设计/计划（plan）→ 执行（execute）→ 验收（verify）→ 归档（archive），每步有结构化文档与评审门禁，结果可追溯。
- **多 Agent 统一编排**：一套平台调度 Claude Code / Codex 等 12 种宿主 Agent、6 种协议适配，新增 Agent 只加驱动不碰控制面。
- **团队协作**：多用户 / 多项目 / 多工作空间，RBAC 权限 + Git 凭据网关，共享服务器安全隔离。
- **本地执行安全可控**：轻量 Node.js daemon 跑在开发者本机执行任务，宿主文件系统策略引擎 + Git worktree 隔离。
- **实时可视**：SSE 流式输出、组件拓扑图、运行日志、看板。
- **附加业务域**：PPM 项目计划管理（项目/计划节点/任务执行/问题清单/看板）、知识库、事件复盘（incident）、发布审批（release）、平台文件中心（MinIO）、LLM 提供商管理。

**"吃自己的狗粮"**：SillyHub 自身就用 SillySpec 规范驱动开发，所有变更规格沉淀在 `.sillyspec/`，项目本身是方法论能力的活样本。

---

## 2. 技术栈

### backend（Python）
| 项 | 内容 |
|---|---|
| 语言 | Python ≥3.12，包管理 uv（hatchling 构建） |
| 框架 | FastAPI ≥0.115 · Pydantic v2 · uvicorn |
| ORM | SQLModel ≥0.0.22 · SQLAlchemy(async) 2.0 · asyncpg · Alembic 迁移 |
| 基础设施 | PostgreSQL 16 · Redis 7（缓存+Pub/Sub） · MinIO（S3 兼容，aiobotocore） |
| 安全/鉴权 | python-jose（JWT）· passlib/bcrypt · pynacl · 自研 SSRF 防护（core/ssrf.py） |
| 可观测 | structlog · 自研 monitoring/telemetry |
| 对外 MCP | 官方 mcp Python SDK **锁 1.x（<2）**——v2 breaking 改动与现有 FastMCP mount 写法冲突 |
| 测试 | pytest + pytest-asyncio + xdist（loadscope 分发）+ rerunfailures；ruff + mypy |

### frontend（TypeScript）
| 项 | 内容 |
|---|---|
| 框架 | Next.js **14.2.5**（App Router）· React 18.3 · TypeScript 5.5 |
| UI | **Ant Design 6.4** · Tailwind 3.4 · lucide-react · radix-ui 局部组件 · 双主题系统（blue/ai-native，token 单一源 themes.ts） |
| 数据/状态 | TanStack Query 5 · Zustand 4 |
| 可视化 | @xyflow/react 12（拓扑图）· ECharts 6 |
| 文件预览 | pdfjs-dist · docx-preview · xlsx · react-markdown-preview |
| 测试 | Vitest 2 + Testing Library（258 个测试文件）· Playwright（e2e） |
| 类型纪律 | `api-types.ts` 由后端 OpenAPI 生成（openapi-typescript），**禁止手写**，CI 卡漂移 |

### sillyhub-daemon（TypeScript / Node.js）
| 项 | 内容 |
|---|---|
| 运行时 | Node.js ≥20，ESM，tsc 直编译，pnpm 9 |
| 核心 | `@anthropic-ai/claude-agent-sdk` **0.3.247（全平台 override pin）** · `@modelcontextprotocol/sdk` 1.29 |
| 通信 | ws（WebSocket 主动连 backend）· commander CLI |
| 测试 | Vitest（192 个测试文件） |

### deploy
Docker Compose 一键编排：`postgres / redis / minio / litellm + litellm-db / backend / frontend`（另有 pg/redis/minio/litellm 数据卷 + worktree/claude 数据卷）。

---

## 3. 目录结构

```
multi-agent-platform/
├── backend/            # FastAPI 后端（app/core 横切层 + app/modules 34 个业务域 vertical slice）
├── frontend/           # Next.js 14（src/app 路由 · components · stores · lib）
├── sillyhub-daemon/    # 本地执行守护（task-runner · interactive · mcp · policy · resilience）
├── deploy/             # Docker Compose 编排 + 环境模板
├── docs/               # 设计文档 / 审计报告 / PPT / 原型（含多份深度审计与安全审计）
├── scripts/            # 仓库级脚本（scan 漂移检查等）
├── spikes/             # 技术验证草稿
├── attachments/        # 附件
├── .sillyspec/         # 规范驱动工作区（changes 归档 · docs 模块文档 · knowledge · quicklog · workflows）
├── .github/            # CI（backend / frontend / daemon / scan-drift 四条线）
├── .claude/ .codex/ .zcode/  # 各 Agent 宿主的工程配置
├── Makefile            # 统一开发入口（dev-up/test/lint/backend-run/frontend-run）
└── ANALYSIS-REPORT.md / results.md  # 此前分析产物
```

**backend 业务模块清单（34 个，一句话/模块）**：
- 平台基座：`auth`（用户/JWT/登录）、`admin`（组织/角色/权限 RBAC）、`settings`、`health`、`notification`、`storage`/`file`（文件中心）、`session_attachment`
- 核心协作域：`workspace`（工作空间+成员 runtime 绑定）、`change`（变更规格生命周期）、`change_writer`（变更写入授权）、`task`、`worktree`（Git worktree 隔离与租约）、`workflow`
- Agent 域：`agent`（运行/会话/任务编队/工件，最重的模型）、`agent/profile`（Agent 档案）、`runtime`（宿主 runtime 管理）、`skills`（自定义技能）、`mcp_gateway`（对外 MCP 服务+token/webhook）
- 执行边缘：`daemon`（实例注册/心跳/审计/授权/租约/控制命令）
- Git 域：`git_gateway`、`git_identity`（凭据网关）、`git_log`
- 治理域：`incident`（事件+复盘）、`knowledge`（知识库）、`release`（发布审批）、`scan_docs`（规范扫描）、`platform_sync`（平台间同步）
- PPM 域：`ppm`（project/plan/task/problem/kanban 五个子域 + workbench）
- 其它：`explorer`（文件浏览器）、`preview_office`（Office 预览）、`llm_provider`（LLM 提供商）、`spec_profile`、`spec_workspace`

**frontend 路由（App Router）**：
- `(auth)/login` 登录
- `(dashboard)` 桌面端：`workspaces`（工作台核心）、`sessions`（Agent 会话）、`agent-profiles`、`runtimes`、`ppm`、`settings`、`account`、`admin`
- `m/` 移动端独立路由组：`login / workspaces / ppm / account`
- `api/` Next.js 代理层：`daemon`（daemon 相关代理）、`daemon-chat`、`workspaces`
- 状态：stores 含 `session`（会话）、`floating-session`（浮动会话窗）、`workspace`、`kanban`、`theme`

**daemon src 关键职责**：
- 顶层：`daemon.ts`（主循环）、`ws-client.ts`（连 backend）、`task-runner.ts`（任务执行）、`hub-client.ts`（HTTP 补拉）、`control-dispatcher.ts`（控制面指令分发）、`agent-detector.ts`（宿主 Agent 探测）、`credential-injector`（凭据注入）、`terminal-launcher/observer`、`sillyspec-manager`、`skill-manager`
- 子目录：`adapters/`（6 种协议适配：json-rpc / jsonl / ndjson / pi-json / stream-json / text）、`interactive/`（交互式会话）、`policy/`（文件系统策略引擎）、`resilience/`（断线恢复/failover 审计）、`mcp-server.ts`、`agent-log/`、`autostart/`、`model-error/`

---

## 4. 代码规模（粗略统计）

| 部分 | 代码文件 | 代码行数 | 测试 |
|---|---|---|---|
| backend app（纯代码） | 353 .py | ≈123,400 行 | 模块内测试 459 文件 ≈180,000 行 + 顶层 tests/ 95 文件 ≈24,000 行 |
| frontend src（不含 api-types） | 658 .ts/.tsx | ≈197,900 行 | 258 个 .test 文件（含在左列中） |
| daemon src | 71 .ts | ≈48,400 行 | tests/ 192 文件 |

**合计约 37 万行主代码 + 约 20 万行后端测试**。测试密度非常高（后端测试行数超过业务代码行数），配合 CI 四条线（backend/frontend/daemon/scan-drift），是明显的质量优先工程。

---

## 5. Git 状态

- **主仓库**：分支 `main`，HEAD `58871190`，工作区干净（0 未提交变更）。
- 本报告在 worktree 分支 `workers/cbe026c3`（基于同 HEAD）产出。

**最近 10 条提交概要**：

| hash | 主题 |
|---|---|
| 58871190 | Merge branch 'workers/7b537b4a'（合并上一个 worker 分支） |
| 9ff1e9df | docs(analysis): 新增全项目只读分析报告 ANALYSIS-REPORT.md |
| b38b922a | fix(risk-review): 风险审查六连修——软删会话复活链闭合 + daemon 目录隔离收口 + 归档过滤 + 挂起入口落地（ql-20260901-001） |
| ce4f4688 | feat(workspace): 绑定自己的守护进程自动并入可写目录（owner 直绑 root_path 进 allowed_roots）（ql-20260831-018） |
| a565f347 | fix(daemon): 交互会话首条消息竞态必死修复——inject 早到改分离式等待会话创建 60s（ql-20260831-017） |
| b690c91e | fix(session): 会话归档 UX 系列四连修 + 后端 archived 三态化 + gen:types 同步（ql-013~016） |
| 3a594735 | fix(frontend): suspended 放开手动续聊——canResumeSession 加 suspended + 双通道恢复文案（ql-20260831-012） |
| 501b213e | fix(ui): 输入胶囊+功能按钮放大显形——antd 高度钳制修复（ql-20260831-012-5f60） |
| a63932d8 | fix(agent): worktree 基准分支探测兜底——派发前验证 default_branch 缺失回退 HEAD（ql-20260831-007） |
| 695ad911 | fix(agent): mission.constraints 损坏双修——合并 SQL 类型守卫 + TypeDecorator 归一（ql-20260831-008） |

提交风格特征：每条 fix 都带 ql-ID（quicklog 编号）回链、超详细的根因/方案/测试结果描述——与 SillySpec 流程深度绑定的工程习惯。近期提交全部是修复与体验打磨，处于**功能成型后的高频加固期**。

---

## 6. 架构要点

### 6.1 总体拓扑

```
浏览器 ──HTTP/REST + SSE──▶ backend(FastAPI) ──▶ PostgreSQL / Redis / MinIO
                                 ▲
                                 │ WebSocket（daemon 主动连出）
                          sillyhub-daemon(Node, 本机)
                                 │ spawn + MCP + 协议适配
                                 ▼
                       Claude Code / Codex … 12 种宿主 Agent
```

- **backend 是持久化与鉴权中心**；**daemon 是本机执行边缘节点**，主动连 backend 领任务、读写宿主文件系统。
- **单一 API 真相**：前端与 daemon 的类型都从 backend OpenAPI 自动生成（`pnpm gen:types`），CI 卡漂移。

### 6.2 后端 API 组织

- **vertical slice 模式**：每个业务域一个目录，内部固定 `router.py / service.py / model.py / schema.py / tests/`，34 个模块在 `app/main.py`（884 行）集中注册约 50 个 router，统一挂 `/api` 前缀（PPM 域挂 `/api/ppm`）。
- **core 横切层**：db/redis 连接、config、auth_deps、security、crypto、ssrf 防护、errors、logging(structlog)、monitoring/telemetry、audit_hooks、permission_cache、spec_paths。

### 6.3 核心数据模型（99 张表，按域分组）

| 域 | 主要表 | 说明 |
|---|---|---|
| Agent 执行 | `agent_runs / agent_sessions / agent_missions / agent_run_logs / agent_run_dependencies / agent_artifacts / agent_run_model_usage / agent_session_queued_messages / agent_profiles` | 平台心脏：运行、交互会话、任务编队（mission=多 worker 协作）、工件、依赖、token 用量、离线排队消息 |
| 变更规格 | `changes / change_documents / change_events / change_reviews / change_session_links` | SillySpec 变更生命周期（brainstorm→archive 状态机+评审） |
| 工作空间 | `workspaces / workspace_member_runtimes / user_workspace_roles / spec_workspaces / worktree_leases / task_workspaces` | Git 仓库注册、成员-runtime 绑定、worktree 租约 |
| Daemon 边缘 | `daemon_instances / daemon_runtimes / daemon_runtime_grants / daemon_task_leases / daemon_control_commands / daemon_change_writes / daemon_borrow_audit` | 实例注册心跳、runtime 授权（allowed_roots 物理写边界）、任务租约、控制指令、借用审计 |
| 用户与权限 | `users / roles / role_permissions / user_roles / organizations / user_organizations / api_keys / audit_logs` | RBAC + 组织树 + API key + 审计 |
| Git 网关 | `git_identities / git_operation_logs / git_gateway`（router 域） | 凭据托管与操作审计 |
| PPM | `ppm_project_* / ppm_plan_* / ppm_task_execute / ppm_problem_* / ppm_kanban_* / ppm_work_hour` 等 20+ 张 | 完整项目交付域（客户维护/干系人/工时/问题变更流程/看板） |
| 治理 | `incidents / postmortems / releases / release_approvals / notifications / knowledge(经 scan)` | 事件复盘、发布审批、通知 |
| 平台运维 | `platform_settings / platform_sync_tokens / platform_agent_logs / platform_change_progress / quicklog_entries / tool_policies / policy_audit_log / sessions / mcp_tokens / mcp_webhooks / scan_documents / spec_*` | 设置、跨平台同步、quicklog、工具策略与审计 |

最大的单模型文件是 `agent/model.py`（1432 行，9 个表实体），其次是 `daemon/model.py`（610 行）。

### 6.4 前端结构

- 桌面端 `(dashboard)` 八大区 + 独立移动端路由组 `m/`，通过 Next.js `api/` 代理层桥接 daemon 通信。
- 组件库以 antd 6 为基座 + Tailwind + 自建双主题 token 系统（blue / ai-native）。
- 状态分层：服务端状态走 TanStack Query，跨页 UI 状态走 Zustand（会话/浮动窗/看板/主题/工作空间）。

### 6.5 daemon 与平台的关系

- **连接方向**：daemon 主动 WS 连 backend（适配家庭/企业 NAT 场景），HTTP 补拉做一致性兜底；心跳同步 runtime 与 allowed_roots 策略。
- **安全模型**：`policy/` 引擎管宿主文件系统读写边界（allowed_roots 是机器主人授予的物理写边界，借用人不可自扩）；worktree 隔离让并行任务互不干扰；凭据注入器按需下发。
- **可靠性**：`resilience/` 处理断线恢复、failover 审计；近期多个修复集中在“daemon 重启后会话恢复/挂起/软删复活”等边缘竞态。
- **Agent 适配**：`agent-detector.ts` 探测本机宿主 Agent，`adapters/` 六种协议（stream-json/json-rpc/jsonl/ndjson/pi-json/text）统一归一化事件流。

---

## 7. 风险与观察

### 技术债/热点
1. **TODO/FIXME 极少且集中**：backend 仅 20 处（ppm/workbench 7、llm_provider/probe 3、spec_profile 3，其余零散），frontend 2 处，daemon 0 处——代码卫生状况非常好，无烂尾密集区。
2. **超大文件**：`backend/app/modules/agent/model.py` 1432 行、`main.py` 884 行集中注册约 50 个 router——在模块继续增长时是维护热点（vertical slice 本身缓解了大部分压力）。
3. **测试与 CI 债务已知且有预案**：pyproject 注释记录了 CI 2 核下 xdist+async fixture 的 flaky 问题，用 loadscope + reruns 兜底；本机 20 核全量 3931 passed。
4. **版本锁定策略明确但需持续看护**：mcp Python SDK 锁 <2（v2 breaking）、claude-agent-sdk 全平台 override pin 0.3.247、Next.js 14.2.5（非最新大版本）——升级窗口需要主动管理。
5. **多 Agent 并行开发约定依赖纪律**：CLAUDE.md 大量篇幅在约束多 agent 并行操作（worktree 竞态、QUICKLOG 轮转、pre-commit stash 竞态等），说明协作密度极高，流程规则是稳定性生命线。
6. **此前已有分析报告**：根目录存在 `ANALYSIS-REPORT.md`（9ff1e9df 提交）与 `results.md`，本报告为独立重做，可交叉印证。

### 工程亮点
- 后端测试行数超过业务代码行数，CI 分层（backend/frontend/daemon/scan-drift）+ OpenAPI 类型漂移门禁。
- 提交信息与 SillySpec quicklog（ql-ID）双向回链，可追溯性极强。
- `.sillyspec/` 沉淀了完整的变更历史、模块文档（scan）、知识库与 ROADMAP——文档驱动不是口号。

### 值得关注的问题（非缺陷，观察项）
- `docs/` 下多份深度审计报告（security-audit、platform-audit、agent-layer-risk-assessment 等）说明平台经历过数轮外部视角审视，风险项在持续收敛（近期提交多为审计后修复）。
- PPM 域 20+ 张表、流程链路长（问题变更流程 ×2 套 process 表），是业务复杂度最高的域，也是 TODO 唯一的小聚集区。

---

## 8. 一句话总结

**SillyHub 是一个以"规范驱动 + 多 Agent 编排 + 本地边缘执行"为骨架的全栈平台（FastAPI + Next.js + Node daemon，约 37 万行主代码 + 20 万行后端测试），工程纪律严明、测试密度极高，当前处于功能成型后的高频加固期，无明显技术债密集区。**
