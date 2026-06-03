---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# PROJECT.md — SillyHub 项目概述

## 项目名称

**SillyHub**（代码仓库：multi-agent-platform）

## 一句话定位

AI 驱动的多 Agent 协作平台，支持 Agent 编排、SillySpec 文档驱动开发、Worktree 隔离执行，通过 Web UI 进行可视化管理。

## 产品背景

SillySpec 是一套轻量级的项目规范框架，通过 `.sillyspec/` 目录组织变更包、项目组、知识库等内容。SillyHub 将 SillySpec 变更管理规范产品化，让多人、多项目、多 Agent 在统一工作流下协同完成软件全生命周期管理。

SillyHub 填补了 SillySpec 在以下方面的空白：
- **多人协作**：谁在做什么？工作区怎么隔离？
- **流程自动化**：变更的 10 个阶段如何推进？Agent 何时介入？
- **Git 集成**：多人在同一服务器上如何安全操作不同的 Git 身份？
- **可视化**：变更状态、Agent 执行、审计日志如何呈现？

## 项目目标

1. 提供统一的多 Agent 协作平台，用户可以在 Workspace 中管理多个 Agent 执行任务
2. 基于 SillySpec 协议实现文档驱动的变更管理（proposal → design → plan → execute → verify）
3. 支持 Agent 的 Worktree 隔离、Git 操作网关、工具调用策略管控
4. 提供 Web UI 进行工作区管理、变更跟踪、Agent 运行监控

## 技术栈摘要

| 层级 | 技术选型 | 版本                     |
|------|----------|------------------------|
| 后端框架 | FastAPI + Python 3.12 | 0.115+                 |
| ORM | SQLModel（基于 SQLAlchemy 2.0 async） | 0.0.22+                |
| 数据库 | PostgreSQL 16 | 16-alpine              |
| 缓存 | Redis 7 | 7-alpine               |
| 前端框架 | Next.js + React | 14.2.5 / 18.3.1        |
| 前端语言 | TypeScript | 5.5.4                  |
| UI 样式 | Tailwind CSS + shadcn/ui 风格组件 | 3.4.7                  |
| 状态管理 | Zustand + TanStack React Query | 4.5 / 5.51             |
| Agent CLI | Claude Code CLI + SillySpec CLI | 2.1.158 / 3.14.1       |
| 部署 | Docker Compose（单机部署） | —                      |
| 包管理 | 后端 uv / 前端 pnpm | uv 0.4.18 / pnpm 9.6.0 |
| 数据库迁移 | Alembic | 1.13+                  |
| 代码质量 | 后端 Ruff + mypy / 前端 ESLint + TypeScript | —                      |
| 测试框架 | 后端 pytest + pytest-asyncio / 前端 vitest | —                      |
| LLM 代理 | 智谱 API（Anthropic 兼容接口） | glm-5 / glm-5.1        |

## 项目状态

- **阶段**：V1 功能开发中（pre-production）
- **数据兼容**：未正式上线，不需要考虑版本迁移兼容，数据可以清空
- **前置验证**：3 个技术 Spike 全部 PASS（Git 隔离、Workspace 扫描、Claude Code 受控）
- **核心模块**：23 个后端业务模块已实现
- **前端路由**：20+ 页面路由已搭建
- **CI/CD**：backend-ci 和 frontend-ci 流水线就绪

## 子项目关系

```
SillyHub (monorepo)
├── backend/   → FastAPI API 服务（23 个业务模块）
├── frontend/  → Next.js Web UI（App Router）
└── deploy/    → Docker Compose 部署配置
```

- `frontend` 依赖 `backend` 提供的 REST API（通过 HTTP + SSE）
- `backend` 依赖 PostgreSQL（数据持久化）和 Redis（缓存/会话）
- `backend` 内嵌 Claude Code CLI 和 SillySpec CLI 作为 Agent 执行工具
- Docker 部署时前端通过 Next.js rewrite 代理后端 API

## 目标用户

- **项目负责人**：管理多个工作空间和项目组件，追踪变更进度
- **开发者**：通过平台创建变更、查看文档、提交代码、创建 PR
- **AI Agent（Claude Code）**：在 worktree 隔离环境中自动执行编码任务
- **运维人员**：部署和监控 Docker Compose 环境
- **审计人员**：查看 Git 操作审计日志和变更历史

## 开发方法论

项目使用 **SillySpec 文档驱动开发**：
- 所有功能变更必须先有文档（proposal / design / plan）
- 禁止无文档改代码，禁止先写代码再补文档
- 新功能走完整流程：brainstorm → plan → execute → verify
- 小修复走 quick 流程
- 文档存放于 `.sillyspec/changes/` 目录
- 执行顺序：文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收

## 仓库信息

- **仓库地址**：https://github.com/qinyi/multi-agent-platform
- **默认分支**：main
- **CI 流水线**：backend-ci（路径触发 backend/**）、frontend-ci（路径触发 frontend/**）
