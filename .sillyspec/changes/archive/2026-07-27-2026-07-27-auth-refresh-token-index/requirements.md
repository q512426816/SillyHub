---
author: qinyi
created_at: 2026-07-27 17:42:00
---

# 需求（Requirements）— auth refresh token 加编号索引（O(1) 根治 refresh 慢）

## 功能需求（FR）

- **FR-01**（D-001/D-002）：refresh_token 改两段格式 `{token_id}.{secret}`：token_id=uuid4().hex（明文供索引），secret=secrets.token_urlsafe(32)（熵源）。`generate_refresh_token()` 返回 `tuple[str, str]`（refresh_token, token_id）。
- **FR-02**（D-002）：新增 `parse_refresh_token(token) -> tuple[str, str]`，按 `.` split；畸形输入（无 `.` / 空段）抛 `AuthTokenInvalid`。
- **FR-03**（D-003/D-005）：新增 `hmac_token_id(token_id, settings) -> str` = HMAC-SHA256(secret_key, token_id) hex（64 字符）；key 复用 `settings.secret_key`。
- **FR-04**（D-003）：Session 新增 `token_id_hmac` 列（String(64), nullable=True）+ 部分唯一索引 `ux_sessions_token_id_hmac WHERE token_id_hmac IS NOT NULL`（PG postgresql_where + SQLite sqlite_where 双方言）。
- **FR-05**（D-004）：`refresh_token_hash`（bcrypt 整个 token）仍存储不变；_issue_token_pair 同时写 token_id_hmac 与 refresh_token_hash。
- **FR-06**（D-001）：`_consume_refresh_token` 重写——parse token_id → HMAC → 部分唯一索引 O(1) 定位活跃 session（revoked_at IS NULL AND expires_at > now）→ 单次 bcrypt 确认 secret 段；HMAC 命中但 secret 错（构造 token）→ AuthTokenInvalid。
- **FR-07**（D-006）：旧格式 token（无 `.`）parse 失败 → AuthTokenInvalid → 401；token_id_hmac NULL 的旧行不命中。
- **FR-08**（D-007）：`_find_revoked_session`（grace/重放路径）同样按 token_id_hmac O(1) 查（revoked_at IS NOT NULL），不再 `limit 50` 全扫。
- **FR-09**：保留既有逻辑不变——FOR UPDATE 行锁（并发 rotate 防护）、grace 窗口续期、复用吊销 revoke_all、_mark_session_rotated/revoked、refresh 上层流程（_consume → _mark_rotated → _issue → commit）。
- **FR-10**（D-008）：migration 只加列 + 部分唯一索引，不清表；旧行 token_id_hmac 留 NULL 自然失效。

## 非功能（NFR）

- **NFR-01 性能**：refresh 的 bcrypt 调用次数从「活跃 session 数量」降到 **1 次**；live/revoked 查找均为 O(1) 索引查询。
- **NFR-02 安全/双层防御**：HMAC 定位 + bcrypt 验完整 token；攻击者构造 `{已知token_id}.{任意secret}` → HMAC 命中但 bcrypt 对比任意 secret≠真 secret → AuthTokenInvalid，无法绕过。
- **NFR-03 安全/HMAC 不可逆**：DB 只存 HMAC（不可逆），DB 泄露不暴露 token_id 列表（防御深度）。
- **NFR-04 兼容**：PG 生产（migration）+ SQLite 测试（create_all）索引形态一致（双 where 部分唯一索引，对齐 workspace/model.py 范式）。
- **NFR-05 零回归**：access token（JWT）、login/logout/change-password、router 端点签名全不变；既有 auth 测试除 generate_refresh_token 返回值适配外全绿。
- **NFR-06 跨平台**：纯 Python 标准库（hmac/hashlib/secrets/uuid），Windows/Linux/macOS 通用。

## 验收标准（AC）

- **AC-01**：`generate_refresh_token()` 返回 `(token, token_id)`，token 含且仅含一个 `.`，split 后 token_id=32 hex、secret 非空。
- **AC-02**：`parse_refresh_token` 对无 `.`、空 token_id、空 secret 抛 AuthTokenInvalid；正常 token 返回正确两段。
- **AC-03**：`hmac_token_id` 确定性（同 token_id+同 key 同结果），输出 64 hex。
- **AC-04**：新建 session 含 token_id_hmac 非空且 = hmac_token_id(token_id)；refresh_token_hash 仍为 bcrypt。
- **AC-05**：正确 refresh token → O(1) 命中活跃 session + bcrypt 通过 + 正常 rotate 续期（旧 session revoked/rotated，签发新对）。
- **AC-06**：构造 token（HMAC 命中但 secret 错）→ AuthTokenInvalid（NFR-02 双层防御）。
- **AC-07**：旧格式 token（无 `.`）→ AuthTokenInvalid；token_id_hmac NULL 旧行不命中。
- **AC-08**：revoked session（grace 窗口内）按 token_id_hmac O(1) 命中 + bcrypt 通过 → grace 续期；secret 错不返回；无匹配 None。
- **AC-09**：并发场景 FOR UPDATE 行锁保留（锁期间被 rotate → 走 revoked 检测）。
- **AC-10**：migration `alembic upgrade head` 单头 `202607271700`，down 可逆；旧行 token_id_hmac NULL 不违反部分唯一索引（PG/SQLite 双 where）。
- **AC-11**：backend 全量测试绿（ruff + mypy + pytest）；既有 test_refresh_grace_window.py 适配 generate_refresh_token()[0] 后绿。

## 决策覆盖

本需求覆盖 design.md §3 全部决策 D-001@v1 ~ D-008@v1（FR-01→D-001/002, FR-02→D-002, FR-03→D-003/005, FR-04→D-003, FR-05→D-004, FR-06→D-001, FR-07→D-006, FR-08→D-007, FR-10→D-008），无剩余未覆盖决策。
