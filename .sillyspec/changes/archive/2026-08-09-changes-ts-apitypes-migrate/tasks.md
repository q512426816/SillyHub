---
author: qinyi
created_at: 2026-08-09 08:28:57
---
# 任务清单（Tasks）

> 注：plan 阶段把 brainstorm 的 4 任务合并为 2（changes.ts 类型段编辑合为一个连贯 task-01），权威以 plan.md 为准。

- [ ] task-01: changes.ts 类型段重构（11 类型 alias 化 + 9 shadow 注释 + JSDoc + 删 phantom created_at + 补 FeedbackRequest.target_stage）（FR-01 / FR-02 / FR-04 / NFR-01 / D-002@v1 / D-003@v1 / D-004@v2）
- [ ] task-02: 调用方 drift guard（typecheck 暴露点补 warnings/current_stage/TransitionDispatchResponse 字段 guard）（FR-03；depends_on task-01）
