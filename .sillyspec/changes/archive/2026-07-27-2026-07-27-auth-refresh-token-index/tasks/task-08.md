---
id: task-08
title: 新增 token 格式 + O(1) 查找 + migration 测试
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-10]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-006@v1, D-007@v1, D-008@v1]
allowed_paths:
  - backend/tests/modules/auth/
goal: 新增测试覆盖 token 格式/O(1) 查找/双层防御/migration（AC-01~AC-10），验证 refresh 慢请求根治。
implementation: 新建 backend/tests/modules/auth/test_refresh_token_index.py（或扩既有）：token 格式(generate tuple+split+parse 畸形+hmac 确定性)；_issue 含 token_id_hmac；_consume O(1)(正确命中/构造 token 拒/旧格式拒/NULL 旧行不命中)；_find_revoked O(1)(命中/secret 错/无匹配)；migration upgrade head 单头+部分唯一索引 NULL 行不冲突。性能断言 verify_refresh_token 只调 1 次。
acceptance: 新测试全绿；覆盖 AC-01~AC-10；mock 100 活跃 session 时 refresh 仍 O(1)（verify 只调 1 次）。
verify: cd backend && uv run pytest tests/modules/auth/ -q；alembic upgrade head 单头。
constraints: 测试用 SQLite（既有 conftest）；mock verify_refresh_token 断调用次数；构造 token 用真 hmac_token_id+假 secret；不依赖生产数据。
provides: []
expects_from:
  task-01:
    - contract: SessionTokenIndex
      needs: [token_id_hmac_column, token_id_hmac_partial_index]
  task-02:
    - contract: RefreshTokenHelpers
      needs: [generate_refresh_token_tuple, parse_refresh_token, hmac_token_id]
  task-03:
    - contract: SessionTokenHmacMigration
      needs: [revision_202607271700]
  task-04:
    - contract: IssueTokenPairWritesHmac
      needs: [session_row_token_id_hmac]
  task-05:
    - contract: ConsumeRefreshTokenO1
      needs: [o1_hmac_lookup]
  task-06:
    - contract: FindRevokedSessionO1
      needs: [o1_hmac_lookup]
---

# task-08 · 新增测试套

## goal

验证 refresh token O(1) 改造正确性 + 性能 + 安全边界（design §6，AC-01~AC-10）。

## implementation

新建 `backend/tests/modules/auth/test_refresh_token_index.py`（或扩既有 auth 测试），覆盖：

1. **token 格式**（AC-01/02/03）：
   - `generate_refresh_token()` 返回 `(token, token_id)`，token 含一个 `.`，split 后 token_id=32 hex
   - `parse_refresh_token`：无 `.`/空 token_id/空 secret → AuthTokenInvalid；正常 → 两段
   - `hmac_token_id`：同 token_id+同 settings 同输出（确定性），64 hex
2. **_issue_token_pair**（AC-04）：新建 SessionRow 含 `token_id_hmac` 非空且 = `hmac_token_id(token_id, settings)`；`refresh_token_hash` 仍 bcrypt
3. **_consume_refresh_token O(1)**（AC-05/06/07/09）：
   - 正确 token → 命中活跃 session + bcrypt 通过 + rotate
   - 构造 token（真 token_id + 假 secret，HMAC 命中）→ AuthTokenInvalid（双层防御）
   - 旧格式 token（无 `.`）→ AuthTokenInvalid
   - token_id_hmac NULL 的旧行 → 不命中
   - **性能**：mock 100 活跃 session，refresh 时 `verify_refresh_token` 只被调 **1 次**（patch 计数）
4. **_find_revoked_session O(1)**（AC-08）：revoked session 按 hmac 命中 + bcrypt 通过 → 返回；secret 错 → None；无匹配 → None
5. **migration**（AC-10）：`alembic upgrade head` 单头 `202607271700`；多行 `token_id_hmac IS NULL` 共存不违反部分唯一索引；upgrade/downgrade 可逆

## 验收标准

- [ ] 新测试全绿
- [ ] 覆盖 AC-01~AC-10 全部
- [ ] 性能断言：mock 100 session，verify_refresh_token 只调 1 次

## verify

- `cd backend && uv run pytest tests/modules/auth/ -q`
- `cd backend && alembic heads`（单头 202607271700）

## constraints

测试用 SQLite（既有 conftest fixture）；构造 token 用真 `hmac_token_id(真 token_id)` + 假 secret；mock `verify_refresh_token` 用 `unittest.mock.patch` 计调用次数；不依赖生产数据；遵循既有 auth 测试风格（看 test_refresh_grace_window.py）。
