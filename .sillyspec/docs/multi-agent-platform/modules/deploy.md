---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# deploy

## 定位

负责整个 multi-agent-platform 的 Docker Compose 部署编排，包含全栈部署（生产/演示）和仅基础设施部署（本地开发）两套配置。

**负责：**
- Docker Compose 服务编排（postgres / redis / backend / frontend）
- 环境变量管理（`.env` + `.env.example`）
- 卷挂载策略（数据持久化、主机项目目录映射、worktree/spec 数据）
- 健康检查与启动依赖顺序
- Agent CLI 版本固化（Claude Code、SillySpec）

**不负责：**
- 后端/前端各自的 Dockerfile 编写（分别在 `backend/Dockerfile`、`frontend/Dockerfile`）
- CI/CD 流水线
- Kubernetes 或其他编排系统配置

## 契约摘要

1. **全栈部署** (`docker-compose.yml`): 4 个服务 — postgres:16-alpine、redis:7-alpine、backend、frontend
2. **开发模式** (`docker-compose.dev.yml`): 仅 postgres + redis，后端/前端在宿主机本地运行
3. **环境配置** (`.env.example`): 所有可配置项的模板，包括数据库、Redis、后端、Agent CLI、认证、前端
4. **路径映射**: 通过 `HOST_PROJECTS_DIR` / `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 将宿主机项目目录映射到容器内
5. **数据卷**: `pgdata`（数据库）、`redisdata`（缓存）、`spec-data`（spec 工作区）、`worktree-data`（worktree）、`claude-data`（Claude 配置）
6. **认证引导**: `PLATFORM_BOOTSTRAP_ADMIN_*` 环境变量控制首次启动时的管理员创建
7. **凭据加密**: `SILLYSPEC_MASTER_KEY` 用于 SillySpec 凭据加密，必须设置

## 关键逻辑

```
# docker-compose.yml 启动流程
postgres starts → healthcheck (pg_isready) passes
redis starts → healthcheck (redis-cli ping) passes
backend starts → depends_on healthy → alembic upgrade head → uvicorn on :8000
frontend starts → depends_on backend → Next.js on :3000 → proxies API to backend:8000

# 开发模式 (docker-compose.dev.yml)
postgres + redis only → developer runs uvicorn/next dev on host
```

## 注意事项

- `.env` 文件已在 `.gitignore` 中，不要提交包含密钥的 `.env`
- `SILLYSPEC_MASTER_KEY` 和 `SECRET_KEY` 是必需变量，缺失会导致启动失败（使用了 `:?must set` 语法）
- Agent CLI 版本（`CLAUDE_CODE_VERSION`、`SILLYSPEC_VERSION`）在构建时注入，升级需要重新 build
- `HOST_PROJECTS_DIR` 默认值硬编码为 `C:/Users/qinyi/IdeaProjects`，部署到其他机器需要修改
- 后端启动命令内嵌 alembic 迁移（`alembic upgrade head`），确保数据库 schema 总是最新
- 认证引导变量（`PLATFORM_BOOTSTRAP_ADMIN_*`）在首次启动时创建管理员账户
- 修改 `docker-compose.yml` 的服务名或端口后，需同步检查前端 `INTERNAL_API_BASE_URL` 和后端 CORS 配置
- backend 容器通过 `env_file: .env` 加载 Agent 相关配置（ANTHROPIC_*），避免宿主机环境变量污染

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
