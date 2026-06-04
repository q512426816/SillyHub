---
schema_version: 1
doc_type: module-card
module_id: deploy
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# deploy

## 定位
负责 Docker Compose 容器化部署配置，不负责应用代码实现。

提供两种部署模式：
- **dev-only** (docker-compose.dev.yml): 仅启动 Postgres + Redis，应用代码在宿主机运行，适合开发迭代
- **full-stack** (docker-compose.yml): 启动完整栈 (db + redis + backend + frontend)，适合演示/生产

边界：
- 包含：容器编排、服务依赖、健康检查、数据卷、环境变量注入
- 不包含：Docker 镜像构建逻辑（在 backend/Dockerfile 和 frontend/Dockerfile）
- 不包含：数据库迁移脚本（在 backend/alembic/）

## 契约摘要

### Compose 文件
| 文件 | 用途 | 服务 |
|------|------|------|
| docker-compose.yml | 完整部署 | postgres, redis, backend, frontend |
| docker-compose.dev.yml | 开发依赖 | postgres, redis |

### 环境变量模板
`.env.example`: 所有容器的环境变量模板，包含 Postgres/Redis/Backend/Frontend 配置项

### 核心服务配置
- **Postgres**: 16-alpine，健康检查 pg_isready，数据卷 pgdata
- **Redis**: 7-alpine，AOF 持久化，健康检查 redis-cli ping，数据卷 redisdata
- **Backend**: 构建自 backend/Dockerfile，依赖 postgres/redis 健康后启动，挂载项目目录供 Agent 扫描
- **Frontend**: 构建自 frontend/Dockerfile，依赖 backend 启动，端口 3000

### 数据卷
- pgdata, redisdata, spec-data, worktree-data, claude-data

## 关键逻辑

```
启动流程:
1. postgres/redis 并发启动
2. 等待 healthcheck 通过 (pg_isready / redis-cli ping)
3. backend 构建 -> 依赖 db 健康启动 -> 执行 alembic upgrade head -> 启动 uvicorn
4. frontend 构建 -> 依赖 backend 启动 -> 启动 Next.js

开发模式:
1. 仅启动 postgres/redis (暴露 5432/6379 到宿主机)
2. Backend 在宿主机运行 (make backend-run) 连接本地 5432/6379
3. Frontend 在宿主机运行 (make frontend-run) 连接本地 8000

环境变量注入:
- .env 通过 env_file 注入到 backend/frontend
- 容器内 DATABASE_URL/REDIS_URL 覆盖宿主机连接串
```

## 注意事项

1. **路径挂载**: `HOST_PROJECTS_DIR` 和 `HOST_PATH_PREFIX` 必须匹配宿主路径，否则 Agent 扫描失败
2. **健康检查超时**: 默认 5s interval / 3s timeout / 20 retries，适应冷启动慢的网络环境
3. **数据持久化**: 删除容器后数据仍保留在卷中，执行 `docker compose down -v` 才会清空
4. **端口冲突**: 默认端口 (3000/5432/6379/8000) 可能与宿主机冲突，需通过 .env 调整
5. **密钥管理**: .env.example 中的占位密钥不可用于生产，SECRET_KEY 和 SILLYSPEC_MASTER_KEY 必须替换
6. **前端 API 地址**: `NEXT_PUBLIC_API_BASE_URL` 决定浏览器向哪里发请求，`INTERNAL_API_BASE_URL` 决定容器内 SSR 向哪里发请求

### 同步检查模块
- 修改端口/环境变量时需检查: `backend/app/main.py` (CORS), `frontend/next.config.js` (rewrites)
- 修改挂载路径时需检查: `backend/app/modules/agent/scanner.py` (路径重写逻辑)

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
