---
id: task-02
title: generate_refresh_token 返 tuple + parse_refresh_token/hmac_token_id helper
author: qinyi
created_at: 2026-07-27 22:15:00
priority: P0
depends_on: []
blocks: [task-04, task-05, task-06, task-07, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-002@v1, D-005@v1]
allowed_paths:
  - backend/app/core/security.py
goal: refresh_token 改 {token_id}.{secret} 格式，generate_refresh_token 返回 (token, token_id) tuple；新增 parse_refresh_token（畸形抛 AuthTokenInvalid）+ hmac_token_id（HMAC-SHA256 hex，复用 secret_key）。
implementation: security.py 顶部 import hmac/hashlib；generate_refresh_token 改返回 tuple（uuid4().hex + secrets.token_urlsafe(32)）；新增 parse_refresh_token（split('.',1)，无'.'/空段抛 AuthTokenInvalid）；新增 hmac_token_id（hmac.new(secret_key, token_id, sha256).hexdigest()）；hash_refresh_token/verify_refresh_token 不变（仍 bcrypt 完整 token）。
acceptance: generate 返回 (token, token_id) 且 token 含一个 '.'；parse 畸形抛 AuthTokenInvalid、正常返两段；hmac 确定性（同 id+key 同结果，64 hex）。
verify: cd backend && uv run pytest tests/modules/auth/ -q（task-08 加新单测）；python -c 交互验 generate/parse/hmac。
constraints: 不改 access token（JWT）/hash_refresh_token/verify_refresh_token；AuthTokenInvalid 既有异常（确认 import）；secret_key 取自 Settings（hmac_token_id 接收 settings 参数）。
provides:
  - contract: RefreshTokenHelpers
    fields: [generate_refresh_token_tuple, parse_refresh_token, hmac_token_id]
expects_from: {}
---

# task-02 · security.py token helper

## goal

把不透明 refresh_token 升级为可索引的两段格式 `{token_id}.{secret}`，并提供解析 + HMAC 指纹 helper，供 service O(1) 查找（design §5.1，D-002/D-005）。

## implementation

1. `backend/app/core/security.py` 顶部加 `import hashlib` + `import hmac`（现有 import secrets/uuid）。
2. 改 `generate_refresh_token()`（现 security.py:162 返回 str）：
   ```python
   def generate_refresh_token() -> tuple[str, str]:
       token_id = uuid.uuid4().hex
       secret = secrets.token_urlsafe(32)
       return f"{token_id}.{secret}", token_id
   ```
3. 新增 `parse_refresh_token(token: str) -> tuple[str, str]`：无 `.` 或空段 → raise `AuthTokenInvalid`（确认该异常已 import）；否则 split('.',1) 返回 (token_id, secret)。
4. 新增 `hmac_token_id(token_id: str, settings) -> str`：`hmac.new(settings.secret_key.encode(), token_id.encode(), hashlib.sha256).hexdigest()`（64 hex）。
5. `hash_refresh_token` / `verify_refresh_token` **不变**（仍对完整 `{token_id}.{secret}` 做 bcrypt，D-004 验 secret 段）。

## 验收标准

- [ ] `generate_refresh_token()` 返回 `(token, token_id)`，token 含且仅含一个 `.`
- [ ] `parse_refresh_token` 对无 `.`/空 token_id/空 secret 抛 AuthTokenInvalid
- [ ] `hmac_token_id` 确定性：同 token_id + 同 settings 同输出，64 hex

## verify

- `cd backend && uv run pytest tests/modules/auth/ -q`（task-08 补 helper 单测）
- `cd backend && python -c "from app.core.security import generate_refresh_token, parse_refresh_token, hmac_token_id; t,i=generate_refresh_token(); print(t,'|',parse_refresh_token(t))"`

## constraints

不改 access token（JWT，security.py:86-156）；不改 hash/verify_refresh_token；`hmac_token_id` 接收 settings 参数（不读全局，便于测试注入）。
