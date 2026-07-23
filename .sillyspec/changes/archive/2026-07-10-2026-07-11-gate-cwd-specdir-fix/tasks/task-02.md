---
id: task-02
title: _run_gate_via_delegate 改签名 + cwd=code_root + args 加 --spec-dir
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: [task-01]
blocks: [task-04, task-05]
allowed_paths:
  - backend/app/modules/change/dispatch.py
provides:
  - contract: _run_gate_via_delegate(code_root, spec_dir)
    fields: [code_root, spec_dir, --spec-dir arg]
expects_from:
  task-01:
    - contract: _resolve_gate_spec_root → (code_root, spec_dir)
---

## 目标
`_run_gate_via_delegate` 改签名接收 `code_root` + `spec_dir`，cwd=code_root（跑测试），spec_dir 非 None 时 args 加 `--spec-dir`。

## 实现要点
1. 当前签名 `_run_gate_via_delegate(session, workspace, change_name, spec_root, stage="verify")`（dispatch.py:1126）。改 `_run_gate_via_delegate(session, workspace, change_name, code_root, spec_dir, stage="verify")`
2. `args = ["gate", stage, "--change", change_name, "--json"]`
3. `if spec_dir: args += ["--spec-dir", spec_dir]`（spec_dir None 时不加，gate specBase 走默认）
4. `delegate.run_command(command="sillyspec", args=args, cwd=code_root, timeout=720)`（cwd 从 spec_root 改 code_root）
5. docstring 更新（code_root=项目代码根跑测试 + spec_dir via --spec-dir 读 local.yaml）

## 验收
- [ ] 签名 `(session, workspace, change_name, code_root, spec_dir, stage="verify")`
- [ ] cwd=code_root（不是 spec_root）
- [ ] spec_dir 非 None 时 args 加 `--spec-dir <spec_dir>`
- [ ] spec_dir None 时不加 --spec-dir（兼容）
- [ ] 现有逻辑（_read_gate_result 解析 / Z1 探测 / RPC 异常 catch）不变

## verify
```
cd backend && uv run pytest -k run_gate_via_delegate && uv run ruff check app/modules/change/ && uv run mypy app
```

## 约束
- 仅改签名 + cwd + args，不改 gate 执行/解析逻辑
- task-05 适配测试（7 测试改参数）
