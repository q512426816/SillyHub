---
author: qinyi
created_at: 2026-08-20T22:50:00+08:00
---

# 符号影响面报告（Symbol Impact）— 2026-08-20-workspace-subpages-style-unify

| Task | 结论 | 说明 |
|---|---|---|
| task-01 | 无签名级变更 | 新增 ErrorBanner 纯展示组件（props message/onRetry）；8 处替换为 JSX 换用，无既有符号改动 |
| task-02 | 无签名级变更 | 四页 JSX 类名/结构替换（返链/空态/按钮），无导出符号变更 |
| task-03 | 无签名级变更 | 语义色类名替换 + mcp-tokens 返链移位，无符号变更 |
| task-04 | 无签名级变更 | 表头规格类名 + 文案中文化；member-row 行内类名，无签名变更 |
| task-05 | 无签名级变更 | session-section 容器换 SectionCard（JSX 层）；explorer 类名/高度锚/按钮组件换用（antd Button→shadcn Button，均为外部组件换用非本仓签名） |
| task-06 | 无签名级变更 | 纯验收 |

> 全部任务无签名级变更（纯展示层模式套用）；唯一新导出符号为 task-01 的 ErrorBanner，消费方（8 处替换）均在 task-01 自身 allowed_paths 内闭环。
