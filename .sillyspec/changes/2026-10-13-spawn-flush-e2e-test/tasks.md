---
author: flow-machine-draft
created_at: 2026-10-12T23:37:51.941Z
---
# 任务注册表（Tasks）— 2026-10-13-spawn-flush-e2e-test

- [x] task-01: 新测试文件直调 spawnAndStream（mock node:child_process.spawn 返回 FakeChild 驱动真实 readline 链），不绕过收尾序列
- [x] task-02: 取消（AbortSignal abort）break 路径：流式 delta 残留缓冲在收尾被冲刷并经 client.submitMessages 单行转发（内容拼接、带 timestamp），result status=cancelled
- [x] task-03: 超时（看门狗触发）break 路径：同上残留冲刷转发，result status=timeout
- [x] task-04: 正常流关闭（消息无完结行）路径：残留冲刷转发，result status=completed
- [x] task-05: 新用例与相关既有测试全绿 + pnpm typecheck 通过，不跑全量
