---
author: flow-machine-draft
created_at: 2026-10-12T23:37:51.940Z
---
# 提案书（Proposal）— 2026-10-13-spawn-flush-e2e-test

## 动机

任务原话转写：2026-10-13-review-risk-fixes 评审 P3 留债：spawnAndStream 收尾冲刷只有组合件单测（coalescerFlushAllMessages + forwardSubmitMessages 直调），收尾序列本身（break 出 readline 后 flushAll → 转发 → await pendingForwards）无执行级测试守护，未来重构该段时测试不会红。补直调 spawnAndStream 的执行级测试。
成功标准：
- 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列
- 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled
- 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout
- 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed
- 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列
2. 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled
3. 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout
4. 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed
5. 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量

## 成功标准（可验证）

1. 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列
2. 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled
3. 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout
4. 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed
5. 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量
