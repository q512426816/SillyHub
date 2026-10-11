---
author: flow-machine-draft
created_at: 2026-10-11T14:20:05.202Z
---
# 提案书（Proposal）— 2026-10-10-duration-api-cumulative-fix

## 动机

任务原话转写：动机：线上会话 0d6b2ba9 实证终态 tok/s 显示 0.4——claude SDK 结果的 duration_api_ms 是会话级累计快照（逐轮单调递增，DB 实证 13 秒轮被写 52.8 分钟），close 原样写进 per-run 列，终态速度分母放大数十倍且随轮次衰减。同族量 total_cost_usd 已有会话级差分基线机制，duration_api_ms 漏了同款处理。
成功标准：
- daemon onTurnResult 对 duration_api_ms 按会话差分为本轮增量（当前<基线=SDK 复位报全量；基线随 onSessionEnd/onSessionReloaded 回收），duration_ms 语义不变
- backend close 增物理守卫：duration_api_ms > duration_ms（墙钟）为不可能值拒收不覆盖，保留既有值
- 两侧测试覆盖（daemon 差分/复位/回收；backend 超界拒收+合法写入），不跑全量

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon onTurnResult 对 duration_api_ms 按会话差分为本轮增量（当前<基线=SDK 复位报全量；基线随 onSessionEnd/onSessionReloaded 回收），duration_ms 语义不变
2. backend close 增物理守卫：duration_api_ms > duration_ms（墙钟）为不可能值拒收不覆盖，保留既有值
3. 两侧测试覆盖（daemon 差分/复位/回收；backend 超界拒收+合法写入），不跑全量

## 成功标准（可验证）

1. daemon onTurnResult 对 duration_api_ms 按会话差分为本轮增量（当前<基线=SDK 复位报全量；基线随 onSessionEnd/onSessionReloaded 回收），duration_ms 语义不变
2. backend close 增物理守卫：duration_api_ms > duration_ms（墙钟）为不可能值拒收不覆盖，保留既有值
3. 两侧测试覆盖（daemon 差分/复位/回收；backend 超界拒收+合法写入），不跑全量
