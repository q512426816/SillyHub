---
schema_version: 1
doc_type: module-card
module_id: deploy
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# deploy

## 定位

multi-agent-platform 的一体化部署编排组件，用 Docker Compose 把 backend、frontend、PostgreSQL、Redis 拉成一套可运行的服务栈。是开发联调与（未来）生产部署的统一入口，定义了各组件的容器化方式、网络、端口、数据卷、健康检查与环境配置。聚合依赖 backend、frontend（也间接含 sillyhub-daemon 的分发物），被 ci/build 引用。

技术栈：Docker、Docker Compose、PostgreSQL 16-alpine、Redis 7-alpine；各子项目自带 Dockerfile（backend/Dockerfile、frontend/Dockerfile）。

## 契约摘要

- **核心产物**：`docker-compose.yml`（主编排）+ `docker-compose.dev.yml`（开发覆写，仅 postgres/redis）+ `.env`/`.env.example`（环境变量模板）。
- **服务定义**（主 compose）：
  - `postgres`（postgres:16-alpine，healthcheck pg_isready，卷 pgdata）
  - `redis`（redis:7-alpine，appendonly 持久化，healthcheck redis-cli ping，卷 redisdata）
  - `minio`（minio/minio，S3 兼容对象存储，端口 9000/9001，卷 minio-data；平台文件中心后端，`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` 默认 minioadmin）
  - `backend`（build 自 backend/Dockerfile，env_file 加载，depends_on postgres/redis/minio(healthy)，暴露端口；environment 注入对象存储 `STORAGE_BACKEND`/`S3_ENDPOINT`(默认 `http://minio:9000`)/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`，凭证须与 minio 服务一致）
  - `frontend`（build 自 frontend/Dockerfile，depends_on backend，env_file，端口 3000）
  - 命名卷：pgdata、redisdata、minio-data、worktree-data、claude-data。
- **健康检查**：postgres/redis 用原生探测；backend/frontend 容器自带 healthcheck（frontend 用 node20 内置 fetch 零依赖）。

## 关键逻辑

- **依赖拓扑**：backend 等 postgres/redis 健康；frontend 等 backend；数据用命名卷持久化，重建容器不丢数据（项目允许清空）。
- **环境分离**：`.env.example` 是变量清单（DB/Redis 连接、密钥、daemon 相关、端口映射、HOST_PROJECTS_DIR/HOST_PATH_PREFIX 等），`.env` 为实际值；dev compose 覆写开发态配置。
- **数据卷语义**：worktree-data 给 worktree 隔离用，claude-data 给 Agent SDK 运行时数据用。
- **挂载模型**：backend 容器挂载宿主项目目录供 Agent 扫描，路径需与 HOST_PROJECTS_DIR/HOST_PATH_PREFIX 对齐。

## 注意事项

- backend 容器跑镜像内代码、不挂载源码、不热重载，改后端源码必须 rebuild backend 镜像再验新端点。
- frontend 容器 healthcheck 曾因 busybox wget 走 Docker 注入 http_proxy 误报 unhealthy（忽略 no_proxy），现已改 node fetch，服务正常即应判 healthy。
- 局域网访问需在 compose 端口映射与防火墙上放开，并配置 workspace 指向项目路径。
- `.env.example` 占位密钥不可直接用于生产，SECRET_KEY/SILLYSPEC_MASTER_KEY 必须替换。
- backend 连 minio 必须走容器服务名 `http://minio:9000`（compose backend environment 默认值已设）；`config.py` 的 `s3_endpoint` 默认 `http://localhost:9000` 仅给本机 native run 用，容器内用 localhost 连不通兄弟 minio 容器（`EndpointConnectionError` → 上传 500）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260722-012-dddb | 补 backend environment S3 配置（默认 `http://minio:9000`）+ `.env.example` 同步，修复容器内连不通 minio 致平台文件中心上传 500
