---
author: qinyi
created_at: 2026-06-10T17:00:06
---

# 项目概览 — multi-agent-platform

## 项目简介

**multi-agent-platform** 是一个多 Agent 协作平台，旨在为团队提供统一的 AI Agent 管理和编排能力。平台包含以下核心能力：

- **工作区管理**: 注册和管理多个项目工作区，支持工作区间的组件关系拓扑
- **AI Agent 编排**: 通过 Claude Code 等 Agent 执行代码生成、扫描、变更等任务
- **文档驱动开发**: 集成 SillySpec，支持文档驱动的变更管理流程
- **Daemon 运行时**: 本地 Daemon 进程支持远程任务执行，自动检测本地 AI Agent
- **变更管理**: 完整的变更生命周期管理（创建、审批、发布、归档）
- **RBAC 权限**: 基于角色的访问控制，支持工作区级别的权限绑定

项目目前处于 **V1 开发阶段**，未正式上线，不考虑版本兼容问题。

## 技术栈

| 子项目 | 核心技术 | 语言 |
|--------|---------|------|
| **Backend** | FastAPI + SQLModel + asyncpg + Redis | Python 3.12 |
| **Frontend** | Next.js 14 + React 18 + Tailwind CSS + Zustand | TypeScript 5.5 |
| **Daemon** | Click + httpx + websockets | Python 3.12 |
| **基础设施** | Docker Compose (PostgreSQL 16 + Redis 7) | YAML |
| **Agent 集成** | Claude Code CLI + SillySpec CLI | Node.js |

## 项目结构

Monorepo 结构，包含 3 个子项目 + 1 个编排目录：

- `backend/` — FastAPI REST API，22 个业务模块，33 个数据库表
- `frontend/` — Next.js SPA，App Router 架构
- `sillyhub-daemon/` — 独立 CLI 工具，5 种协议后端，12 个 Agent Provider 检测
- `deploy/` — Docker Compose 编排

## 开发流程

项目使用 **SillySpec 文档驱动开发**，流程为：

1. `sillyspec brainstorm` — 需求分析和方案设计
2. `sillyspec plan` — 拆解实现计划
3. `sillyspec execute` — 代码实现
4. `sillyspec verify` — 验收验证

小修复使用 `sillyspec quick` 快速通道。

## 关键模块

| 模块 | 说明 | 复杂度 |
|------|------|--------|
| agent | AI Agent 运行管理，含 Claude Code 适配器 | 高 (71KB service) |
| daemon | Daemon 运行时注册和任务租约 | 中 |
| workspace | 工作区注册/拓扑/关系管理 | 中 |
| change | 变更生命周期管理 | 中 |
| spec_workspace | SillySpec 工作区数据管理 | 低 |
| auth | JWT 认证 + RBAC 权限 | 中 |
| workflow | 审批流 + 审计日志 | 低 |

## 部署方式

```bash
# 全栈 Docker Compose 部署
cd deploy
cp .env.example .env  # 编辑 .env 配置
docker compose up --build

# 或使用 Makefile
make up
```

服务端口：
- Frontend: 3000
- Backend: 8000
- PostgreSQL: 5432
- Redis: 6379

## 数据统计

- 后端模块: 22 个
- 数据库表: 33 个
- Alembic 迁移: 20 个版本
- 后端测试文件: ~30 个
- 前端测试文件: 3 个
- Daemon 测试文件: 17 个
- 前端 API 模块: ~27 个 lib 文件
