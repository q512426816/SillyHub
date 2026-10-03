---
author: qinyi
created_at: 2026-10-03
---
# 任务清单（Tasks）

- [x] task-01: 存储层——migration 20261003020000 水位表 platform_agent_log_usage_marks + UsageMarkORM + 修剪边界单测基座
- [x] task-02: 上报链路——service upsert 循环内读旧值插水位 + 200 行修剪 + test_agent_log_push 用例（插水位/同 ctx 连续/ctx 空/修剪末水位保留/事务性）(depends_on: task-01)
- [x] task-03: 聚合双路径——usage_service 本地段改水位差分（SQL 窗口/自引用取 next）∪ 存量整行互斥 + test_usage_stats 用例（跨变更切换守恒/异步摄取交错序列/存量兼容/quicklog/NULL ctx）(depends_on: task-01)
- [x] task-04: 回归收口——platform_sync+change 聚焦 pytest + ruff/mypy + 模块文档同步（platform_sync.md/change.md 归属协议段）(depends_on: task-02, task-03)
