---
id: task-06
title: 新增测试（白名单 --spec-dir 放行/拒注入 + cwd=code_root 传对）
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: [task-01, task-03]
blocks: []
allowed_paths:
  - backend/app/modules/daemon/host_fs/tests/test_delegate_run_command.py
  - backend/app/modules/change/tests/test_gate_via_delegate.py
---

## 目标
新增测试覆盖 `--spec-dir` 放行 + 注入拒（R3）+ cwd=code_root 传对（AC-1/2）。

## 实现要点
1. **test_delegate_run_command.py 扩**（白名单 --spec-dir）：
   - 放行：`run_command(command="sillyspec", args=["gate","verify","--change",name,"--json","--spec-dir","/host-projects/x/.sillyhub/..."])` → 通过白名单进 RPC
   - 拒注入：`args=[...,"--spec-dir","../../etc/passwd"]` → raise HostFsDelegateError（within allowed roots 校验）
   - 拒注入：`args=[...,"--spec-dir","/etc/shadow"]`（越界）→ raise
   - 缺值：`args=[...,"--spec-dir"]`（尾部无值）→ raise（成对消费校验）
2. **test_gate_via_delegate.py 扩**（cwd=code_root 传对）：
   - mock delegate.run_command，调 `_run_gate_via_delegate(session, ws, name, code_root="/host-projects/x", spec_dir="/spec/dir", stage="verify")`，断言 run_command 的 cwd == code_root（不是 spec_dir）+ args 含 `--spec-dir /spec/dir`
   - spec_dir=None 时 args 不含 --spec-dir（fallback）

## 验收
- [ ] 白名单放行合法 --spec-dir（进 RPC）
- [ ] 白名单拒 --spec-dir 注入（../ 越界 raise）
- [ ] _run_gate_via_delegate cwd=code_root（mock 断言）+ args 含 --spec-dir
- [ ] spec_dir None 时 args 不含 --spec-dir

## verify
```
cd backend && uv run pytest -k "spec_dir or run_command" -v && uv run ruff check && uv run mypy app
```

## 约束
- 新增测试不破坏现有（task-05 适配后）
- 注入测试覆盖 within allowed roots（R3 关键）
