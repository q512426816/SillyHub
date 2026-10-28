---
schema_version: 1
doc_type: module-card
module_id: deploy
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# 部署编排（deploy）

## 定位

multi-agent-platform 的一体化部署编排组件，用 Docker Compose 把 backend、frontend、PostgreSQL、Redis 拉成一套可运行的服务栈。是开发联调与（未来）生产部署的统一入口，定义了各组件的容器化方式、网络、端口、数据卷、健康检查与环境配置。聚合依赖 backend、frontend（也间接含 sillyhub-daemon 的分发物），被 ci/build 引用。

技术栈：Docker、Docker Compose、PostgreSQL（pgvector/pgvector:pg16）、Redis 7-alpine；各子项目自带 Dockerfile（backend/Dockerfile、frontend/Dockerfile）。

## 契约摘要

- **核心产物**：`docker-compose.yml`（主编排）+ `docker-compose.dev.yml`（开发覆写，postgres/redis + litellm/litellm-db）+ `.env`/`.env.example`（环境变量模板，含 `LITELLM_MASTER_KEY`/`LITELLM_DB_PASSWORD`）。
- **服务定义**（主 compose）：
  - `postgres`（**pgvector/pgvector:pg16**——知识搜索向量持久化换镜像（2026-10-15-knowledge-search-pgvector 起，含 vector 扩展），healthcheck pg_isready，卷 pgdata）
  - `redis`（redis:7-alpine，appendonly 持久化，healthcheck redis-cli ping，卷 redisdata）
  - `minio`（minio/minio，S3 兼容对象存储，端口 9000/9001，卷 minio-data；平台文件中心后端，`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` 默认 minioadmin）
  - `backend`（build 自 backend/Dockerfile，env_file 加载，depends_on postgres/redis/minio(healthy)，暴露端口；environment 注入对象存储 `STORAGE_BACKEND`/`S3_ENDPOINT`(默认 `http://minio:9000`)/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`，凭证须与 minio 服务一致；fastembed 模型缓存挂载 `./models/fastembed_cache:/tmp/fastembed_cache`（服务器无外网须预置）+ `mem_limit: 1100m`——2026-10-15-knowledge-search-pgvector 生产实证）
  - `frontend`（build 自 frontend/Dockerfile，depends_on backend，env_file，端口 3000）
  - `litellm`（ghcr.io/berriai/litellm-database:v1.95.0 pin，OpenAI↔Anthropic 转换网关，change 2026-08-08；depends_on litellm-db(healthy)，env `LITELLM_MASTER_KEY`+`STORE_MODEL_IN_DB=True`+`DATABASE_URL`→litellm-db，healthcheck `/health/liveness`，restart=always；prod 无端口/dev `127.0.0.1:4000`；admin API 动态注册 openai 格式供应商，model_name=`usr-<uid>-<pid>` 路由，**litellm_params.model 必须 `openai/<model>` 前缀**；🚧 `profiles: ["litellm"]` 临时门控（change 2026-10-05-litellm-crashloop-quarantine）——v1.95.x 坏构建隔离，默认 `up -d` 不拉起，`--profile litellm` 或显式点名恢复，移除条件见坑文档 litellm-v1950-image-entrypoint-not-found.md）
  - `litellm-db`（postgres:16-alpine，独立实例避 alembic_version 冲突，卷 litellm-db-data；持久化运行时注册的 deployment；🚧 同上随 litellm 临时 profile 门控）
  - 命名卷：pgdata、redisdata、minio-data、worktree-data、claude-data、litellm-db-data。
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
- **LiteLLM 网关（openai 格式供应商，change 2026-08-08）**：openai 格式供应商经 LiteLLM 做 Anthropic↔OpenAI 转换（**D-012 转换外包**，平台代码不实现转换）。端到端链路：openai 供应商 set-default → 后端 register 到 LiteLLM（model_name=`usr-<uid>-<pid>`，litellm_params.model=`openai/<model>`）→ lease 下发 openai 形态 provider_config（6 字段，**不含上游 api_key**）→ daemon 注入 `ANTHROPIC_BASE_URL`=litellm_base_url + `ANTHROPIC_AUTH_TOKEN`=litellm_master_key + `ANTHROPIC_MODEL`=`usr-<uid>-<pid>` → Claude Code 发 Anthropic `/v1/messages` → LiteLLM 按 model_name 路由转 OpenAI 打上游。上游 api_key 只注册在 LiteLLM（master key 加密），不下发 daemon（D-003/NFR-01）。`LITELLM_MASTER_KEY` 须替换占位（`.env.example` 不可直接生产用）。
- **知识搜索嵌入部署实证（2026-10-15-knowledge-search-pgvector）**：生产服务器（阿里云 2 核 1.6G）无外网拉不到 fastembed 模型——须预置模型缓存挂载 `./models/fastembed_cache`；容器内全量嵌入不可行（mem_limit 800→1100m，建库改本机 20 核 + `ssh -L 15432:<PG容器IP>:5432` 隧道直写生产库，228.7s/6712 chunks）；PG 容器端口未映射宿主，隧道目标须写容器 IP 而非 127.0.0.1。
- **生产秒级监控 Netdata（2026-10-27-netdata-prod-monitoring）**：腾讯云生产机（124.222.127.242，服务器规格已升 4 核/7.5G/59G——build-and-save.sh 头注释「2 核」为过时信息）宿主机装有 Netdata（stable 通道、遥测关闭、systemd 开机自启），供性能问题秒级现场排查（瞬时抖动/OOM/单容器资源打满）。访问：本机开 SSH 隧道 `ssh -i ~/.ssh/tencent_deploy -L 19999:127.0.0.1:19999 ubuntu@124.222.127.242`，浏览器开 `http://localhost:19999`；逐容器（backend/frontend/postgres/redis/minio）CPU/内存/磁盘/网络曲线在面板 Containers 分区（cgroups 自动识别，无需配置）。安全红线：面板无密码认证、Web 仅绑 `127.0.0.1:19999`（`/etc/netdata/netdata.conf` `[web] bind to`）——**禁止在腾讯云安全组放行 19999**；改配置后 `sudo systemctl restart netdata` 生效；数据默认落本机分层库、不接 Netdata Cloud（不出网）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- 2026-10-27-netdata-prod-monitoring | 生产机（124.222.127.242）宿主装 Netdata 秒级监控（stable/关遥测/绑回环），deploy.md 补排查条目（SSH 隧道访问+容器指标入口+安全红线：禁安全组放行 19999）
- 2026-10-16-backend-mem-polling task-09/10 | 配额去超卖+OOM 保护+构建稳定性（0279cd175/f62065e2f）：compose redis 128m→64m、minio 256m→128m、frontend 400m→300m（backend 1100m+postgres 256m 保持，总 2.14G→1.85G）；backend 服务级 oom_score_adj:-500（注意：当前 compose 版本忽略该键——inspect OomScoreAdj=0，entrypoint try-best 写 /proc 亦 EPERM，保护缺失=改造前现状非回归，升 compose 后生效）；backend Dockerfile ENV UV_HTTP_TIMEOUT=300（wheel 下载 30s 默认超时国内网络抖动挂构建，filelock 实证）。2026-10-16 部署腾讯轻量（124.222.127.242）四指标实测达标（RSS 211MiB/迁移 20261016100000 回填 1128 行/列表 0.5ms/idle-txn 归零）；回滚 tag backup-20261016-1253。
- ql-20260722-012-dddb | 补 backend environment S3 配置（默认 `http://minio:9000`）+ `.env.example` 同步，修复容器内连不通 minio 致平台文件中心上传 500
- change 2026-08-08-llm-provider-openai-format | deploy 加 litellm + litellm-db 服务（OpenAI↔Anthropic 转换网关，D-012 外包）+ `LITELLM_MASTER_KEY`/`STORE_MODEL_IN_DB` env + `.env.example` 占位 + openai 端到端链路说明
- 2026-10-14-litellm-retire | litellm 退役拍板（用户 2026-10-14 裁决：彻底退役）：v1.95.0 坏构建坑挂 12 天分叉未拍板，
- change 2026-10-15-knowledge-search-pgvector | postgres 换 pgvector/pgvector:pg16（知识搜索向量持久化，vector(512) 两表）+ backend fastembed 模型缓存挂载 + mem_limit 800m→1100m（生产 OOM/无外网实证）
- 2026-10-16-deploy-convergence-guard | 2026-10-16 生产互覆事故——另一会话从分叉分支打包部署，静默回退 main 上已修复的 /…
- 2026-10-19-knowledge-build-switch-rollout | 禁建库开关本地部署落地与首搜实测
- 2026-10-19-change-assets-cross-repo-repos | 变更资产卡展示跨仓冻结面
- 2026-10-22-daemon-snapshot-report-log | daemon 快照上报补收口日志
- 2026-10-22-fix-translate-pending | 生产 /api/translate/thinking 请求长时间 pending：容器未配置 TRA…
- 2026-10-22-session-trajectory-third-view | 把会话轨迹从「进度」视图内的第二层呈现开关上移为与「对话 / 进度」并列的第三个顶层视图，同时修复轨…
- 2026-10-22-agent-profiles-page-restyle | 智能体档案列表页重设计
- 2026-10-24-backend-mem-limit-raise | 提升 backend 容器内存限额防 OOM
- 2026-10-28-release-record-generator | 发布记录生成器脚本取号锚点与校验
