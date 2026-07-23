---
id: task-05
title: 测试适配（test_gate_via_delegate 7 测试 + task-07 mock + e2e mock 改签名）
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: [task-02]
blocks: []
allowed_paths:
  - backend/app/modules/change/tests/test_gate_via_delegate.py
  - backend/app/modules/daemon/tests/test_run_sync_gate_decision_task.py
  - backend/tests/test_gate_e2e.py
---

## 目标
适配 `_run_gate_via_delegate` 新签名（spec_root→code_root+spec_dir）+ `_resolve_gate_spec_root` 二元组返回，改现有测试的参数/mock。

## 实现要点
1. **test_gate_via_delegate.py**（7 测试直接调 _run_gate_via_delegate :150/188/207/236/260/284/311）：`_run_gate_via_delegate(session, ws, name, spec_root, stage)` → `_run_gate_via_delegate(session, ws, name, code_root, spec_dir, stage)`。每个测试的 spec_root 参数拆成 code_root + spec_dir（code_root=workspace.root_path + spec_dir=SpecWorkspace.spec_root 或 fallback）
2. **test_run_sync_gate_decision_task.py**（task-07 测试，mock _run_gate_via_delegate 12 处）：mock 签名适配（patch 不变，但 _run_gate_decision_task 内部调用改 code_root/spec_dir，mock 断言如有 args 检查需改）
3. **test_gate_e2e.py**（mock _run_gate_via_delegate 3 处 :149/177/206）：同上 mock 适配
4. **_resolve_gate_spec_root mock**：task-07 测试若 mock _resolve_gate_spec_root，改返回二元组（原来返回单个 spec_root）

## 验收
- [ ] test_gate_via_delegate.py 7 测试改 code_root+spec_dir 参数，全过
- [ ] test_run_sync_gate_decision_task.py mock 适配，全过
- [ ] test_gate_e2e.py mock 适配，全过
- [ ] backend 全量零回归

## verify
```
cd backend && uv run pytest app/modules/change/tests/test_gate_via_delegate.py app/modules/daemon/tests/test_run_sync_gate_decision_task.py tests/test_gate_e2e.py -v && uv run pytest -q
```

## 约束
- 仅改测试参数/mock 适配新签名，不改测试逻辑/断言（除非签名变化）
- 非测试逻辑有误，禁止改测试通过
