---
id: task-04
title: _issue_token_pair 解构 tuple + 写 token_id_hmac
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05, task-08]
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
goal: _issue_token_pair 解构 generate_refresh_token tuple，SessionRow 写 token_id_hmac=hmac_token_id(token_id, settings)（refresh_token_hash 仍 bcrypt 完整 token，D-004 双保险）。
implementation: service.py import 加 parse_refresh_token/hmac_token_id；_issue_token_pair 改 refresh_token, token_id = generate_refresh_token()；SessionRow 构造加 token_id_hmac=hmac_token_id(token_id, self._settings)；refresh_token_hash 不变。
acceptance: 新建 Session 含 token_id_hmac 非空且 = hmac_token_id(token_id)；refresh_token_hash 仍 bcrypt；既有 _issue 调用方零回归。
verify: cd backend && uv run pytest tests/modules/auth/ -q（task-08 补 _issue 单测）。
constraints: 不改 _consume/_find_revoked（task-05/06）；不改 _mark_session_rotated/revoked；hmac 用 self._settings（确认 AuthService 有 settings 属性，否则从依赖注入拿）。
provides:
  - contract: IssueTokenPairWritesHmac
    fields: [session_row_token_id_hmac]
expects_from:
  task-01:
    - contract: SessionTokenIndex
      needs: [token_id_hmac_column]
  task-02:
    - contract: RefreshTokenHelpers
      needs: [generate_refresh_token_tuple, hmac_token_id]
---

# task-04 · service _issue_token_pair

## goal

签发 refresh token 时同时落 token_id_hmac（供后续 O(1) 查找），refresh_token_hash 仍 bcrypt 完整 token（D-004 双层防御：HMAC 定位 + bcrypt 验 secret）（design §5.2）。

## implementation

1. `backend/app/modules/auth/service.py` import 块（现 service.py:38-45 from app.core.security import ...）加 `parse_refresh_token, hmac_token_id`。
2. `_issue_token_pair`（service.py:215-246）改：
   ```python
   refresh_token, token_id = generate_refresh_token()
   row = SessionRow(
       ...,
       refresh_token_hash=hash_refresh_token(refresh_token),
       token_id_hmac=hmac_token_id(token_id, self._settings),
       ...,
   )
   ```
3. 确认 `AuthService` 持有 settings（`self._settings`）；若无，从构造依赖注入（grep `settings` 在 service.py 现有用法）。

## 验收标准

- [ ] 新建 SessionRow 含 `token_id_hmac` 非空，值 = `hmac_token_id(token_id, settings)`
- [ ] `refresh_token_hash` 仍为 bcrypt（完整 token）
- [ ] login/logout/refresh 上层调用 _issue 零回归

## verify

- `cd backend && uv run pytest tests/modules/auth/ -q`（task-08 补 _issue 含 token_id_hmac 单测）

## constraints

不改 `_consume_refresh_token` / `_find_revoked_session`（task-05/06 负责，本 task 先合）；不改 `_mark_session_rotated`/`_mark_session_revoked`；本 task 是 service.py 编辑链第一环，task-05/06 依赖本 task 合入后再改同文件。
