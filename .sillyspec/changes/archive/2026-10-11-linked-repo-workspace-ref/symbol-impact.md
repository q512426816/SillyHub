---
author: qinyi
created_at: 2026-10-11 17:15:00
change: 2026-10-11-linked-repo-workspace-ref
---

# 符号影响分析（Symbol Impact）— 2026-10-11-linked-repo-workspace-ref

> 纯 additive：加列+加字段+加校验+加匹配逻辑，零既有签名变更。

- task-01: model 加列；schema 加字段；service 加校验+join 摘要+matched 匹配（fetch_local_snapshot 内扩展）；迁移新文件。无签名级变更。
- task-02: 卡片/表单追加 UI 元素（下拉/跳转/提示）；lib 加类型字段；gen:types 产物。无签名级变更。
