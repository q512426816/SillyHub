---
author: qinyi
created_at: 2026-06-24T01:46:42
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---
# 术语表（Glossary）

本术语表收录 SillyHub（多智能体协作管理平台 / SillySpec 产品化）项目内专有术语的**项目特殊含义**，基于实际代码（`backend/app`、`frontend/src`、`sillyhub-daemon/src`）与 `.sillyspec/docs/SillyHub/modules/*` 模块卡片用法整理，不抄通用字典定义。2026-08-18 全量重扫后修订。

---

## SillySpec 规范体系

### SillySpec
本项目产品化的对象——一套「文档驱动开发」方法论。SillyHub 把它的 `brainstorm → plan → execute → verify → archive` 流程做成 Web 平台。权威运行时状态存于工作区 `.sillyspec/.runtime/sillyspec.db`（SQLite）。CLI 在 agent 进程内运行，进度经 platform_sync 端点回传平台。

### workspace（工作区）
SillyHub 的**核心组织单元**。一个 Git 仓库/代码目录对应一个 workspace 实体（`Workspace` 表：root_path/slug/component_key/parent_id）。几乎所有业务（change/task/worktree/agent）都以 `workspace_id` 为上下文根。daemon-client 唯一模式下，工作区是「成员宿主机上的一个 SillySpec 项目」的服务端投影。软删可复活（partial unique index），同路径重建走复活而非冲突。

### spec 空间 / spec workspace（spec-workspace）
把「一个代码目录」变成「一个 spec 工作流实例」的桥梁。`SpecWorkspace` 表与 workspace 1:1 关联，决定 spec 文件存哪（spec_root）、以什么策略同步（platform-managed / repo-mirrored / repo-native 三策略）、如何增量落盘（per-file manifest 乐观锁）。workspace 创建时经 `_ensure_spec_workspace` 自动连带建。

### spec profile（spec 清单）
定义「这套规范要求哪些阶段（stages）、哪些文档（documents）、哪些门禁（gates）、agent 拿什么契约（agent_contracts）」。多 profile 在同一工作区叠加时由 `spec_profile` 模块做 stage/document 级冲突检测，落 `SpecConflict` 表。换 profile 即换工作流形态，无需改代码。

### change（变更）
SillySpec 变更工作流的核心实体。对应 spec 树 `changes/<change-key>/` 目录，承载一次完整改动。**已会话驱动化**：平台侧无新建表单，新建走会话由 agent 落盘；有阶段流转（current_stage）、文档矩阵、人工审核门（四类面板）、进度投影、反馈、归档门槛、quicklog 视图、变更-会话绑定（ChangeSessionLink）。

### 变更文档矩阵（proposal / design / plan / tasks / requirements）
一份变更下按 SillySpec 模板组织的 markdown 文档集：
- **proposal** —— 变更提案（动机/范围）
- **requirements** —— 需求清单
- **design** —— 技术方案设计
- **plan** —— 实现计划（Wave 分组 + Task 列表 + 依赖关系）
- **tasks** —— 任务定义（`tasks/<task-key>.md`，frontmatter 含依赖/阻塞/优先级/影响组件）

文档现由 agent 会话在宿主产出、经 spec 增量同步回传；change_writer 模块的 markdown 模板构造能力保留为纯库（HTTP 生成入口已随表单下线）。文件是 source of truth，`change.parser` 解析入库。

### 变更阶段（stage / current_stage）
变更的生命周期阶段，取值如 `draft → brainstorm → plan → execute → verify → archive → archived`（终态 `archived`/`cancelled`）。状态机（StageEnum + `can_transition`）已内聚在 change 模块（workflow 的旧 ChangeFSM 已删）。**current_stage 双轨**是刻意设计：平台写落库字段 + 读时投影（`_project_current_stage` 批量 join platform_change_progress）覆盖 CLI 上报镜像，两者短暂不一致不是 bug。阶段推进停在待触发态，由 MCP 工具（advance_change_stage）或 HTTP（advance_stage）**按需显式派发**（形态A，auto_dispatch 自动连轴已废弃）。gate 判定仅 verify 阶段适用。

### task（任务）
变更（Change）下的**可执行单元**，对应 `changes/<change-key>/tasks/<task-key>.md`。本模块只解析/落库/查询（文件是 source of truth，reparse 对消失行硬删）；状态流转经 workflow.transition_task（TaskFSM：draft→ready→in_progress→review→done，含 blocked/cancelled 分支）。allowed_paths 限定 task 可操作的代码路径（tool_gateway 消费）。

### scan / scan-docs（文档扫描）
把 spec 树 docs/ 下的模块卡片、知识、组件文档等 markdown 解析成结构化 `ScanDocument` 行（unique (workspace_id, path)，exists 软删）。纯只读索引层：不写文件，只读 + 解析 + upsert 对账 + 冲突历史归档（ScanDocConflictHistory，覆盖前存旧版）。与 task.parser、knowledge.parser 并列三大 spec 解析器。

### knowledge / quicklog（知识 / 快日志）
spec 树 `knowledge/` 与 `quicklog/` 下的 markdown 知识条目，作为变更沉淀的可复用经验库。`knowledge` 模块是**只读消费侧**（list/get）；条目由 SillySpec CLI 侧归档流程写入文件（平台后端无 distill 生成代码）。QUICKLOG 条目另经 platform_sync 上行（quicklog_entries 表），change.quicklog_service 做本地解析与平台同步条目的合并查询视图。

### archive（归档）
变更工作流的**收尾环节**：`changes/<key>/` → `changes/archive/<key>/` 的目录移动由 SillySpec CLI 在 agent 会话内执行（平台后端无独立 archive 模块）。平台侧职责是门槛与视图：change.check_archive_gate 校验归档条件、archive_confirm 审核面板放行、归档变更经 spec-sync 推送后触发全量 reparse 对齐索引。

### runtime 进度（SillySpec 运行时进度）
后端 `runtime` 模块以**只读方式**读取 spec 树 `.runtime/` 状态（`sqlite3 mode=ro` 直读 sillyspec.db 的 changes/stages/steps；user-inputs.md / artifacts/ 文件读取），翻译成结构化 API。所有 workspace 恒为 daemon-client + platform_managed=True（恒扁平布局）；文件类读取可注入 HostFsDelegate 走 WS RPC。它不执行 SillySpec、不写状态、不落库。

---

## 执行与编排

### agent run（智能体运行 / AgentRun）
把一次 SillySpec 阶段派发（stage dispatch）、扫描派发、init 派发或独立任务（quick-chat）编排成的一条 `AgentRun` 记录，落到在线 daemon 执行。由 AgentService 四类 start_* 入口创建，经 placement 选在线 daemon；含幂等/断点续跑（指纹/resume token/checkpoint）、AgentProfile 档案透传、mission 多 worker 团队、kill 统一通道（cancel_lease）、日志 SSE 流、借用（borrow）产物回存。是连接「变更工作流」与「本地 daemon 执行」的中枢。

### mission（任务协同）
一次 agent 执行可派发多个 worker 协同完成的组织单位（`AgentMission` + `AgentRunDependency`）。`MissionService`/`MissionControlService` 管 mission 生命周期，`derive_status` 聚合 worker 状态，`can_dispatch_worker` 做并发/成本预算校验。execute 团队全 worker 收敛后由 `_advance_team_stage` 推阶段；外部编排者经 mcp_gateway 的 converge_mission 收敛。

### daemon（本地守护进程）
跨组件「本地执行与交互」功能域，由两部分构成：
- **backend daemon 模块** —— 调度与状态权威（注册/心跳/租约/会话/WebSocket Hub/host_fs 文件通道/代写队列/单文件分发 dist_router/llm-proxy 透传）
- **sillyhub-daemon**（Node ESM 进程）—— 执行体，承载 claude-agent-sdk / codex 双驱动实际执行

两者经 WebSocket（daemon 主动拨号 /ws）+ REST 双向通信。三类执行形态：批处理 lease（无状态任务）、交互式 session（有状态长对话）、host_fs/patch 文件通道 + change-write 代写队列（平台远程读写宿主文件）。

### runtime（daemon runtime，运行时会话/守护实例）
daemon 域中的概念：一个注册到 backend 的本地 daemon 进程实例（`daemon_instances` 表），是「在线 daemon」判定与任务派发的目标；machines 聚合读提供机器级视图（别名/版本/构建号/用量）。注意区别于「runtime 进度」（SillySpec 运行时进度）——两者同名但分属 daemon 域与 spec 域。`NoOnlineDaemonError` 表示无可用 runtime 接任务。

### lease（任务租约 / DaemonTaskLease）
批处理执行模式下，daemon 领取任务的凭证机制。claim（claim_token compare_digest 鉴权）→ start → heartbeat → complete 状态机；`expire_overdue_leases` 批量回收超时，cancel_lease 统一取消入口（interactive 走 SESSION_END、batch 走 LEASE_CANCEL WS 即时推送，写 terminating_at 等 daemon 回传终态）。interactive lease 永不过期是不变量。注意「远端写盘代写任务」不复用本表——独立 daemon_change_writes 队列（不启动 agent）。另有 worktree lease（WorktreeLease）是另一套租约。

### interactive session（交互式会话）
与批处理 lease 并列的 daemon 执行模式：同进程多 turn 长对话。SessionService 管理 create/inject/interrupt/end/reopen/recover/confirm-reconnected，SSE 流式（/sessions/{id}/stream）、权限请求与 AskUserQuestion 对话框（dialog 行）。Node 端由 interactive/（claude-sdk-driver + codex-app-server-driver 双驱动、session-manager、input-queue、permission-resolver、jsonl 持久化）支撑。SessionReadiness 握手防 inject 早到；ResilienceService（Envelope/Outbox）保证消息韧性与重启恢复收敛；空闲回收默认禁用（完成驱动 end）。

### worktree（git 工作树 / WorktreeLease）
为 agent 执行提供隔离 Git 工作树的**租赁管理**：bare repo + `git worktree` 检出独立目录（branch 命名 `users/<u>/changes/<c>/tasks/<t>`），`GitRunner`（clone_bare/worktree_add/remove，clone 前 assert_safe_repo_url SSRF 前置）+ `ExecEnvBuilder`（.gitconfig + askpass 凭据注入）。acquire 非幂等、release 时 shred_askpass 覆写删除 token。**现状无过期 GC 调用方**（expires_at 字段与索引仍在但无人清扫），泄漏只能靠显式 release 兜。tool_gateway 的所有文件操作都被限制在 lease 根目录内。

---

## 安全与网关

### tool gateway（工具网关）
agent 工具操作的安全网关 + 策略引擎：7 类工具（file_read/file_write/file_list/file_search/shell_exec/run_tests/http_get）统一经 execute 入口，在 worktree lease 根目录内执行，受 `ToolPolicy`（白名单/命令黑名单/域名白名单/SSRF 防护）约束，输出脱敏 + 截断，双写审计（ToolOperationLog + AuditLog）。**现状两处未接线**：router 调 execute 恒用 default_policy()（宽松兜底，ToolPolicy 表有 CRUD 但无执行路径加载）；approvals 四端点是 V1 stub（pending/history 恒空表，approve/reject no-op）。agent 会话内的实时工具审批走 daemon session 的 permission/dialog 通道，不经本模块。另是平台 SSRF 校验原语（assert_public_hostname）的宿主。

### git gateway（git 操作网关）
在 worktree lease 上下文内代用户执行受控 git 操作（白名单），记录操作日志，自动用用户配置的 git 身份署名；redact_output 脱敏输出供 tool_gateway 复用。把分散的 git 命令收敛到统一受审计入口。

### git identity（git 身份/凭证）
管理用户的 git 提交身份（name/email）与 PAT 等访问凭证。凭证经 `core.crypto.CredentialCipher` 对称加密落库（带 key_id 支持主密钥轮转）。通过 provider（GitHubProvider 等）校验凭证对目标仓库的访问权限。为 git_gateway 署名、worktree 拉取私有仓库提供身份与凭证来源。

### spec transport（spec 传输）
spec_workspace 与文件系统之间的同步机制统称。现行通道三条：daemon tar 全量落盘（sync，流式解包 staging）；**增量 ops 落盘**（sync-incremental / platform_sync 的 spec-sync 端点，FileOp + base_version 乐观锁，见 spec-incremental-sync 流程）；「同步到服务器」手动回灌（sync-manual，经 daemon 代写队列 kind=spec-sync）。另有 bundle 流式下载与「从仓库导入」（SSE + daemon RPC 打包）。

---

## 平台基础设施

### RBAC（权限模型）
平台「用户/角色/组织」权限体系。权限分平台级 + 工作空间级，按 `Permission(StrEnum)` 枚举全部权限点，归入 AUDIT/WORKSPACE/PLATFORM/ADMIN/CHANGE/AGENT/PPM 等组。`core.auth_deps` 的 FastAPI 依赖项把权限校验注入所有受保护端点；`rbac.collect_permissions*` 按工作空间范围聚合权限；读侧接 core.permission_cache（Redis + 熔断降级）。

### audit log（审计日志）
append-only 的操作审计记录（`AuditLog` 表，workflow 模块持有模型）。`core.audit_hooks` 注册 ORM 事件钩子，向所有 `BaseModel` 子类的增删改自动写审计（变更前后字段 diff、审计上下文）；登录/settings/工具网关/daemon 操作等手工审计共用此表。直接 `connection.execute` 绕过 ORM 的写入不产生审计记录。审计 action 常量集中定义于 workflow.model，service 代码禁止内联字面量。

### incident / postmortem（事件 / 复盘）
运营域的**生产事件记录与事后复盘**（`Incident` + `Postmortem` 一对一）。记录标题、严重度、状态、时间线，复盘文档含原因、影响、改进项。与 SillySpec 变更工作流解耦。

### release（发布）
发布与审批域：管理一次发布（`Release`）的创建、多角色审批（`ReleaseApproval`，满足审批阈值才放行）、环境晋升、部署（受部署窗口策略校验）、回滚。

---

## 独立业务子系统

### ppm（项目管理）
SillyHub 内嵌的**独立项目管理子系统**，与 spec 工作流并行。跨 backend（project/plan/task/problem/kanban/workbench 子域，统一前缀 /api/ppm）+ frontend（(dashboard)/ppm 独立入口 + lib/ppm 客户端 + ppm-* 组件 + 移动端 m/ppm）。覆盖项目→计划→任务→问题→看板全链路。复用平台 auth/audit/settings/file 但业务自成体系。**已上线**（其余模块未正式上线）。

### 问题清单（problem-list / problem 子域）
PPM 的问题清单子域（/api/ppm/problem-list）：`ppm_problem_list` 表 status 取中文 3 态「新建/进行中/已完成」；执行流两步 /start + /execute；Excel 导入两步式 import-preview + import-commit。旧「问题变更流 4 节点审批流」（ProblemNode/ProblemChangeStatus 版本链）已 deprecated。

### DataScope（data_scope / 数据范围）
PPM 数据可见范围解析：`is_full`（超管）/ `manager_project_ids`（经理可见项目集合）/ `creator_user_id`（创建人兜底）。与功能权限正交——require_permission 管「能不能进接口」，data_scope 管「能看哪些数据」。经理判定单一可信源 = 项目成员角色 PpmProjectMember.role_name。

---

## 2026-07-27 增量

> 2026-06-24 之后新增模块/概念增量补充，定义基于实际代码符号与模块 docstring 核实；部分条目已在 2026-08-18 重扫时按现状修订。

### LLM Provider（llm_provider / 用户级 LLM 提供商凭证）
用户级 LLM 提供商凭证管理（/llm-providers）。`LlmProvider` 表 owner = user_id（用户级作用域）；agent_kind 标识 claude / codex / gemini / pi 等代理种类；加密凭证复用 CredentialCipher。is_default 在 (user_id, agent_kind) 维度互斥；set-default/unset-default（cc-switch 式启停）支持热切换 + 凭证探测 + 回滚。openai_chat 类供应商的实际推理经 LiteLLM 网关（见 2026-08-18 增量）。

### provider 注入（claim payload 供应商解析）
lease 下发前的供应商四级解析：run 绑定 profile 的 llm_provider_id（归属校验 user_id==runtime.user_id + agent_kind 一致）→ 平台默认供应商 → 本机不注入。openai_chat 类不下发 master key，改发 `litellm_proxy` 标记 + hub 代理地址（daemon injector 转 ANTHROPIC_BASE_URL 指向 hub，master key 不出 backend 进程）。

### file / 文件中心（File 表）
平台级文件中心元数据（/api/file）。`File` 表只存对象存储的业务元数据（stored_key = 日期分桶 + uuid 防覆盖；owner_type/owner_id 多态归属；软删），对象实体在 MinIO（storage 模块 StorageBackend 抽象）。PPM 各 file_urls 字段存本表 id。

### StorageBackend / MinioStorage（对象存储抽象）
平台文件中心的存储抽象层：put/get_stream/delete/head 四抽象方法；MinioStorage 是 MinIO 实现（aiobotocore）；factory 按配置注册后端，业务只依赖抽象接口，切换 S3 兼容实现只改配置。

### CustomSkill（custom_skills / 自定义技能）
平台级自定义技能管理。`CustomSkill` 表存用户编写的 SKILL.md（name UNIQUE + 字符集校验、content 为正文、YAML frontmatter 业务层组装）。平台级共享：无 workspace_id，所有工作区可见同一份。

### workbench / 工作台（ppm/workbench）
PPM 工作台聚合视图子域（平台级、仅认证不授权）：/profile 头部信息、/summary 汇总、/calendar 日历、/todos 待办。支持 target_user_id 切换查看目标用户（_resolve_target_user 收口，越权 403）。

### daemon-borrow / 借用（borrow_resolver）
业务/管理人员借用开发成员在线 daemon 执行的能力。`_resolve_borrowed_or_own_runtime` 是 4 路派发 resolver 统一入口：先查 actor 自有 member binding，无在线自有 → DAEMON_BORROW 权限闸 → resolve_shared_daemon_for_borrow（lender_user_id）。三重校验顺序：权限 → shared → online。

### AskUserQuestion / dialog（dialog_kind 对话框扩展）
复用 daemon permission_request 通道的问答题机制。dialog_kind 非空时该请求**不是**工具审批而是面向用户的问答题：无 5min 自动拒绝、可无限期等待，长存 session_dialog_requests 表以跨前端刷新；resolve 端点同时处理 canUseTool 审批与 dialog 回答。区别于普通工具审批（有超时且为放行）。

---

## 2026-08-18 增量

> 2026-08-18 全量重扫新增术语，基于 744e3de4 代码符号与重写的模块卡片核实。

### shpsync_ token（PlatformSyncToken）
platform_sync 模块的 workspace 级同步 token（`platform_sync_tokens` 表，前缀 `shpsync_`，sha256 直存）。**唯一写通道**：SillySpec CLI / daemon 回传进度、文档、审批、quicklog、spec 增量只接受它；读端点兼容 shk_live_/JWT（CHANGE_READ workspace 并集 scope）。token 绑 created_by user + workspace，上行归属人由签发人派生。CLI 写通道固化 Bearer shpsync_，改前缀即断所有客户端。

### shk_live_（API Key 前缀）
用户 API Key 的明文前缀（ApiKeyService 签发）。daemon 长期凭证与脚本调用走 X-API-Key 通道；正/负缓存加速校验（负缓存拒无效 key 探测，正缓存命中后仍回 DB 实时校验用户 active）。与 shpsync_/shmcp_ 三套前缀独立互不复用，authenticate 先判前缀，不符直接返回不查库。

### McpToken（shmcp_）
mcp_gateway 签发的对外 MCP 访问 token（`mcp_tokens` 表，明文仅签发时返回一次，库存 sha256，hash O(1) 查表）。绑 workspace，scope ∈ read/dispatch/converge（frozenset 成员判定，各工具自行 require）；带 Redis 正/负缓存 + last_used_at 节流（高频热路径，与 platform_sync 的无缓存策略对照）。仅认 Authorization: Bearer，刻意不做 ?token= 回退。get_or_issue 是 init 派发复用的取-or-签发路径（dispatch scope）。

### spec_root
spec 文件树在服务器侧的存储根目录（SpecWorkspace.spec_root，platform-managed 默认策略下为平台托管扁平目录）。backend 的 change/task/scan_docs/runtime 全部解析源都指向它（daemon-client 唯一模式下 backend 读不到成员宿主 root_path）。经 Docker bind mount 与宿主 daemon 共享；Windows bind mount 上重 FS 循环有 stat 性能断崖（历史坑，reparse 已改单遍 scandir）。

### AgentProfile（agent 档案/配置增强层）
agent 模块的配置增强层（agent_profiles 表 + profile/ 子域）：把 mcp 配置、skills、凭证、allowed_roots、绑定 LlmProvider 打包成可复用档案，派发时经 `_apply_profile_to_lease` 写进 lease.metadata 透传 daemon。解析链：run 显式指定 → workspace 默认（default_agent_profile_id，档案删则 SET NULL 回退 default_agent）→ 系统默认档案兜底（Claude Code 默认 / Codex 默认）。平台角色模板已全部下线，仅按确定性 UUID 清单回收 DB 残留。

### change session（变更会话 / ChangeSessionLink）
会话驱动化后变更与交互会话的绑定关系（change_session_links 表）。变更的创建、阶段推进、审核放行/打回都在独立会话页进行；change 的阶段/审核事件经 `_notify_bound_session` 回推绑定会话，形成「会话即变更工作台」的闭环。审批操作注入服务身份。

### 乐观锁（base_ts / base_version）
两套不同尺度的乐观并发控制：
- **base_ts**（platform_sync 进度上行）——CLI 上行带 last_pushed_at 基线，平台侧按 ISO 8601 UTC **字符串字典序**比对 last_pushed_at（故该列存 String 非 DateTime）；stored > base_ts 判冲突，返回平台侧 latest_progress 不改数据。
- **base_version**（spec 文件增量同步）——每个 FileOp 带清单行 version 基线；server 行 version != base_version 且 hash 不同则记 conflict 跳过，同 hash 豁免 no-op。

### LiteLLM 网关（llm-proxy 透传）
全部 LLM 调用的统一出口（compose 独立服务 ghcr.io/berriai/litellm:v1.95.0 + 专属 litellm-db）。backend 经 llm_provider.litellm_client 调 admin API 动态注册 `usr-<uid>-<pid>` 模型路由；daemon 侧无直连密钥，经 backend `ANY /api/daemon/llm-proxy/{path}` 透传（v1 路径白名单，校验 daemon apiKey 归属后注入 master key）——master key 永不出 backend 进程。

### manifest（SpecFileManifest / spec-manifest）
spec 文件树的**服务器权威 per-file 清单**（spec_file_manifest 表，workspace+path 唯一）：content_hash（sha256）、version（乐观锁基线，每次应用 +1）、exists（软删标志）。唯一写者是 spec_workspace.apply_ops（D-011 单写者，reparse 不读写此表）。`GET /changes/-/spec-manifest` 返回全量行**含 exists=False 软删行**，CLI/daemon 据此识别服务端已删文件并下发 delete 对齐。

### QUICKLOG / ql-ID
quick 流程的条目记录文件（spec 树 quicklog/QUICKLOG-<user>.md）。同一文件按 **ql-ID**（ql-YYYYMMDD-NNN 序号）条目追加，不是单槽位——多个 quick session 并发不冲突（但 --done 可能误绑错条目，落盘前须核对）。CLI 只写骨架，语义化标题/文件清单/结果四段靠人工精修。平台侧 change.quicklog_parser 解析 + platform_sync 上行条目合并展示。

### daemon-client 模式（唯一模式）
workspace 与执行环境的关系模型：所有 workspace 恒为 daemon-client（2026-07-10 起 server-local 模式已删，workspaces.path_source 列已不存在）。backend 无可达成员文件系统，一切宿主文件读写经 daemon 通道（HostFsDelegate RPC / spec-sync / 代写队列）；平台解析源恒为服务器 spec_root。

### HostFsDelegate（host_fs 通道）
backend 远程读写 daemon 宿主文件的原语层（daemon/host_fs/delegate.py + WS RPC send_rpc/rpc_result，rpc_id 关联 + 超时取消）。消费方：runtime 只读器（文本类）、workspace skills/mcp-config 视图、change 变更文件写、verify gate、patch 打补丁。二进制文件（sillyspec.db）不走 delegate——容器对 spec_root 直读可达（mode=ro 防锁 CLI 写入）。

### allowed_roots
daemon 侧会话/任务的文件系统白名单根集合。心跳回包 `_syncAllowedRoots` 同步（JSON 相同短路防风暴）；session-manager 据此做写白名单 write-guard（显式写 + Bash 间接写重定向/cp/mv/tee 等都限根内）；policy 的路径前缀比较对盘符根/Unix 根边界敏感（勿再补尾 sep）。profile 的 allowed_roots 字段经 lease.metadata 透传。

### segmentId 去重
daemon 上行流式消息的跨调用去重约定（双侧消息结构契约）：partial 行带 metadata.segmentId、complete 行 NULL；backend run_sync 据此合并 partial/complete 并 `_revoke_committed_partials` 撤已提交半截。配合 pending→running 原子条件 UPDATE 防迟到的 submit 覆盖终态（lost update）。AgentRunLog.segment_id 是 DB-only 去重锚点，不入对外 API。

### DaemonChangeWrite（代写队列）
daemon-client 下「平台远端写盘」的任务队列（daemon_change_writes 表，与 DaemonTaskLease 分离——不启动 agent）。生产者三类：建变更目录（change_writer proxy）、变更文档在线编辑（change._enqueue_edit_write）、「同步到服务器」（spec_workspace sync-manual，kind=spec-sync）。流转 pending → claim(token 轮转) → complete 回执；claimed 超时（60s / spec-sync 600s）GC **回灌 pending** 自动重试（幂等）。详见 daemon-change-write 流程文档。

### SpecPathResolver（双模式路径解析）
core.spec_paths 的 SillySpec v4 目录布局统一解析器：repo-native（`<root>/.sillyspec/...` 包裹）与 platform-managed（扁平，root 即内容根）双模式，`for_spec_workspace` 工厂按 spec_workspace.strategy 自动选。定义标准文档文件名常量（proposal/design/plan/tasks/verify-result/module-impact/MASTER）与旧名映射。新读写 .sillyspec 的代码必须走 resolver，禁止手拼路径。

### 进度投影（读时投影 / current_stage 双轨）
变更中心读变更列表/详情时，`_project_current_stage` 批量 join platform_change_progress（复合 IN 防 N+1）取 CLI 上报的权威 current_stage/completed_stages/latest_progress，**读时覆盖落库值**。另一轨 StageProjectionService 只读（mode=ro）宿主 sillyspec.db 的 stage 完成事件，把人工门状态投影为四类审核面板之一；db 不存在/读取失败一律返回 None 静默降级，绝不写 CLI 的库（D-002）。

### 供应商热切换（DAEMON_MSG_PROVIDER_CONFIG_CHANGED）
默认 LlmProvider 变更时 backend 按 daemon 分组推 WS 消息，daemon 在 **turn 边界** reload（close 旧 query + resume agentSessionId 保留历史；markPendingSwitch 防孤儿 consume；input-queue resetForResubscribe 保 pending inject）。取消默认供应商时停止推 null——daemon 回归本机凭证管理。

---

## 注

- 本表术语取自实际代码符号（表名/类名/服务名）与模块卡片定位，同名异义处（如 runtime 在 daemon 域 vs spec 域）已标注区分。
- 模块完整契约见 `.sillyspec/docs/SillyHub/modules/<module>.md`；业务流程见 `flows/*.md`（2026-08-18 修订：6 份既有流程重写 + 新增 spec-incremental-sync / daemon-change-write / mcp-worker-dispatch 三份）。
- 增量小节中的术语同样基于实际代码符号核实；模块卡片未覆盖时以本表与 flows/ 为准。
