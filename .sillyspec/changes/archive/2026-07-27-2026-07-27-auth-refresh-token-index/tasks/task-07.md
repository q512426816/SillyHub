---
id: task-07
title: test_refresh_grace_window.py 适配 generate_refresh_token()[0]
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/tests/modules/auth/test_refresh_grace_window.py
goal: 既有绿测试 test_refresh_grace_window.py:87 适配 generate_refresh_token 返回 tuple（取 [0] token 串），防 task-02 改返回类型后崩（Grill B1）。
implementation: test_refresh_grace_window.py 第 87 行 hash_refresh_token(generate_refresh_token()) 改 hash_refresh_token(generate_refresh_token()[0])（取 token 串喂 bcrypt）；扫该文件其它 generate_refresh_token() 调用点同步改 [0]。
acceptance: test_refresh_grace_window.py 全绿（既有 grace 窗口测试不崩）。
verify: cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -q。
constraints: 只改调用点取值（[0]），不改测试逻辑/断言（规则9：测试逻辑无错不改）；不改其它测试文件。
provides: []
expects_from:
  task-02:
    - contract: RefreshTokenHelpers
      needs: [generate_refresh_token_tuple]
---

# task-07 · 既有测试适配 tuple 返回

## goal

task-02 把 `generate_refresh_token` 返回从 str 改 tuple[str, str]，既有绿测试 `test_refresh_grace_window.py:87` 直接 `hash_refresh_token(generate_refresh_token())` 把返回当字符串——不改会 `tuple.encode()` AttributeError 崩（Grill B1）。

## implementation

1. `backend/tests/modules/auth/test_refresh_grace_window.py:87`：
   ```python
   # 前：refresh_token_hash=hash_refresh_token(generate_refresh_token())
   # 后：refresh_token_hash=hash_refresh_token(generate_refresh_token()[0])
   ```
2. grep 该文件其它 `generate_refresh_token()` 调用点（若有），凡当字符串用的同步加 `[0]`。

## 验收标准

- [ ] `test_refresh_grace_window.py` 全绿（grace 窗口既有断言不崩）
- [ ] 无其它把 generate_refresh_token 返回当 str 用的残留调用点

## verify

- `cd backend && uv run pytest tests/modules/auth/test_refresh_grace_window.py -q`

## constraints

**只改取值（加 `[0]`），不改测试逻辑/断言**（CLAUDE.md 规则9：测试逻辑本身无错禁止改测试"通过"）；仅本文件；不碰 task-08 新增测试。
