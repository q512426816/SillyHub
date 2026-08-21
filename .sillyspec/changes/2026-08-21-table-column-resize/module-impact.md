---
author: qinyi
created_at: 2026-08-21T10:55:00+08:00
---

# 模块影响分析（Module Impact）— 表格列宽统一可拖拽

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | DataTable 共享层列宽拖拽（新 hook+接入）+ PpmResourceTable 默认宽兜底 + 手柄样式 + 5 单测；消费页零改动 |
| backend / daemon / docs | 无影响 | 零变更 |

## 未匹配文件
无。

## 更新结果
| 目标 | 操作 | 状态 |
|------|------|------|
| modules/frontend.md | 无需更新（交互能力细节不入模块卡；后续可并入 DataTable 契约行） | n/a |
