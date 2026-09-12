# 任务清单：群聊触发链锁窗口优雅降级 + 共识任务行先行提交

- change: 2026-09-12-group-trigger-lock-graceful
- date: 2026-09-12
- author: qinyi

- [x] task-01: shadow.py 三段式锁语义（无锁快查复用 / FOR UPDATE 原样 / 55P03 超时 rollback 重读复用或 4xx 报忙）
- [x] task-02: messages.py 共识任务行 gather 前显式 commit（标量预取防 expire）
- [x] task-03: 新增 test_group_trigger_lock.py 三用例（超时→复用 / 超时→报忙+部分失败收集 / 任务行存活性）
- [x] task-04: 群链路存量 208 回归 + 真实环境并发前后对照复验（verify_consensus 独立库 + uvicorn）
