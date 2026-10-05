---
author: flow-machine-draft
created_at: 2026-10-05T00:15:58.561Z
---
# 任务注册表（Tasks）— 2026-10-05-litellm-crashloop-quarantine

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-05-litellm-crashloop-quarantine --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-05-litellm-crashloop-quarantine` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 默认（不带 --profile）docker compose up -d 不再拉起 litellm 与 litellm-db：docker compose config --services 默认输出不含两者，带 --profile litellm 后包含
- [x] task-02: 隔离可逆且零数据丢失：litellm-db-data 卷与两服务配置原样保留，--profile litellm（或显式 up -d litellm litellm-db，Compose 显式点名自动激活 profile）即可恢复拉起
- [x] task-03: 其余服务（postgres/redis/minio/backend/frontend 等）的 config 渲染输出与改动前一致，仅新增 profiles 门，不改任何镜像/环境/依赖
- [x] task-04: compose 配置通过 docker compose config 校验无错误（本机 Docker 29.5.2 + deploy/.env 实测）
- [x] task-05: deploy/docker-compose.yml 注释与 docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 新增 2026-10-05 段一致：profiles 门是临时隔离，选新 tag 的专门变更须一并移除
