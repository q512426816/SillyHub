---
author: flow-machine-draft
created_at: 2026-10-03T06:18:22.540Z
---
# 任务注册表（Tasks）— 2026-10-03-usage-backfill-script

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: 候选筛选与聚合消费口径一致（白名单 format + 已关联会话 + 无快照幂等 + 无 runs 会话）
- [ ] task-02: dry-run 只打印影响计数不落库
- [ ] task-03: --apply 逐条 RPC 解析覆盖写、末尾 commit、每 50 条进度回报
- [ ] task-04: 复用既有摄取方法（归一口径/全降级/幂等零重复实现）
- [ ] task-05: ruff 通过
- [ ] task-06: 服务器 dry-run 实测候选数与 DB 直查一致（173 变更口径）
