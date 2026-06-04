---
author: qinyi
created_at: 2026-06-04T08:54+08:00
---

# SillyHub (multi-agent-platform) 架构文档

## 技术栈

### 后端
- **框架**: FastAPI + Python 3.12
- **数据层**: SQLModel (ORM) + PostgreSQL 16
- **缓存**: Redis 7
- **迁移**: Alembic
- **依赖管理**: uv

### 前端
- **框架**: Next.js 14 + React 18
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **包管理**: pnpm

### 基础设施
- **部署**: Docker Compose
- **数据库**: PostgreSQL 16
- **缓存**: Redis 7
- **开发工具**: Makefile 统一管理命令

## 架构概览

### 系统结构

```
┌─────────────────────────────────────────────────────────────┐
│                     前端 (Next.js)                          │
│  工作区管理 / 变更追踪 / Agent 运行 / 审批流程                │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST API
┌────────────────────┴────────────────────────────────────────┐
│                   后端 (FastAPI)                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 模块层 (app/modules/)                                 │  │
│  │ - auth          用户认证与 RBAC                       │  │
│  │ - workspace     工作空间管理                          │  │
│  │ - change        变更请求管理                          │  │
│  │ - task          任务执行管理                          │  │
│  │ - agent         Agent 运行与协调器                     │  │
│  │ - git_gateway   Git 操作网关                           │  │
│  │ - git_identity  Git 凭证管理                          │  │
│  │ - worktree      Worktree 租约管理                     │  │
│  │ - tool_gateway  工具操作日志                           │  │
│  │ - scan_docs     扫描文档存储                          │  │
│  │ - workflow      变更审批与审计日志                     │  │
│  │ - incident      事故与复盘                             │  │
│  │ - release       发布管理                               │  │
│  │ - spec_workspace  SillySpec 工作空间                  │  │
│  │ - spec_profile    SillySpec 配置档案                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 核心层 (app/core/)                                    │  │
│  │ - db          数据库连接与会话管理                    │  │
│  │ - redis       Redis 客户端                            │  │
│  │ - config      配置管理                                 │  │
│  │ - security    JWT 与密码哈希                           │  │
│  │ - errors      统一异常处理                             │  │
│  │ - logging     结构化日志                               │  │
│  │ - telemetry   OpenTelemetry 集成                      │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────┐
│  PostgreSQL          │          Redis                       │
│  业务数据持久化       │          缓存与分布式锁                │
└─────────────────────────────────────────────────────────────┘
```

### 数据流

1. **前端 → 后端**: RESTful API 通信，所有请求通过 `/api` 前缀
2. **认证流程**: 用户登录获取 JWT Token，每次请求携带 Bearer Token
3. **Agent 执行**: Agent 通过 Claude Code CLI 调用，通过 worktree 租约机制隔离工作目录
4. **Git 操作**: 统一通过 git_gateway 模块，记录操作日志并支持权限控制
5. **变更审批**: workflow 模块管理变更审批流程，记录审计日志

## 数据库 Schema

### 核心业务表

| 表名 | 说明 | 字段数 |
|------|------|--------|
| users | 用户账户 | 10+ |
| sessions | 会话管理 | 8 |
| roles | 角色定义 | 6 |
| role_permissions | 角色-权限关联 | 3 |
| user_workspace_roles | 用户-工作空间角色 | 4 |

### 工作空间与组件

| 表名 | 说明 | 字段数 |
|------|------|--------|
| workspaces | 工作空间主表 | 12 |
| workspace_relations | 工作空间关系图 | 7 |
| project_components | 项目组件 | 8 |
| component_relations | 组件依赖关系 | 6 |

### 变更管理

| 表名 | 说明 | 字段数 |
|------|------|--------|
| changes | 变更请求 | 18+ |
| change_documents | 变更文档 | 10+ |
| change_workspaces | 变更-工作空间关联 | 4 |
| change_reviews | 变更审批记录 | 8 |
| tasks | 任务 | 20+ |
| task_workspaces | 任务-工作空间关联 | 4 |

### Agent 与执行

| 表名 | 说明 | 字段数 |
|------|------|--------|
| agent_runs | Agent 运行记录 | 25+ |
| agent_run_logs | Agent 运行日志 | 8 |
| agent_run_workspaces | Agent 运行-工作空间关联 | 4 |
| worktree_leases | Worktree 租约 | 9 |

### Git 与工具

| 表名 | 说明 | 字段数 |
|------|------|--------|
| git_identities | Git 凭证 | 13 |
| git_operation_logs | Git 操作日志 | 8 |
| tool_operation_logs | 工具操作日志 | 8 |
| tool_policies | 工具访问策略 | 9 |

### 其他模块

| 表名 | 说明 | 字段数 |
|------|------|--------|
| scan_documents | 扫描文档 | 10+ |
| incidents | 事故记录 | 10 |
| postmortems | 复盘报告 | 10 |
| releases | 发布记录 | 12 |
| release_approvals | 发布审批 | 8 |
| audit_logs | 审计日志 | 7 |
| spec_workspaces | SillySpec 工作空间 | 12 |
| spec_profile_manifests | SillySpec 配置档案 | 8 |
| spec_conflicts | SillySpec 冲突记录 | 7 |
| platform_settings | 平台配置 | 6 |

## API 路由结构

所有 API 统一挂载在 `/api` 前缀下：

- `/health` - 健康检查
- `/auth` - 认证（登录/刷新/登出）
- `/workspaces` - 工作空间管理
- `/workspaces/{id}/changes` - 变更管理
- `/workspaces/{id}/tasks` - 任务管理
- `/workspaces/{id}/agent` - Agent 执行
- `/git` - Git 操作网关
- `/git/identities` - Git 凭证管理
- `/worktree` - Worktree 租约
- `/leases` - 租约管理
- `/scan-docs` - 扫描文档
- `/workflow` - 审批流程
- `/incidents` - 事故管理
- `/releases` - 发布管理
- `/tool-gateway` - 工具操作
- `/tool-policies` - 工具策略
- `/archive` - 归档操作
- `/settings` - 平台配置
- `/spec-workspaces` - SillySpec 工作空间

## 关键设计模式

1. **租约隔离**: Agent 执行时通过 worktree_lease 获取独立工作目录，避免冲突
2. **权限控制**: 基于 RBAC 模型，支持角色定义和权限细粒度控制
3. **审计追踪**: 关键操作记录 audit_log，支持合规审计
4. **变更审批**: 变更请求支持多阶段审批流程，记录审批意见和决策
5. **工具隔离**: 工具操作通过 tool_gateway 统一管理，支持策略控制和日志记录
