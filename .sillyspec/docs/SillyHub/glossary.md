---
author: qinyi
created_at: 2026-06-24T01:46:42
source_commit: ba87eec
---
# Glossary

本术语表收录 SillyHub（多智能体协作管理平台 / SillySpec 产品化）项目内专有术语的**项目特殊含义**，基于实际代码（`backend/app`、`frontend/src`）与 `.sillyspec/docs/SillyHub/modules/*` 模块卡片用法整理，不抄通用字典定义。

---

## SillySpec 规范体系

### SillySpec
本项目产品化的对象——一套「文档驱动开发」方法论。SillyHub 把它的 `brainstorm → plan → execute → verify → archive` 流程做成 Web 平台。权威运行时状态存于工作区 `.sillyspec/.runtime/sillyspec.db`（SQLite）。

### workspace（工作区）
SillyHub 的**核心组织单元**。一个 Git 仓库/代码目录对应一个 workspace 实体（`Workspace` 表：root_path/slug/component_key/parent_id）。几乎所有业务（change/task/worktree/agent）都以 `workspace_id` 为上下文根。父子组件模型让 monorepo 子包也能成为独立工作区，共享 spec 规范又各自隔离执行。

### spec 空间 / spec workspace（spec-workspace）
把「一个代码目录」变成「一个 spec 工作流实例」的桥梁。`SpecWorkspace` 表与 workspace 1:1 关联，决定 spec 文件存哪（平台托管目录 vs repo 内）、怎么同步、是否合法。三种同步策略适配不同项目管理方式。

### spec profile（spec 清单）
定义「这套规范要求哪些阶段（stages）、哪些文档（documents）、哪些门禁（gates）、agent 拿什么契约（agent_contracts）」。多 profile 在同一工作区叠加时由 `spec_profile` 模块做 stage/document 级冲突检测，落 `SpecConflict` 表。换 profile 即换工作流形态，无需改代码。

### change（变更）
SillySpec 变更工作流的核心实体。对应工作区 `.sillyspec/changes/<change-key>/` 目录，承载一次完整改动。有阶段流转（current_stage）、文档矩阵、人工 gate、进度同步、反馈、归档门槛。是 change_writer（生成）与 archive（归档）的桥梁，也是 agent 派发的上游。

### 变更文档矩阵（proposal / design / plan / tasks / requirements）
一份变更下按 SillySpec 模板组织的 markdown 文档集：
- **proposal** —— 变更提案（动机/范围）
- **requirements** —— 需求清单
- **design** —— 技术方案设计
- **plan** —— 实现计划（Wave 分组 + Task 列表 + 依赖关系）
- **tasks** —— 任务定义（`tasks/<task-key>.md`，frontmatter 含依赖/阻塞/优先级/影响组件）

由 `change_writer.markdown_builder` 按模板生成，由 `change.ChangeParser` 解析入库。文件是 source of truth。

### 变更阶段（stage / current_stage）
变更的生命周期阶段，取值如 `draft → brainstorm → plan → execute → verify → archive → archived`（终态 `archived`/`cancelled`）。流转由 `change.transition` 触发，`workflow` 模块用 FSM 约束合法转换，`spec_guardian` 在关键转换前跑前置文档守卫。阶段切换会触发 `SillySpecStageDispatchService.auto_dispatch_next_step` 自动派发 agent 执行。

### task（任务）
变更（Change）下的**可执行单元**，对应 `.sillyspec/changes/<change-key>/tasks/<task-key>.md`。定义写在 frontmatter。本模块只解析/落库/编排，是 spec 文档管理链路的「任务索引层」。有独立的状态机（workflow 模块）和看板视图（按 status 分组）。

### scan / scan-docs（文档扫描）
把工作区 `.sillyspec/docs/` 下的模块卡片、知识、组件文档等 markdown 解析成结构化 `ScanDocument` 行，供前端展示、模块影响分析、归档蒸馏使用。是「只读索引层」：不写文件，只读 + 解析 + 持久化 + 对账。与 task.parser、knowledge.parser 共同构成 spec 三大解析器，由 `workspace.reparse` 统一编排。

### knowledge / quicklog（知识 / 快日志）
工作区 `.sillyspec/knowledge/` 与 `.sillyspec/quicklog/` 下的 markdown 知识条目，作为变更沉淀的可复用经验库。`knowledge` 模块是**只读消费侧**（list/get）；**生成**由 `archive.distill_knowledge` 从已完成变更蒸馏完成。

### archive（归档）
变更工作流的**收尾环节**：把已完成的 SillySpec 变更从 active 区移动到 archive 区，并从变更内容中蒸馏出可复用 knowledge 写入 `.sillyspec/knowledge/`。前置校验 `ChangeNotArchivable`（变更未达可归档状态）。衔接 change 与 knowledge 两个功能域。

### runtime 进度（SillySpec 运行时进度）
后端 `runtime` 模块以**只读方式**读取工作区 `.sillyspec/.runtime/` 状态文件，对外暴露 SillySpec CLI 的执行进度（阶段 stages）、用户输入快照、产出物（artifacts）。它不执行 SillySpec，只把本地 CLI 产出的状态（sillyspec.db SQLite，`mode=ro` 只读连接）翻译成结构化 API。

---

## 执行与编排

### agent run（智能体运行 / AgentRun）
把一次 SillySpec 阶段执行（stage dispatch）或独立任务派发成的一条 `AgentRun` 记录，落到在线 daemon 上执行。由 `AgentService.start_run` 创建，经 `RunPlacementService` 选择在线 daemon。含幂等/断点续跑（`ExecutionCoordinatorService`：fingerprint/resume_token/checkpoint）、审批、日志流、工具失败监控。是连接「变更工作流」与「本地 daemon 执行」的中枢。

### mission（任务协同）
一次 agent 执行可派发多个 worker 协同完成的组织单位（`AgentMission` + `AgentRunDependency`）。`MissionService`/`MissionControlService` 管 mission 生命周期，`derive_status` 聚合 worker 状态，`can_dispatch_worker` 做并发/成本预算校验。`MissionExecutionService` 负责单 worker 执行。

### daemon（本地守护进程）
跨组件「本地执行交互」功能域，由两部分构成：
- **backend daemon 模块** —— 调度与状态权威（注册/心跳/租约/会话/WebSocket Hub）
- **sillyhub-daemon**（Node ESM 进程）—— 执行体，承载 claude-agent-sdk 实际执行

两者经 WebSocket + REST 双向通信。支持**批处理 lease** 与**交互式会话**两种执行模式。

### runtime（daemon runtime，运行时会话/守护实例）
daemon 域中的概念：一个注册到 backend 的本地 daemon 进程实例（`DaemonRuntime` 表），是「在线 daemon」判定与任务派发的目标。注意区别于上面的「runtime 进度」（SillySpec 运行时进度）——两者同名但分属 daemon 域与 spec 域。`NoOnlineDaemonError` 表示无可用 runtime 接任务。

### lease（任务租约 / DaemonTaskLease）
批处理执行模式下，daemon 领取任务的凭证机制。`DaemonLeaseService` 提供 claim_task/heartbeat_lease/expire_overdue_leases/cancel_lease，claim_token 鉴权。`TaskRunner`（Node 端）按 lease 执行批处理任务。

### interactive session（交互式会话）
与批处理 lease 并列的另一种 daemon 执行模式。`SessionService` 管理 create_session/inject_session/interrupt_session/end_session/recover_session_after_daemon_restart，支持 SSE 流式（`/sessions/{id}/stream`）、权限请求响应、对话框（dialogs）。Node 端由 `interactive/`（claude-sdk-driver、session-manager、input-queue、permission-resolver、session-store-persistence）支撑。`RecoveryCoordinator` 负责 daemon 重启后会话收敛。

### worktree（git 工作树 / WorktreeLease）
为 agent 执行提供隔离 Git 工作树的**租赁管理**。每个 lease 对应一个独立目录（从 bare repo 检出分支），agent 在其中安全执行代码操作，完成后 release 回收。`GitRunner`（clone_bare/worktree_add/remove）+ `ExecEnvBuilder`（.gitconfig + askpass 凭据注入）。lease 过期 GC 防崩溃泄漏。是「多 agent 并发改同一仓库不互相踩」的物理底座。

---

## 安全与网关

### tool gateway（工具网关）
agent 执行工具操作的「安全网关 + 策略引擎」。所有 agent 对文件系统、Shell、HTTP 的操作都经此模块，受 `ToolPolicy`（工具白名单 / 命令黑名单 / 域名白名单 / SSRF 防护）约束，操作范围绑定 `WorktreeLease`，全程写双份审计（`ToolOperationLog` + `AuditLog`）并脱敏。7 种工具：file_read/file_write/file_list/file_search/shell_exec/run_tests/http_get。前端 permission-approval-dialog 展示 pending 请求，管理员 approve/reject 后放行。

### git gateway（git 操作网关）
在 worktree lease 上下文内代用户执行受控 git 操作（status/log/diff/commit 等白名单），记录操作日志，自动用用户配置的 git 身份署名。把分散的 git 命令收敛到统一受审计入口，避免直接 shell 裸跑。

### git identity（git 身份/凭证）
管理用户的 git 提交身份（name/email）与 PAT 等访问凭证。凭证经 `core.crypto` 对称加密落库（`GitIdentity` 表：带 key_id 的加密 PAT + provider 类型）。通过 provider（GitHubProvider 等）校验凭证对目标仓库的访问权限。为 git_gateway 署名、worktree 拉取私有仓库提供身份与凭证来源。

### spec transport（spec 传输）
spec_workspace 与文件系统之间的同步机制概念。spec 文件可落在平台托管目录或 repo 内，三种同步策略（strategy）适配不同项目管理方式，由 `spec_workspace.sync` 触发。

---

## 平台基础设施

### RBAC（权限模型）
平台「用户/角色/组织」权限体系。权限分平台级 + 工作空间级，按 `Permission(StrEnum)` 枚举全部权限点，归入 AUDIT/WORKSPACE/PLATFORM/ADMIN/CHANGE/AGENT/PPM 等组。`core.auth_deps` 的 FastAPI 依赖项把权限校验注入所有受保护端点。`rbac.collect_permissions*` 按工作空间范围聚合权限。

### audit log（审计日志）
append-only 的操作审计记录（`AuditLog` 表）。`core.audit_hooks` 捕获所有 `BaseModel(table=True)` 数据变更自动写入。workflow 模块的状态转换、tool_gateway/git_gateway 的操作都写审计，形成完整流程追溯链。

### incident / postmortem（事件 / 复盘）
运营域的**生产事件记录与事后复盘**（`Incident` + `Postmortem` 一对一）。记录标题、严重度、状态、时间线，复盘文档含原因、影响、改进项。与 SillySpec 变更工作流解耦，仅依赖 core/models 基础设施。

### release（发布）
发布与审批域：管理一次发布（`Release`）的创建、多角色审批（`ReleaseApproval`，满足审批阈值才放行）、环境晋升（promote to staging）、部署（deploy，受部署窗口策略 `check_deploy_window` 校验）、回滚（rollback）。

---

## 独立业务子系统

### ppm（项目管理）
SillyHub 内嵌的**独立项目管理子系统**（从 dept_project_back/ppdmq-module-ppm 全量复刻），与 spec 工作流并行。跨 backend（5 子域：project/plan/task/problem/kanban，约 102 路由）+ frontend（`(dashboard)/ppm/*` 独立入口 + lib/ppm 客户端 + ppm-* 组件）。覆盖项目→计划→任务→问题→看板全链路。看板的「人员×日期矩阵」布局是特色。复用平台 auth/audit/settings 但业务自成体系，前端 `/ppm` 与主平台菜单完全隔离。

### 问题变更流（ProblemStatus / 4 节点审批流）
ppm 中问题的状态机：Node10/20/30/40 四节点审批流（`ProblemNode`）。`ProblemChangeStatus` 构成版本链。

### 里程碑明细状态机（PlanNodeDetailStatus）
ppm 中里程碑明细的状态枚举：`draft → review → approve → done`。

---

## 注

- 本表术语取自实际代码符号（表名/类名/服务名）与模块卡片定位，同名异义处（如 runtime 在 daemon 域 vs spec 域）已标注区分。
- 模块完整契约见 `.sillyspec/docs/SillyHub/modules/<module>.md`。
