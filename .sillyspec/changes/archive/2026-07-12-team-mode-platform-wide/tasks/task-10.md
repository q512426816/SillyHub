---
id: task-10
title: D-006 worktree 并发写风险标注（无代码，核实注释）
title_zh: 风险标注核实
author: qinyi
created_at: 2026-07-12 11:01:04
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-2]
decision_ids: [D-006]
allowed_paths: []
---

## 目标

D-006（team 共享 worktree 并发写风险）标注。**无代码改动** —— 三处文档（design §10 / decisions D-006 / plan task-10）+ dispatch.py 代码注释已标注。本 task 只核实注释存留。

## 实现要点

核实以下标注存留（只读，不改）：
1. `dispatch.py:806-812` dispatch 函数注释："per-Worker worktree 隔离 = D-006 完整实现延后；v1 共享 worktree（靠 task 分工避免冲突）"。
2. `dispatch.py:910-916` `_dispatch_execute_team` docstring："per-Worker 独立 worktree 隔离 = D-006 完整实现延后；v1 共享 worktree，靠 Coordinator 拆 task 分工避免并发写冲突"。
3. decisions.md D-006 accepted risk 记录。

已由主审在加载上下文时核实（:806-812 + :910-916 均存在）。

## 验收标准

- 上述标注存留（dispatch.py:806-812 + :910-916 已确认）。
- 无代码改动。

## verify

```
grep -n "D-006\|worktree" backend/app/modules/change/dispatch.py | head
```

## 约束

- 无代码改动（纯核实）。
