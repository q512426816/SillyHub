---
author: qinyi
created_at: 2026-10-16 15:45:12
---
# 任务清单（Tasks）

> Wave 组织见 plan.md（W1: task-01+task-03 并行；W2: task-02；W3: task-04）。实现+单测同卡，无独立测试卡。

- [x] task-01: 会话族 family_id 列 + alembic 增量迁移
- [x] task-02: 族级复用吊销 + 宽限窗300s + 后端族语义测试 (depends_on: task-01)
- [x] task-03: 前端刷新状态码分流 + 测试 + 13调用点审计
- [x] task-04: auth-flow.md 文档同步（族语义+宽限窗+TTL纠错） (depends_on: task-02,03)
