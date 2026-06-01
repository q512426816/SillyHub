---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 项目定位

> 最后更新：2026-05-31
> 范围：SillyHub 产品与业务视角

## 1. 一句话定位

SillyHub 是一个将 SillySpec 变更管理规范产品化的多智能体协作平台，让多人、多项目、多 Agent 在统一工作流下协同完成软件全生命周期管理。

## 2. 产品背景

SillySpec 是一套轻量级的项目规范框架，通过 `.sillyspec/` 目录组织变更包、项目组、知识库等内容。但它仅是文件系统层面的约定，缺乏：

- **多人协作**：谁在做什么？工作区怎么隔离？
- **流程自动化**：变更的 10 个阶段如何推进？Agent 何时介入？
- **Git 集成**：多人在同一服务器上如何安全操作不同的 Git 身份？
- **可视化**：变更状态、Agent 执行、审计日志如何呈现？

SillyHub 正是为填补这些空白而构建的平台。它不是重新定义 SillySpec，而是把 `.sillyspec` 的真实目录结构、变更包、项目组组件、运行态和 Git 执行边界，**产品化成可交互的 Web 系统**。

## 3. 目标用户

### 3.1 主要用户

- **项目负责人**：管理多个工作空间和项目组件，追踪变更进度
- **开发者**：通过平台创建变更、查看文档、提交代码、创建 PR
- **AI Agent（Claude Code）**：在 worktree 隔离环境中自动执行编码任务

### 3.2 次要用户

- **运维人员**：部署和监控 Docker Compose 环境
- **审计人员**：查看 Git 操作审计日志和变更历史

## 4. 核心功能

### 4.1 工作空间管理

- 注册和扫描 SillySpec 工作空间
- 识别 `.sillyspec/projects/*.yaml` 定义的子项目/组件
- 维护组件间依赖关系拓扑图
- 多对多关系支持（一个变更可影响多个组件）

### 4.2 变更全生命周期

- **创建变更包**：按 SillySpec 规范生成目录 + MASTER.md + 模板文档
- **10 阶段工作流**：propose → clarify → brainstorm → plan → review → execute → verify → approve → archive → close
- **阶段自动推进**：FSM 状态机 + SpecGuardian 文档完整性校验
- **归档管理**：完成的变更自动归档到 `.sillyspec/changes/archive/`

### 4.3 Agent 调度

- Claude Code 子进程管理，首发适配
- worktree 隔离执行环境（每人/每变更独立工作树）
- 实时日志流（SSE）回传前端
- 上下文构建器为 Agent 注入 SillySpec 知识

### 4.4 Git 操作审计

- 白名单操作（status/diff/add/commit/push/pull/fetch/log/branch/checkout/merge/rebase）
- 受保护分支保护（禁止 force push main/master）
- Shell 注入防护
- 输出脱敏（PAT/Bearer token 自动遮蔽）
- 全量审计日志

### 4.5 认证与权限

- JWT 认证 + RBAC 角色体系
- Git Identity 管理（多用户多 Git 身份）
- 凭据加密存储（libsodium secretbox）
- Admin 引导程序（首次启动自动创建管理员）

## 5. 业务价值

### 5.1 对开发者

- 不需要记忆 SillySpec 的目录结构约定，平台自动生成
- 变更包一键创建 + 模板文档批量生成
- Agent 自动执行编码任务，人工审核结果

### 5.2 对团队

- 多人在同一服务器上安全协作，Git 身份和工作区完全隔离
- 变更状态透明可见，不会出现"谁在改什么"的混乱
- 完整审计日志满足合规需求

### 5.3 对 Agent 工作流

- 标准化的 10 阶段变更流程，Agent 知道"现在该做什么"
- 文档即状态的核心理念，Agent 的产出直接写入 SillySpec 文档
- 可观测的执行过程，实时查看 Agent 输出

## 6. 与同类产品的差异

| 维度 | SillyHub | GitHub Projects | Linear |
|------|----------|----------------|--------|
| 规范驱动 | SillySpec 内建 | 无 | 无 |
| Agent 集成 | Claude Code 原生 | Copilot | 无 |
| 变更包 | 文件系统 + DB 双写 | Issue + PR | Issue |
| Git 隔离 | worktree + 身份管理 | fork/branch | 无 |
| 自托管 | Docker Compose 单机 | SaaS | SaaS |

## 7. 当前阶段

项目处于 **V1 功能开发后期**：

- V0 Spikes 已全部通过（Git 隔离、工作空间扫描、Claude Code 子进程可控性）
- 核心模块 20+ 已实现（auth、workspace、change、agent、git_gateway、workflow 等）
- 前端基础 UI 已搭建（App Router + shadcn/ui + TanStack Query）
- CI/CD 流水线就绪（backend-ci / frontend-ci）
- 正在完善 Agent 调度和变更工作流的深度集成
