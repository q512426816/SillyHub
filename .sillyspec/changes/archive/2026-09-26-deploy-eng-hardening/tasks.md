---
author: flow-machine-draft
created_at: 2026-09-25T23:44:30.315Z
---
# 任务注册表（Tasks）— 2026-09-26-deploy-eng-hardening

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: backend 镜像构建时 COMMIT_SHA 构建参数注入 git rev-parse --short HEAD…
- [x] task-02: build-and-save.sh 完成提示的 scp/ssh 命令改为双层活跃目录 /opt/sillyhub/deploy/deploy/（与技能文档一致）
- [x] task-03: load-and-up.sh 增 backup tag 保留策略：只保留最近 4 个 multi-agent-platform-{backend…
- [x] task-04: scripts/gen-api-types.mjs 前置守卫：backend/openapi.json 或 frontend/src/lib/api-types…
- [x] task-05: 并行会话先提交或 stash）
- [x] task-06: 新增 scripts/git-safe.sh：git 操作遇 index.lock 竞态自动等待重试（默认 30s 超时）…
- [x] task-07: 上述脚本改动本地可验（不部署：COMMIT_SHA 经本地构建验证进镜像 env
- [x] task-08: load-and-up 语法 bash -n
- [x] task-09: gen 守卫用脏工作区实测拦截）
