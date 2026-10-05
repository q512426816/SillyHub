---
author: flow-machine-draft
created_at: 2026-10-05T17:16:19.525Z
---
# 任务注册表（Tasks）— 2026-10-06-litellm-log-rotation

> 镜像行（task-01…task-NN）是成功标准逐条镜像=任务锚：勿删勿改写（收口对照它），完成实现路径
> 需要更细步骤时在镜像行**后追加细化行**（保持 `- [ ] task-NN:` 行形态，编号从镜像行末尾顺延——
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决）。
> 边干边勾：完成一条 = 实现到位 + 相关测试跑绿 → 当场勾（sillyspec task tick --change 2026-10-06-litellm-log-rotation --task task-NN 即时回显进度与下一任务，或 Edit 翻格），勿攒到收口一把勾（收口硬门拒单拍多格勾选；--allow-batch-tick 可显式旁路留痕）。⚠️ harness 的 TodoWrite 类工具不替代本文件——平台进度/收口哨兵只读 tasks.md。
> `flow status --change 2026-10-06-litellm-log-rotation` 为自愿查看/恢复面。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: deploy/docker-compose.yml 的 litellm 服务新增 logging json-file 有界配置（max-size + max-file）
- [x] task-02: 默认 up -d 启用集合不变：docker compose config --services 仍为 5 个核心服务，litellm/litellm-db 仍仅在 litellm profile
- [x] task-03: 本机 docker compose config 渲染通过，且 litellm 服务除新增 logging 外无其它配置差异
