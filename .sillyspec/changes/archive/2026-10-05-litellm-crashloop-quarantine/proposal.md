---
author: flow-machine-draft
created_at: 2026-10-05T00:15:58.560Z
---
# 提案书（Proposal）— 2026-10-05-litellm-crashloop-quarantine

## 动机

任务原话转写：动机：litellm v1.95.0 两个镜像变体（plain/database）均为 ghcr 坏构建（exec 127 crash-loop，2026-10-04 阿里云实测），服务器靠手动 stop 止循环，但 compose 保留 restart:always——任何常规 docker compose up -d（两个部署 skill 的标准收尾命令）都会重新拉起坏镜像进入无限重启，且 deploy/ 无日志轮转配置，1.6G 低配机上日志无上限膨胀。纯注释提醒无拦截力，需要结构性隔离。
成功标准：
- 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含
- 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起
- 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖
- compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）
- deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含
2. 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起
3. 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖
4. compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）
5. deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除

## 成功标准（可验证）

1. 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含
2. 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起
3. 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖
4. compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）
5. deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除
