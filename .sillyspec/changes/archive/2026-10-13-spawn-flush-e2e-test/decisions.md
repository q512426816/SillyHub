---
author: flow-machine-draft
created_at: 2026-10-12T23:44:50.773Z
---
# 决策记录（Decisions）— 2026-10-13-spawn-flush-e2e-test

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：时序脆弱——若固定 tick 不足以让 readline 消费推送行（慢 CI），「零直发」断言可能偶发红。对冲：tick 取 25ms（既有测试同量级）且断言面宽松（只断言批次数与内容，不依赖帧级时序）；看门狗用例等待窗 3 倍于触发时间。次风险：`vi.mock('node:child_process')` 文件级替换影响同文件后续 import——同 tests/task-runner.test.ts 先例，本文件独立无其它 spawn 依赖。 试过但放弃的方案：① 经 `runner.runLease` 全链驱动（含 lease claim/心跳编排，时序面大、断言噪声多，且 runLease 已有专属测试，放弃）；② 给 spawnAndStream 加依赖注入 seam 以便绕过 spawn（为测改产线签名，违背「纯测试新增」边界，放弃）。
