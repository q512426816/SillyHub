---
id: task-01
title: _resolve_gate_spec_root 分离返回 (code_root, spec_dir) 二元组
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: []
blocks: [task-02, task-04, task-06]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: _resolve_gate_spec_root → (code_root, spec_dir)
    fields: [code_root, spec_dir]
---

## 目标
`_resolve_gate_spec_root` 改返回二元组 `(code_root, spec_dir)`，分离 gate 的 cwd（跑测试）与 specBase（读 local.yaml）。

## 实现要点
1. 当前 `_resolve_gate_spec_root` 返回单个 `spec_root`（service.py:1212-）。改返回 `tuple[str | None, str | None]`
2. **daemon-client**：`code_root = workspace.root_path`（宿主代码根，有 backend/frontend）+ `spec_dir = SpecWorkspace.spec_root`（平台 specDir，有 local.yaml/spec 产物）
3. **server-local**：返回 `(None, None)`（gate 不跑，task-01 raise；本函数不被触达，防御返回）
4. **brownfield（无 SpecWorkspace）**：`spec_dir` fallback `code_root/.sillyspec`（local 模式，gate specBase=resolveSpecDir(code_root)）
5. 解析逻辑（SpecWorkspace.spec_root）复用 P3 现有（不改解析规则，只改返回结构）

## 验收
- [ ] 返回 `(code_root, spec_dir)` 二元组
- [ ] daemon-client: code_root=workspace.root_path + spec_dir=SpecWorkspace.spec_root
- [ ] brownfield: spec_dir fallback code_root/.sillyspec
- [ ] 现有解析逻辑不变（SpecWorkspace.strategy 分流）

## verify
```
cd backend && uv run pytest -k resolve_gate_spec_root && uv run ruff check app/modules/daemon/run_sync/ && uv run mypy app
```

## 约束
- 仅改返回结构，不重构 SpecWorkspace 解析
- 向后兼容（调用方 task-04 适配解构）
