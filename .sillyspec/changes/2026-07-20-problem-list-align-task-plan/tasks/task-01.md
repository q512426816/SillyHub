---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-01
title: fsm 重写为 3 态中文
wave: 1
blockedBy: []
allowed_paths: [backend/app/modules/ppm/problem/fsm.py]
acceptance: [FR-1, FR-2]
---

## 目标
`problem/fsm.py` 的 `ProblemStatus` 收敛为 3 态中文（新建 / 进行中 / 已完成），删主流审批推进逻辑，保留 `ProblemNode` 枚举（变更流依赖，D-005）。

## 实现步骤
1. `ProblemStatus` 重写为 3 成员：`NEW = "新建"` / `DOING = "进行中"` / `CLOSED = "已完成"`；删 `AUDITING / BACK / WAIT_CHECK / CHANGING`。
2. `TRANSITIONS` 重写：`{NEW: {DOING}, DOING: {NEW, CLOSED}, CLOSED: set()}`（submit 回新建可再 start = 重复执行；complete 终态）。
3. 删**主流审批专用**：`NODE_NAMES` / `NODE_TO_ROLE` / `NODE_NEXT` / `compute_next_node` / `is_audit_node` / `BUG_TYPE`（仅主流用）/ `CHANGE_TYPE`（同理评估，若变更流不用则删）。
4. **保留**：`ProblemNode` 枚举（10/20/30/40）、`ProblemChangeStatus` / `CHANGE_TRANSITIONS` / `CHANGE_NODE_NEXT` / `compute_change_next_node` / `is_change_audit_node`（变更流依赖，D-005）。
5. 更新 `__all__` 与模块 docstring（删 4 节点审批链描述）。

## 测试点
- `ProblemStatus.NEW.value == "新建"` 等；`TRANSITIONS[ProblemStatus.DOING]` 含 `NEW` 与 `CLOSED`。
- `compute_change_next_node` 仍可调用（变更流未断）。

## 验收
- fsm 无对 `AUDITING/BACK/WAIT_CHECK/CHANGING` 的引用；`ProblemNode` 保留；ruff/mypy 绿。
