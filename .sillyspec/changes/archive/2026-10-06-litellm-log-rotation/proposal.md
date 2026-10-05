---
author: flow-machine-draft
created_at: 2026-10-05T17:16:19.525Z
---
# 提案书（Proposal）— 2026-10-06-litellm-log-rotation

## 动机

任务原话转写：litellm 服务 restart:always 且 deploy/docker-compose.yml 全文件无日志轮转配置，若按隔离注释的复验路径 --profile litellm up -d 显式拉起，已知坏构建镜像 v1.95.0 将 crash-loop 且 json-file 日志无上限膨胀（低配服务器磁盘风险；2026-10-06 代码审查报告的残留中风险项）。

成功标准：
- deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）
- 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile
- 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）
2. 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile
3. 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异

## 成功标准（可验证）

1. deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）
2. 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile
3. 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异
