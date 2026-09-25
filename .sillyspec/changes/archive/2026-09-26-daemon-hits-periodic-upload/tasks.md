---
author: flow-machine-draft
created_at: 2026-09-25T23:20:26.154Z
---
# 任务注册表（Tasks）— 2026-09-26-daemon-hits-periodic-upload

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: hits 上行从 postSpecSync 汇聚点解耦为独立周期通道：daemon 主循环（或 heartbeat 节拍）每 5 分钟对已绑定工作区触发一次 u…
- [x] task-02: 触发器带 mtime 短路：hits 文件 mtime
- [x] task-03: size 与上次触发时相同则跳过整轮（避免每 5 分钟全量读 2MB+ 文件）
- [x] task-04: 既有 postSpecSync 挂点保留（双通道幂等，服务端 hash 去重兜底
- [x] task-05: 同步后即时上行 + 周期兜底双保险）
- [x] task-06: 单测：周期触发调用 uploader（mtime 变化才调）
- [x] task-07: mtime 未变不调
- [x] task-08: 端点失败不抛且周期定时器不中断
- [x] task-09: 既有 daemon hits 上行测试与 typecheck 零回归
