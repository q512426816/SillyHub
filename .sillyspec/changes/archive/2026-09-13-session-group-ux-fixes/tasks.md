---
author: qinyi
created_at: 2026-09-13 00:50:00
---

# 任务清单（Tasks）— 2026-09-13-session-group-ux-fixes

> 唯一真相源：任务详情见 `tasks/task-XX.md`；本文件为索引与状态（plan 阶段写回，Wave 引用见 plan.md）。

## Wave 1（并行，无依赖）

- [x] task-01 预会话草稿按入口隔离（FR-1 / D-001、D-004；turn-state + page + dialog + 测试）
- [x] task-02 拖拽手柄 Pointer Events 迁移（FR-2 / D-002、D-004；input-bar + group-panel + 测试）
- [x] task-03 后端群列表可见工作区集合（FR-3 / D-003、D-004；crud 辅助 + router 组装 + 集成测试）

## Wave 2（依赖 task-03）

- [x] task-04 gen:types 与前端过滤改造（FR-3；两消费点 + mock 补字段 + 过滤断言）

## Wave 3（依赖 task-01/02/04）

- [x] task-05 验证收口（FR-1/2/3；相关面测试 + lint + 对照验收）

## 依赖关系

- task-04 → 依赖 task-03（消费 visible_workspace_ids 字段）
- task-05 → 依赖 task-01/02/04（全模块收口）
- task-01 / task-02 / task-03 相互独立（可并行）
