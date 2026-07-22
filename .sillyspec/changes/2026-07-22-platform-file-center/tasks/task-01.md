---
id: task-01
title: docker-compose minio
title_zh: docker-compose 新增 minio 对象存储服务
author: qinyi
created_at: 2026-07-22 15:15:04
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: []
decision_ids: [D-001]
allowed_paths:
  - deploy/docker-compose.yml
  - deploy/docker-compose.dev.yml
goal: >
  在生产与开发两套 docker-compose 中新增 minio（S3 兼容）对象存储服务，9000 API / 9001 控制台端口，命名卷持久化，root 账号走 env。
implementation:
  - deploy/docker-compose.yml 新增 minio 服务（minio/minio 镜像，command server /data --console-address ":9001"，暴露 9000 与 9001）
  - 通过 environment 注入 MINIO_ROOT_USER / MINIO_ROOT_PASSWORD（读 .env，不硬编码明文）
  - 创建命名卷 minio-data 持久化对象数据，容器重建不丢
  - deploy/docker-compose.dev.yml 同步新增 minio 服务（本地开发可用，端口映射宿主）
  - 本任务在 spike-01（aiobotocore+minio 链路验证）通过后执行
acceptance:
  - docker compose -f deploy/docker-compose.yml config 校验通过且含 minio 服务、端口、命名卷、env
  - docker compose up minio 后 9000 健康、9001 控制台可访问
  - dev compose 同样包含 minio 服务
verify:
  - docker compose -f deploy/docker-compose.yml config
  - docker compose -f deploy/docker-compose.dev.yml config
constraints:
  - root 账号必须走 env 变量，禁止硬编码明文
  - compose 文件在 Win/Linux/macOS 均可用（卷名/路径跨平台）
  - 仅基础设施，不在本任务写后端代码
---
