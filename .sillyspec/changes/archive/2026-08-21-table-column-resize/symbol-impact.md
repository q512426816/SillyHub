---
author: qinyi
created_at: 2026-08-21T11:10:00+08:00
---

# 符号影响面报告（Symbol Impact）— 2026-08-21-table-column-resize

| Task | 结论 | 说明 |
|---|---|---|
| task-01 | 无签名级变更 | 新增 useResizableColumns 导出（新符号）+ globals.css 追加 |
| task-02 | 签名级变更（props 扩展） | DataTable props 加 onColumnsResize? 可选项（向后兼容，消费方零改动）；PpmResourceTable 内部列构造加默认宽（无对外签名变化） |
| task-03 | 无签名级变更 | 纯测试 |

> 唯一新符号 useResizableColumns 的消费方（DataTable）在 task-02 内闭环；onColumnsResize 为可选 props 零破坏。
