---
author: qinyi
created_at: 2026-06-04T10:00:00+08:00
---

# Glossary

本项目中的专有术语和定义。

## Agent
在本项目中，Agent 特指 **Claude Code CLI** 的执行实例。不是通用的 LLM Agent，而是 Anthropic 官方 CLI 工具的子进程封装，通过适配器（Adapter）模式管理其生命周期、I/O 和信号传递。

## Change
**变更** — 文档驱动的开发单位。一个 Change 代表一个功能需求或改进任务，包含：
- 工作流阶段（current_stage）
- 关联文档（proposal.md、plan.md、design.md）
- 关联任务（tasks/*.md）
- 状态历史和审计日志

## Workspace
工作区。对应一个被导入的项目，包含 SillySpec 文档和配置。一个 Workspace 关联一个宿主机上的项目目录。

## SpecWorkspace
规格工作区。Workspace 下 SillySpec 配置的具体实例，管理 .sillyspec 目录的初始化和状态。

## Stage
**阶段** — SillySpec 工作流的状态节点。分为：
- **SillySpec 主阶段**：SCAN → BRAINSTORM → PROPOSE → PLAN → EXECUTE → VERIFY → ARCHIVE + QUICK
- **Hub 业务扩展**：DRAFT → REWORK_REQUIRED → ACCEPTED

## Task
任务。Change 下的具体执行步骤，按 Wave 分组。状态: pending → in_progress → completed / failed。

## Wave
波次。Task 的分组单位，同一 Wave 内的任务可并行，Wave 之间按顺序执行。

## AgentRun
**Agent 运行实例** — 一次完整的 CLI 执行记录。包含：
- 规范包（spec_bundle）
- 执行状态（pending/running/completed/failed）
- 关联的日志流（AgentRunLog）
- 工作树租约（可选）

## Worktree
**Git 工作树** — 隔离式分支开发机制。每个需要写操作的 Agent 运行会租用一个独立 worktree，避免污染主工作区。租约机制确保并发安全。

## SSE
**Server-Sent Events** — 后端到前端的单向流式推送。用于 Agent 输出的实时传递，采用 Redis Pub/Sub 解耦 I/O 进程和 HTTP 连接。

## ScanDocument
扫描文档。项目扫描生成的文档: ARCHITECTURE, STRUCTURE, CONVENTIONS, INTEGRATIONS, TESTING, CONCERNS, PROJECT, MODULE_CARDS。

## Module Map
模块映射。项目的结构化索引（_module-map.yaml），记录模块路径、依赖关系、入口点等。

## Tool Gateway
工具网关。管理 Agent 的工具调用策略、权限控制和审计日志。

## Change Writer
变更写入器。Agent 驱动的代码写入模块，负责将 Agent 的输出应用到项目文件。

## Bootstrap
**Spec 引导模式** — 一键启动 SillySpec 流程的快捷方式。在无文档的项目中自动运行 SCAN + BRAINSTORM，快速生成初始文档。

## SpecProfile
规格档案。记录 .sillyspec 目录的清单和状态，用于冲突检测。

## Knowledge
**知识库** — 变更执行过程中沉淀的经验和模式。存储在 `.sillyspec/knowledge/` 下，按类型分类（fix-pattern、design-decision、api-contract 等）。

## QuickLog
**快速日志** — 轻量级变更记录。跳过完整 SillySpec 流程，仅记录变更摘要和影响范围。

## Refresh Token Attack
**Refresh Token 重放攻击** — 安全攻击模式。如果已撤销的 refresh token 被重复使用，系统会撤销该用户的所有会话，强制重新登录。

## Module Impact
**模块影响分析** — 归档阶段自动执行的分析。根据变更涉及的代码路径，更新 `_module-map.yaml` 中的 `used_by` 和 `depends_on` 关系。

## SpecGuardian
**规范守护** — 工作流状态转换的验证层。确保每个阶段只能流向允许的下一阶段（通过 TRANSITIONS 定义），防止非法状态跳转。

## Release
发布。将已归档的变更打包发布的流程，包含审批机制。

## Incident
事件。记录生产环境的问题和事后复盘。
