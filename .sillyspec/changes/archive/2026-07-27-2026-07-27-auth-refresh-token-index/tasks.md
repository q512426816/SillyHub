---
author: qinyi
created_at: 2026-07-27 17:42:00
---

# 任务清单（Tasks）— auth refresh token 加编号索引（O(1) 根治 refresh 慢）

> 依赖：design.md（D-001~D-008）+ requirements.md（FR-01~FR-10, AC-01~AC-11）。纯后端变更，无前端/daemon 依赖。Wave 分组供 plan 阶段细化为带依赖的任务表。

## Wave 1 — 数据模型 + token helper + migration（无依赖）

- **task-01**：`backend/app/modules/auth/model.py` Session 加 `token_id_hmac` 列（String(64), nullable=True，裸 Column 不带 unique/index）+ `__table_args__` 加部分唯一索引 `ux_sessions_token_id_hmac`（unique=True, postgresql_where + sqlite_where 双方言，对齐 workspace/model.py:32-49 范式）。（FR-04, AC-10）
- **task-02**：`backend/app/core/security.py` `generate_refresh_token()` 改返回 `tuple[str, str]`（token=`{token_id}.{secret}`）+ 新增 `parse_refresh_token`（split `.`，畸形抛 AuthTokenInvalid）+ 新增 `hmac_token_id`（HMAC-SHA256 hex，复用 settings.secret_key）+ 顶部 import hmac/hashlib。（FR-01/02/03, AC-01/02/03）
- **task-03**：`backend/migrations/versions/202607271700_add_session_token_id_hmac.py` 新建 migration（接 head `202607270900`）：up=op.add_column + op.create_index（部分唯一，postgresql_where + sqlite_where 双 where）；down=drop_index + drop_column。（FR-10, AC-10）

## Wave 2 — service 重写 O(1) 查找（依赖 Wave1 字段 + helper）

- **task-04**：`backend/app/modules/auth/service.py` import 加 parse_refresh_token/hmac_token_id；`_issue_token_pair` 解构 tuple（`refresh_token, token_id = generate_refresh_token()`）+ SessionRow 写 `token_id_hmac=hmac_token_id(token_id, settings)`（refresh_token_hash 仍 bcrypt）。（FR-05, AC-04）
- **task-05**：`backend/app/modules/auth/service.py` `_consume_refresh_token` 重写——parse token_id → HMAC → 部分唯一索引 O(1) 查活跃 session → 单次 bcrypt 确认 secret（命中但 secret 错→AuthTokenInvalid，NFR-02）；旧格式/NULL 旧行不命中→转 revoked 路径；保留 FOR UPDATE 行锁 + user active 校验。（FR-06/07, AC-05/06/07/09）
- **task-06**：`backend/app/modules/auth/service.py` `_find_revoked_session` 重写——签名加 target_hmac 参数，按 token_id_hmac O(1) 查 revoked session + 单次 bcrypt 确认；去掉 `limit 50` 全扫。（FR-08, AC-08）

## Wave 3 — 测试（依赖全部实现）

- **task-07**：`backend/tests/modules/auth/test_refresh_grace_window.py:87` 适配 `generate_refresh_token()[0]` 取 token 串（既有绿测试，Grill B1）。（AC-11）
- **task-08**：新增测试 `backend/tests/modules/auth/`：token 格式（generate 返回 tuple + split + parse 畸形抛 + hmac 确定性）；_issue 含 token_id_hmac；_consume O(1)（正确命中/构造 token 拒/旧格式拒/NULL 旧行不命中）；_find_revoked O(1)（命中/secret 错/无匹配）；migration upgrade head 单头 + 部分唯一索引 NULL 行不冲突（PG/SQLite 双 where）。（AC-01~AC-10）

## 关键路径

task-01（字段）+ task-02（helper）+ task-03（migration）→ task-04（_issue 写 token_id_hmac）→ task-05/06（_consume/_find_revoked 重写 O(1)）→ task-07/08（测试）。

## 验收（对照 requirements AC-01~AC-11）

backend 全量测试绿（ruff + mypy + pytest）+ migration `alembic upgrade head` 单头 `202607271700` + AC-01~AC-11 手动/集成验证（含构造 token 双层防御 AC-06、旧 token 失效 AC-07）。
