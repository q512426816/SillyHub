---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 项目概览

## 1. 项目目标

SillyHub 是一个**多 Agent 协作平台**的后端 API 服务，旨在提供一个完整的变更管理 + 代码执行 + AI Agent 编排的系统。

核心目标：

- **规范变更流程**：通过 10 阶段工作流引擎，将需求从 draft 到 archived 全生命周期管理
- **安全 Agent 调度**：以 worktree 租约为隔离单位，调度 Claude Code 等 AI Agent 执行代码变更
- **细粒度权限控制**：基于 RBAC 的 workspace 级权限体系，支持 platform admin 超级角色
- **可审计**：所有数据变更自动记录审计日志，支持变更追溯

## 2. 项目范围

### 2.1 核心边界

- **管理平台**：多 workspace 管理、用户认证授权、变更流程编排
- **Agent 编排**：Claude Code 子进程调度、上下文注入、进度流推送、结果收集
- **代码安全执行**：Git 凭证加密、worktree 租约隔离、命令白名单、输出脱敏
- **知识管理**：扫描文档解析、知识库/快速日志、spec workspace 管理
- **运维支持**：发布管理、事件管理、健康检查

### 2.2 不在范围内（V1）

- 多 Agent 框架（仅 Claude Code）
- 实际部署执行（deploy 记录管理，不执行实际部署）
- 真正的分布式任务队列（当前 fire-and-forget）
- OpenTelemetry 完整集成（V1 为 stub）
- MFA 多因素认证
- 实时协作（WebSocket）

## 3. 主要功能列表

### 3.1 认证与授权 (auth)

- JWT access/refresh token 双令牌体系
- bcrypt 密码哈希（cost 12）
- RBAC 角色权限：platform:admin, workspace:read/write/admin, change:create/read/update/approve 等
- User → Role → Permission 三级授权
- platform_admin 超级角色绕过所有权限检查
- 首次启动自动 seed admin 用户和 RBAC 角色

### 3.2 Workspace 管理 (workspace)

- Workspace CRUD（root_path, slug, status）
- 前端框架检测（scanner.py）
- Workspace 间关系拓扑管理（relation_service, topology）
- 多对多关联：workspace ↔ task, workspace ↔ agent_run

### 3.3 变更工作流引擎 (change + workflow)

- 10 阶段状态机：draft → clarifying → design_review → ready_for_dev → in_dev → technical_verification → business_review → accepted → archived
- rework_required 回退阶段
- ChangeDocument 管理（设计文档、分析文档等）
- Spec Guardian 自动校验
- AuditLog 自动审计

### 3.4 任务管理 (task)

- 7 阶段 Task FSM：draft → ready → in_progress → review → done
- Task 与 Change 关联
- Stage dispatch：根据 Change 阶段自动分派 Agent 任务

### 3.5 Agent 调度 (agent)

- Claude Code CLI 作为唯一适配器（可扩展）
- fire-and-forget 执行模型
- 三层 session 隔离：进程级、租约级、用户级
- AgentSpecBundle 上下文构建（CLAUDE.md + spec docs）
- 执行协调器：幂等性、乐观锁、上下文指纹、恢复令牌、检查点
- Redis pub/sub 进度推送
- DiffCollector 文件变更收集

### 3.6 Worktree 管理 (worktree)

- 租约式 worktree 生命周期：acquire → extend → release → GC
- ExecEnv 构建器：环境变量注入、凭证挂载
- GitRunner：封装 git 命令执行

### 3.7 Git 集成 (git_gateway + git_identity)

- Git 操作白名单：status, diff, add, commit, push 等
- 危险命令黑名单：--force, --clean, reset --hard 等
- GitIdentity 凭证加密存储（PyNaCl）
- GitHub provider 支持 access check
- 输出自动脱敏（redact_output）

### 3.8 工具网关 (tool_gateway)

- ToolPolicy：workspace 级工具执行策略
- 7 种工具类型：file_read/write/list/search, shell_exec, run_tests, http_get
- 约束控制：allowed_tools, blocked_commands, path 限制, resource limits
- 网络策略：IP 白名单、域名白名单

### 3.9 发布管理 (release)

- 发布生命周期：draft → staging → approved → deploying → deployed → rolled_back
- 部署窗口：默认 Mon-Fri 10:00-18:00 UTC
- 多审批人门禁（默认 2 人）
- staging / production 环境分离

### 3.10 事件管理 (incident)

- 事件生命周期：open → investigating → mitigated → resolved
- 4 级严重度：low, medium, high, critical
- Postmortem 创建与知识蒸馏

### 3.11 知识与文档 (knowledge + scan_docs + spec_workspace)

- Knowledge / Quicklog：只读服务，从文件系统解析
- ScanDocument：扫描文档解析与管理
- SpecWorkspace：spec 空间 CRUD + 同步状态

### 3.12 辅助功能

- **health**：健康检查端点
- **settings**：平台设置管理
- **runtime**：`.sillyspec/.runtime/` 文件解析
- **archive**：完成变更归档 + 知识摘要生成
- **change_writer**：Markdown 变更文档构建器
- **spec_profile**：Spec 配置文件策略

## 4. 业务价值

1. **可追溯性**：变更从需求到代码到发布的完整链路追踪
2. **安全性**：凭证加密、命令白名单、租约隔离、RBAC 权限
3. **自动化**：Agent 自动执行代码变更，减少人工操作
4. **合规性**：审计日志、审批流程、部署窗口控制
5. **可扩展性**：模块化架构支持快速添加新功能模块
