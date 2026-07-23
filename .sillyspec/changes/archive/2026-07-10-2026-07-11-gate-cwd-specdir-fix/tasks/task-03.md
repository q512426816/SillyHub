---
id: task-03
title: _enforce_command_whitelist 尾部放行 --spec-dir（成对+值校验防注入）
author: qinyi
created_at: 2026-07-11 01:20:00
priority: P0
depends_on: []
blocks: [task-06]
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
provides:
  - contract: 命令白名单允许 --spec-dir
    fields: [--spec-dir flag, value within allowed roots]
---

## 目标
`_enforce_command_whitelist`（delegate.py:762-815）尾部 flag 白名单加 `--spec-dir`，放行 gate verify 命令的 spec_dir 参数（R3 安全：值校验防注入）。

## 实现要点
1. 当前尾部 flag 白名单 `_GATE_VERIFY_TAIL_FLAG_WHITELIST = frozenset({"--stage"})`（:684）。加 `--spec-dir`：`frozenset({"--stage", "--spec-dir"})`
2. 尾部成对消费逻辑（:799-815 while 循环）不变——自动覆盖 `--spec-dir <value>`
3. **值校验增强（防注入）**：`--spec-dir` 的 value 额外校验 within allowed roots（路径白名单）。当前 `--stage <value>` 只校验 flag 不校验值（stage 值无关安全）；`--spec-dir <path>` 是路径，需校验不越界（防 `../../etc/passwd` 注入）
4. 实现：尾部 while 循环里，flag == `--spec-dir` 时，校验 value 路径 within workspace allowed roots（或非空 + 绝对路径 + 无 `..`）。违例 raise HostFsDelegateError
5. backend 构造 args 时 spec_dir 受控（_resolve_gate_spec_root 返回的 SpecWorkspace.spec_root），daemon handler assertWithinAllowedRoots 兜底——本层先于 RPC 拦截

## 验收
- [ ] 白名单放行 `--spec-dir <value>`（成对消费）
- [ ] `--spec-dir` 值校验 within allowed roots（防 `../` 注入，违例 raise HostFsDelegateError）
- [ ] 现有 `--stage` 行为不变（只 flag 白名单，值不校验）
- [ ] 合法 `sillyspec gate verify --change foo --json --spec-dir /host-projects/x/.sillyhub/...` 通过

## verify
```
cd backend && uv run pytest -k "run_command and spec_dir" && uv run ruff check app/modules/daemon/host_fs/ && uv run mypy app
```

## 约束
- 仅加 `--spec-dir` flag + 值校验，不改头部白名单（gate verify --change --json 固定）
- R3 安全：值校验是关键（spec_dir 路径防注入）
