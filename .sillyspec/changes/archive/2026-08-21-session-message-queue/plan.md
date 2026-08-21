---
author: qinyi
created_at: 2026-08-21T16:55:00
change: 2026-08-21-session-message-queue
plan_level: full
total_waves: 3
total_tasks: 11
---

# 实现计划（Plan）

## Wave 1：消息队列核心（无组件统一，可独立交付验证）

依赖：无（纯新增，不改现有组件接口）

- task-01
- task-02
- task-03

## Wave 2：差异分析（只读，无文件冲突）

依赖：Wave 1 完成

- task-04

- task-05

## Wave 4：组件替换（依赖 Wave 3 提取完成）

- task-06
- task-07

## Wave 5：单元测试

依赖：Wave 1 + Wave 3 完成

- task-08
- task-09

## Wave 6：回归与验收

依赖：Wave 4 + Wave 5 完成

- task-10
- task-11

## 依赖关系

```
Wave 1: Task 01 + Task 02（可并行）→ Task 03（依赖 01+02）
Wave 2: Task 04（只读分析，依赖 Wave 1）
Wave 3: Task 05（提取 SessionPanel，依赖 Task 04）
Wave 4: Task 06 + Task 07（可并行，依赖 Task 05）
Wave 5: Task 08 + Task 09（可并行，依赖 Wave 1 + Wave 3）
Wave 6: Task 10 + Task 11（依赖全部）
```

## 预估文件变更

| 操作 | 文件 | 行数估计 |
|---|---|---|
| 新建 | `hooks/use-message-queue.ts` | ~80 |
| 新建 | `components/daemon/message-queue-bar.tsx` | ~60 |
| 新建 | `components/daemon/session-panel.tsx` | ~600 |
| 新建 | `hooks/__tests__/use-message-queue.test.ts` | ~120 |
| 新建 | `components/daemon/__tests__/message-queue-bar.test.tsx` | ~80 |
| 新建 | `diff-analysis.md` | ~100 |
| 修改 | `sessions/page.tsx` | -400（精简） |
| 修改 | `/runtimes` 页面 | ~50（替换 import） |
| 删除 | `interactive-session-panel.tsx` | -1300 |
