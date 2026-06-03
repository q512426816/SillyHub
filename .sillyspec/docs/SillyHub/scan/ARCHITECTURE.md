---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# SillyHub (Monorepo Root) — 架构文档

## 技术栈

| 层       | 技术                                        | 版本            |
|----------|---------------------------------------------|-----------------|
| 后端     | Python + FastAPI + SQLModel + PostgreSQL    | 3.12 / 0.115+   |
| 前端     | TypeScript + Next.js + React + Tailwind CSS | 5.5 / 14 / 18   |
| 缓存     | Redis                                       | 7-alpine        |
| Agent    | Claude Code CLI + SillySpec CLI             | 2.1.158 / 3.13  |
| 部署     | Docker Compose                              | postgres:16, redis:7 |
| 构建工具 | uv (后端), pnpm (前端)                       | pnpm 9.6        |

## 架构概览

SillyHub 是一个 **monorepo** 项目，包含三个主要子项目：

```
multi-agent-platform/          # 仓库根
├── backend/                   # FastAPI 后端 API
├── frontend/                  # Next.js 前端 SPA
├── deploy/                    # Docker Compose 部署配置
├── .sillyspec/                # SillySpec 文档驱动开发
├── docs/                      # 设计文档与参考资料
├── spikes/                    # 技术验证原型
├── Makefile                   # 统一开发命令入口
└── CLAUDE.md                  # 项目级开发规则
```

### 架构模式

- **前后端分离**：后端 FastAPI 提供 REST API，前端 Next.js 独立构建，通过 HTTP 通信
- **文档驱动开发 (SillySpec)**：`.sillyspec/` 目录管理变更生命周期（proposal -> design -> plan -> execute -> verify -> archive）
- **Docker Compose 全栈部署**：`deploy/docker-compose.yml` 编排 postgres + redis + backend + frontend
- **模块化后端**：后端按业务领域拆分为独立模块，每个模块包含 model / schema / service / router
- **统一构建入口**：`Makefile` 封装所有开发命令（dev-up、test、lint、up/down）

### 关键设计决策

1. **SillySpec 文档驱动**：所有功能变更必须先有文档（proposal + design + tasks），禁止先写代码再补文档
2. **主机项目挂载**：Docker 部署时通过卷挂载将宿主机项目目录映射到容器内，支持扫描 `.sillyspec` 目录
3. **Agent 集成**：通过 Claude Code CLI 作为 Agent 适配器，支持异步 AgentRun + SSE 流式输出
4. **路径重写**：容器内通过 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 环境变量实现路径映射

## 数据模型（摘要）

> SillyHub monorepo 根本身不定义数据模型，数据模型分散在各子项目中。
> 详见 `.sillyspec/docs/backend/scan/ARCHITECTURE.md` 的数据模型章节。

## 模块划分

| 模块              | 路径                 | 职责                                   |
|-------------------|----------------------|----------------------------------------|
| 后端 API          | `backend/`           | FastAPI REST API，业务逻辑核心         |
| 前端 Web          | `frontend/`          | Next.js SPA，用户界面                  |
| 部署配置          | `deploy/`            | Docker Compose 全栈部署                |
| SillySpec 文档    | `.sillyspec/`        | 变更管理、模块文档、知识库、快速日志   |
| 设计文档          | `docs/`              | 设计分析文档、QA 报告、参考资料        |
| 技术原型          | `spikes/`            | 技术验证（git 隔离、workspace 扫描、Claude Code） |
| 构建入口          | `Makefile`           | 统一开发/测试/部署命令                 |

### SillySpec 目录结构

```
.sillyspec/
├── changes/           # 活跃变更（proposal + design + plan + tasks）
├── docs/              # 模块文档 + 扫描文档
├── knowledge/         # 知识库
├── progress.json      # 当前变更进度
├── projects/          # 项目配置
└── quicklog/          # 开发快速日志
```
