---
author: flow-machine-draft
created_at: 2026-09-25T09:50:43.826Z
---
# 任务注册表（Tasks）— 2026-09-25-daemon-hits-upload-fingerprint

> 机器稿（成功标准机械推导）；轻量跑直写=零任务卡（任务即 checkbox 行）；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。

- [x] task-01: 断点状态在行数之外记录 tailHash（已上行最后一行的 sha256）
- [x] task-02: 每批成功后随行数一起原子落盘
- [x] task-03: 每轮上报前做指纹比对：行数未超前但「已上行最后一行」位置已是别的行 → 回退 offset=0 从头重报（服务端 has
- [x] task-04: 钳位分支（行数超前）语义不变：钳位轮零上行、立即固化，并随钳位重记指纹
- [x] task-05: legacy 状态（无 tailHash）零误伤：该轮维持纯行数口径不整文件重报，首批成功后指纹开始落盘
- [x] task-06: 新增单测：替换后长过旧 offset 全量重报+后续恢复增量、等长替换识别、legacy 状态不误报且指纹落盘
- [x] task-07: 既有 hits 上行单测零回归（基线 14）+ pnpm typecheck 0 错
