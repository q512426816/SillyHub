---
schema_version: 1
doc_type: module-card
module_id: lib-workflow
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务状态流转客户端（lib-workflow）

## 定位

仅剩一个函数的薄客户端：**task（TaskCard）级**状态流转。change 级的阶段流转与
评审（`transitionChange` / `submitReview` / `listReviews` / `ReviewEntry`）已按
单一来源原则（D-006，task-11）合并进 `lib/changes.ts`，本模块不再承载。

## 契约摘要

- `transitionTask(workspaceId, taskId, targetStatus: string)` —
  `POST /api/workspaces/{wid}/tasks/{tid}/transition`，body `{ target }`，
  返回 `{ id: string; status: string }`。

## 关键逻辑

```
apiFetch(`/api/workspaces/${wid}/tasks/${tid}/transition`,
         { method: POST, json: { target: targetStatus } })
```

## 注意事项

- **契约边界**：这是 task 级流转，与 change 阶段流转（`@/lib/changes` 的
  `transitionChange`）是不同契约，不可混用——旧卡曾把两者并列在本模块，已过时。
- 旧卡的 `transitionChange` / `submitReview` / `listReviews` 引用一律改从
  `@/lib/changes` 导入。
- 唯一生产消费方：`app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx`
  （任务详情页状态推进按钮）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
