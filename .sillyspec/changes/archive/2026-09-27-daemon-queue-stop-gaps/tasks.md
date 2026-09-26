---
author: flow-machine-draft
created_at: 2026-09-26T23:16:33.960Z
---
# 任务注册表（Tasks）— 2026-09-27-daemon-queue-stop-gaps

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队
- [x] task-02: 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
- [x] task-03: daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
- [x] task-04: 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等
- [x] task-05: 既有聚焦测试全绿 + tsc 0 错
