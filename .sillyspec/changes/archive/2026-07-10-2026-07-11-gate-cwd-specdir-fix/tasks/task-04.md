---
id: task-04
title: task-07 _run_gate_decision_task 适配（解构 code_root/spec_dir）
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: [task-01, task-02]
blocks: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: _run_gate_decision_task 调用 gate 用 code_root/spec_dir
expects_from:
  task-01:
    - contract: _resolve_gate_spec_root → (code_root, spec_dir)
  task-02:
    - contract: _run_gate_via_delegate(code_root, spec_dir)
---

## 目标
`_run_gate_decision_task`（service.py:1085-1210）调 `_resolve_gate_spec_root` 解构二元组，传 `_run_gate_via_delegate` 的 code_root + spec_dir。

## 实现要点
1. 当前（service.py:1124）：`spec_root = await self._resolve_gate_spec_root(gate_session, workspace, change)`
2. 改：`code_root, spec_dir = await self._resolve_gate_spec_root(gate_session, workspace, change)`
3. 当前（service.py:1131）：`_run_gate_via_delegate(gate_session, workspace, change_name, spec_root, stage="verify")`
4. 改：`_run_gate_via_delegate(gate_session, workspace, change_name, code_root, spec_dir, stage="verify")`
5. `if not spec_root:` 守卫（:1125-1126）改 `if not code_root:`（code_root None 才 raise，spec_dir None 走 fallback 不加 --spec-dir）

## 验收
- [ ] `_resolve_gate_spec_root` 解构 `(code_root, spec_dir)`
- [ ] `_run_gate_via_delegate` 传 code_root + spec_dir
- [ ] code_root None 时 raise（server-local/解析失败）
- [ ] spec_dir None 时不阻断（brownfield fallback，_run_gate_via_delegate 不加 --spec-dir）
- [ ] gate 决策流程其余不变（cas/sync/auto_dispatch/SSE）

## verify
```
cd backend && uv run pytest -k gate_decision_task && uv run ruff check app/modules/daemon/run_sync/ && uv run mypy app
```

## 约束
- service.py 串行（task-01 → task-04，同文件）
- 仅改 _resolve_gate_spec_root 解构 + _run_gate_via_delegate 调用，不改决策逻辑
