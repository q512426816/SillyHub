---
author: flow-machine-draft
created_at: 2026-10-03T03:37:59.554Z
---
# 任务注册表（Tasks）— 2026-10-03-usage-ingest-session-concurrency

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 定位段（session 查询）串行执行，RPC 段保持 Semaphore(3) 并发，AsyncSession 不再被并发使用
- [x] task-02: 新增回归测试：并发窗口下断言定位调用永不重叠，且旧实现（定位在信号灯内）该测试必红
- [x] task-03: model_validate 校验异常不再炸出 gather，单条畸形不丢弃同批已成功条目
- [x] task-04: 既有 test_usage_ingest.py 全部保持通过
