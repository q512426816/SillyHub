---
id: task-14
title: "compose 硬化 + 全量回归"
title_zh: "docker-compose 弱口令 fail-fast 与端口收紧 + 变更全量回归收尾"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-12, task-13]
blocks: []
requirement_ids: [FR-14]
decision_ids: [D-006@v1]
allowed_paths:
  - deploy/docker-compose.yml
provides: {}
expects_from: {}
goal: >
  compose 弱口令默认值改 :?must set 强制、PG/MinIO 端口宿主映射收紧绑 127.0.0.1，并对本变更全部任务跑三端全量回归收尾。
implementation:
  - docker-compose.yml postgres 服务 POSTGRES_PASSWORD 默认值 platform 改 ${POSTGRES_PASSWORD:?must set POSTGRES_PASSWORD}（与 SECRET_KEY :104 同款 fail-fast 写法）；POSTGRES_USER/POSTGRES_DB 保留默认（非密）
  - backend environment 里 DATABASE_URL 引用（:102）同步核对——该行用 ${POSTGRES_PASSWORD:-platform} 默认兜底，必须一并去掉兜底改 :?must set，否则 fail-fast 被此处旁路
  - minio 服务 MINIO_ROOT_PASSWORD 与 backend 的 S3_ACCESS_KEY/S3_SECRET_KEY（:114-115，默认 minioadmin）全部改 :?must set；MINIO_ROOT_USER 保留默认
  - postgres ports（:16）"${POSTGRES_PORT:-5432}:5432" 改 "127.0.0.1:${POSTGRES_PORT:-5432}:5432"——容器网络内 backend 走服务名 postgres:5432 不受影响，仅去宿主公网暴露
  - minio ports（:45-46）9000 API 口同理绑 127.0.0.1；9001 console 口评估——若仅本机调试用同样绑 127.0.0.1，注释写明
  - 同步核对 deploy/.env.example 有对应变量条目与说明（若 .env.example 缺 POSTGRES_PASSWORD/MINIO_ROOT_PASSWORD/S3_* 条目则本次只报备不改——文件不在本卡 allowed_paths，走 quick 补）
  - docker compose config 冒烟——本机 .env 补齐新必填变量后 docker compose -f deploy/docker-compose.yml config 不报错、端口映射显示 127.0.0.1 绑定
  - 全量回归收尾——backend 命中模块 pytest（daemon/file/platform_sync/change/auth/core/mcp_gateway/workspace/git_identity/worktree + main quick-chat 相关）、sillyhub-daemon vitest、frontend vitest + tsc；无 DB schema 变化故无迁移；本变更无新 DTO，预计不需要 pnpm gen:types（若 W1-W4 实际改了响应模型则补跑并提交 openapi.json + api-types.ts）
acceptance:
  - 未设置 POSTGRES_PASSWORD/MINIO_ROOT_PASSWORD/S3_SECRET_KEY 任一时 docker compose config 直接报错拒绝启动（fail-fast，与 SECRET_KEY 行为一致）
  - 5432 与 9000/9001 端口宿主侧仅绑 127.0.0.1，docker compose config 输出可验证
  - backend / sillyhub-daemon / frontend 三端回归全绿，本变更 13 个 task（task-11 并入 task-03）无遗留红测试
verify:
  - docker compose -f deploy/docker-compose.yml config（环境变量齐全时应无错；抽掉 POSTGRES_PASSWORD 应报 must set 错误）
  - cd backend && uv run pytest app/modules/daemon app/modules/file app/modules/platform_sync app/modules/change app/modules/auth app/core app/modules/mcp_gateway app/modules/workspace app/modules/git_identity app/modules/worktree -q --no-cov
  - cd backend && uv run ruff check . && uv run mypy app
  - cd sillyhub-daemon && pnpm test
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - D-006@v1 范围只含弱口令 fail-fast + 端口收紧；备份脚本、.env 扩散、root IP 硬编码、镜像删除策略独立 change 不做
  - LITELLM_DB_PASSWORD 默认 litellm（:170/:204）虽也是弱口令，但 litellm-db 不出容器网络无宿主端口，本卡不动（避免范围膨胀；如需收紧随部署硬化 change）
  - 端口绑 127.0.0.1 需兼容三平台——compose 长语法 ports 均支持；Windows Docker Desktop 同样生效
  - 本 task 不动业务代码——若回归发现红测试，属 W1-W4 责任回归该 task 修（rule 11 修逻辑不修测试），不在本卡 allowed_paths 内
related_tests:
  - path: deploy/.env.example
    reason: 非测试但为配置回归点——新 :?must set 变量若 example 缺条目，用户按 example 配 env 会启动失败，需核对（缺则报备走 quick 补）
---
