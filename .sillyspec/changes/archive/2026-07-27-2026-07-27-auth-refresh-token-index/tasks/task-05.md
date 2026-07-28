---
id: task-05
title: _consume_refresh_token 重写 O(1) HMAC 查找
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: [task-01, task-02, task-04]
blocks: [task-06, task-08]
requirement_ids: [FR-06, FR-07, FR-09]
decision_ids: [D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/auth/service.py
goal: _consume_refresh_token 重写——parse token_id → HMAC → 部分唯一索引 O(1) 查活跃 session → 单次 bcrypt 确认 secret（命中但 secret 错→AuthTokenInvalid）；旧格式/NULL 旧行不命中→转 revoked 路径；保留 FOR UPDATE 行锁 + user active 校验。
implementation: parse_refresh_token(token) 拿 token_id（旧格式无'.'直接 AuthTokenInvalid→401）；hmac_token_id 算 target_hmac；select SessionRow where token_id_hmac==target_hmac AND revoked_at IS NULL AND expires_at>now scalar_one_or_none；命中后单次 verify_refresh_token（False→AuthTokenInvalid）；user active 校验；FOR UPDATE 行锁（保留原 R2）；未命中/锁后失效→_find_revoked_session(token, target_hmac)。
acceptance: 正确 token O(1) 命中+bcrypt 通过+rotate；构造 token（HMAC 命中 secret 错）→AuthTokenInvalid；旧格式→AuthTokenInvalid；NULL 旧行不命中；FOR UPDATE 并发语义保留。
verify: cd backend && uv run pytest tests/modules/auth/ -q（task-08 补 _consume O(1) 单测含构造 token 拒）。
constraints: 不动 _find_revoked 内部（task-06，但本 task 调用它，传 target_hmac）；保留 grace 窗口/revoke_all 逻辑；verify_refresh_token 只调 1 次（性能断言）。
provides:
  - contract: ConsumeRefreshTokenO1
    fields: [o1_hmac_lookup]
expects_from:
  task-01:
    - contract: SessionTokenIndex
      needs: [token_id_hmac_column]
  task-02:
    - contract: RefreshTokenHelpers
      needs: [parse_refresh_token, hmac_token_id]
  task-04:
    - contract: IssueTokenPairWritesHmac
      needs: [session_row_token_id_hmac]
---

# task-05 · service _consume_refresh_token（核心）

## goal

根治 refresh 慢请求（生产 1.2-3.5s）：把「遍历所有活跃 session 串行 bcrypt」改为「HMAC O(1) 定位 + 单次 bcrypt 确认」。66 次串行 bcrypt → 1 次 bcrypt（design §5.3，D-001/D-006）。

## implementation

1. `_consume_refresh_token`（service.py:248-314）重写开头：
   ```python
   token_id, _secret = parse_refresh_token(refresh_token)  # 旧格式无'.' → AuthTokenInvalid → 401
   target_hmac = hmac_token_id(token_id, self._settings)
   session = (await self._db.execute(
       select(SessionRow)
       .where(col(SessionRow.token_id_hmac) == target_hmac)
       .where(col(SessionRow.revoked_at).is_(None))
       .where(col(SessionRow.expires_at) > _utc_now())
   )).scalar_one_or_none()
   ```
2. 命中后**单次** bcrypt 确认 secret 段：
   ```python
   if not await asyncio.to_thread(verify_refresh_token, refresh_token, session.refresh_token_hash):
       raise AuthTokenInvalid("Refresh token is not recognised.")  # HMAC 命中但 secret 错（构造/碰撞）
   ```
3. user active 校验（deleted_at/status）保留；FOR UPDATE 行锁（select same id with_for_update，re-check revoked_at）保留原 R2 并发防护。
4. live 未命中或锁后失效 → `await self._find_revoked_session(refresh_token, target_hmac)`（grace/重放路径，task-06 实现）。

## 验收标准

- [ ] 正确 token → O(1) 命中活跃 session + bcrypt 通过 + 正常 rotate
- [ ] 构造 token（HMAC 命中但 secret 错）→ AuthTokenInvalid（双层防御不绕过）
- [ ] 旧格式 token（无 `.`）→ AuthTokenInvalid；token_id_hmac NULL 旧行不命中
- [ ] FOR UPDATE 行锁保留（锁期间被 rotate → revoked 检测）
- [ ] `verify_refresh_token` 整个 refresh 只调 1 次（性能）

## verify

- `cd backend && uv run pytest tests/modules/auth/ -q`（task-08 补 _consume O(1)/构造 token/旧格式/NULL 单测）

## constraints

保留 grace 窗口 / revoke_all_user_sessions / _mark_session_rotated 逻辑（design §5.5）；本 task 调用 `_find_revoked_session(refresh_token, target_hmac)`，其内部由 task-06 重写（本 task 先合调用点，task-06 改实现）；`col` 已从 sqlmodel 导入（service.py:26）。
