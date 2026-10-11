---
author: flow-machine-draft
created_at: 2026-10-11T05:04:48.021Z
---
# 任务注册表（Tasks）— 2026-10-11-snapshot-timeout-distinct

- [x] task-01: LocalSnapshotResponse 的 status 拆出 daemon_timeout 五态（offline=无 WS 连接/timeout=连接在但 15s 无响应），router 按异常类型精确映射不再 except-All 归 offline
- [x] task-02: 超时态前端文案引导正确方向：「守护进程无响应——若刚更新过 daemon 请重启进程」（本案例根因即此）
- [x] task-03: 既有四态（ok/offline/unsupported/binding_missing）行为回归不变；api-types 重新生成同步
- [x] task-04: 仅跑改动相关测试 + typecheck/lint 绿，全量留给 CI
