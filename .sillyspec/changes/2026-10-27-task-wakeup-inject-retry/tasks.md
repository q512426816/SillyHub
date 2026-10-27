---
author: flow-machine-draft
created_at: 2026-10-27T00:54:57.791Z
---
# 任务注册表（Tasks）— 2026-10-27-task-wakeup-inject-retry

- [x] task-01: daemon.ts 新增 `taskWakeupRetryDelaysMs()` env 解析——默认 `[5000,15000,30000,60000,120000,300000]`、`0`/空=禁用（`[]`）、非法项忽略全非法回默认——验证：node 直调四形态断言（未设/0/非法/自定义列表）
- [x] task-02: background-tasks.ts `scheduleTaskWakeup` 注入单发改退避重试循环——成功即止、退避等待后 `_store` 无会话条目即中止留痕、耗尽 error 留痕、期间 warn 留痕（fire-and-forget 不变）——验证：task-lifecycle 重试新用例绿
- [x] task-03: turn-phase-observability.ts `notePhaseEmit` 增 per(point,session,run) 有界防重（512 逐出最旧），`resetTurnPhaseObservabilityForTest` 同步清零——验证：observability 新用例绿
- [ ] task-04: task-lifecycle.test.ts 新增重试四态用例（首败重试成功/全耗尽放弃/终态中止/开关禁用）+ turn-phase-observability.test.ts 防重用例——验证：vitest 两文件全量绿（含既有用例零回归）+ lint 过
- [ ] task-05: 三方向评估结论落档 design.md 边界并发第 5 问（FR-04，A 选定/B 不解决唤醒缺失/C 绕不开后端建 run）——验证：verify-drafts 与收口文档门在场核验
