---
author: qinyi
created_at: 2026-05-27 09:43:49
---

# INTEGRATIONS

## 数据库和缓存

- PostgreSQL/asyncpg: 后端主数据库。
- Alembic: 数据库迁移。
- Redis: 健康检查和平台缓存预留。

## 文件系统

- 平台读取和写入被管理项目下的 `.sillyspec` 目录。
- Docker compose 将宿主项目目录挂载到 `/workspace`，供扫描器读取。
- worktree 数据目录默认为 `/data/sillyspec-workspaces`。

## 外部命令

- Git: `worktree` / `git_gateway` 通过子进程执行 Git 操作。
- Tool gateway: 通过子进程执行受控工具命令，并记录审计。
- Agent: 文档规划中指向 `claude` CLI 适配器；当前代码包含 `agent/adapters/claude_code.py`。

## 前后端 API

- 前端通过 `NEXT_PUBLIC_API_BASE_URL` 配置 API base。
- `frontend/src/lib/api.ts` 封装 `apiFetch`，各业务 lib 调用 `/api/...`。

## SillySpec 文件约定

- 当前实现深度依赖被管理项目里的 `.sillyspec/projects`、`.sillyspec/docs`、`.sillyspec/changes` 和 `.sillyspec/.runtime`。
- 平台设置页存在 `sillyspec_path` 配置项，但扫描和工作区创建逻辑仍以工作区 root 下的 `.sillyspec` 为核心。
