---
plan_level: full
author: qinyi
created_at: 2026-07-27 22:10:00
revision: 2 (Wave 重排：service.py 三 task 拆独立 Wave 避并行冲突)
---

# 实现计划（Plan）— auth refresh token 加编号索引（O(1) 根治 refresh 慢）

> 来源：design.md rev2（D-001~D-008，已过 Design Grill 独立重审 spec+quality 双 pass）+ requirements.md（FR-01~FR-10, AC-01~AC-11）。纯后端变更，无前端/daemon 依赖。
>
> **Wave 重排说明（rev2）**：execute 同 Wave 内 task 强制并行（execute.js:600），task-04/05/06 都改 `service.py`，必须分到不同 Wave 串行（否则并行编辑冲突）。故从 3-Wave 重排为 5-Wave（CLI 拓扑排序建议）。

## Wave 1（基础：数据模型 + token helper + migration，无依赖，并行）

- [x] task-01: `backend/app/modules/auth/model.py` Session 加 `token_id_hmac` 列（String(64), nullable=True，裸 Column）+ `__table_args__` 加部分唯一索引 `ux_sessions_token_id_hmac`（unique=True, postgresql_where + sqlite_where 双方言，对齐 workspace/model.py:32-49 范式）（覆盖：FR-04, D-003）
- [x] task-02: `backend/app/core/security.py` `generate_refresh_token()` 改返回 `tuple[str,str]`（token=`{token_id}.{secret}`）+ 新增 `parse_refresh_token`（畸形抛 AuthTokenInvalid）+ 新增 `hmac_token_id`（HMAC-SHA256 hex，复用 settings.secret_key）+ import hmac/hashlib（覆盖：FR-01/02/03, D-002/005）
- [x] task-03: `backend/migrations/versions/202607271700_add_session_token_id_hmac.py` 新建 migration（接 head `202607270900`）：up=add_column + create_index（部分唯一，双 where）；down=drop_index + drop_column（覆盖：FR-10, D-008）

## Wave 2（_issue 写 token_id_hmac + 既有测试适配，依赖 W1，并行——不同文件无冲突）

- [x] task-04: `backend/app/modules/auth/service.py` import 加 parse_refresh_token/hmac_token_id；`_issue_token_pair` 解构 tuple + SessionRow 写 `token_id_hmac=hmac_token_id(token_id, settings)`（refresh_token_hash 仍 bcrypt）（覆盖：FR-05, D-004）
- [x] task-07: `backend/tests/modules/auth/test_refresh_grace_window.py:87` 适配 `generate_refresh_token()[0]` 取 token 串（既有绿测试，Grill B1）（覆盖：AC-11）

## Wave 3（_consume 重写 O(1)，依赖 W2 task-04 合入后再改同文件 service.py）

- [x] task-05: `backend/app/modules/auth/service.py` `_consume_refresh_token` 重写——parse token_id → HMAC → 部分唯一索引 O(1) 查活跃 session → 单次 bcrypt 确认 secret（命中但 secret 错→AuthTokenInvalid）；旧格式/NULL 旧行不命中→转 revoked 路径；保留 FOR UPDATE 行锁 + user active 校验（覆盖：FR-06/07/09, D-001/006）

## Wave 4（_find_revoked 重写 O(1)，依赖 W3 task-05 合入后再改同文件 service.py）

- [x] task-06: `backend/app/modules/auth/service.py` `_find_revoked_session` 重写——签名加 target_hmac，按 token_id_hmac O(1) 查 revoked session + 单次 bcrypt；去掉 `limit 50` 全扫（覆盖：FR-08, D-007）

## Wave 5（新增测试套，依赖全部实现）

- [x] task-08: 新增测试 `backend/tests/modules/auth/`：token 格式（generate tuple+split+parse 畸形+hmac 确定性）；_issue 含 token_id_hmac；_consume O(1)（正确命中/构造 token 拒/旧格式拒/NULL 旧行不命中）；_find_revoked O(1)（命中/secret 错/无匹配）；migration upgrade head 单头 + 部分唯一索引 NULL 行不冲突（覆盖：AC-01~AC-10）

> **注**：task-04/05/06 串行改同一 `service.py`（W2→W3→W4），每 Wave 单 task，无并行编辑冲突。测试在 Wave 边界跑（task-05/06 完成后 service.py 状态一致），中间态不被测。

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Session 加 token_id_hmac 列 + 部分唯一索引 | W1 | P0 | — | FR-04, D-003 | 裸 Column + __table_args__ Index 双 where |
| task-02 | generate_refresh_token 返 tuple + parse/hmac helper | W1 | P0 | — | FR-01/02/03, D-002/005 | security.py 加 hmac/hashlib import |
| task-03 | migration 202607271700（加列+部分唯一索引） | W1 | P0 | — | FR-10, D-008 | 接 head 202607270900，双 where |
| task-04 | _issue_token_pair 解构 tuple + 写 token_id_hmac | W2 | P0 | task-01,02 | FR-05, D-004 | service.py（W2 首改） |
| task-07 | test_refresh_grace_window.py [0] 适配 | W2 | P0 | task-02 | AC-11 | 既有绿测试防崩（不同文件，与 task-04 并行） |
| task-05 | _consume_refresh_token 重写 O(1) | W3 | P0 | task-01,02,04 | FR-06/07/09, D-001/006 | service.py（W3 二改，依赖 task-04 合入） |
| task-06 | _find_revoked_session 重写 O(1) | W4 | P0 | task-01,02,05 | FR-08, D-007 | service.py（W4 三改，依赖 task-05 合入） |
| task-08 | 新增 token/O(1)/migration 测试 | W5 | P0 | task-01~06 | AC-01~AC-10 | 含构造 token 双层防御 |

## 关键路径

task-02 → task-04 → task-05 → task-06 → task-08（service.py 串行链 + 测试，5 Wave 最长路径）。

## 全局验收标准

- [x] backend 全量测试绿（ruff + mypy + pytest）
- [x] `alembic upgrade head` 单头 `202607271700`，down 可逆；旧行 token_id_hmac NULL 不违反部分唯一索引（PG/SQLite 双 where）
- [x] refresh 的 bcrypt 调用从「活跃 session 数」降到 1 次（AC 性能断言：mock 100 session，verify_refresh_token 只调 1 次）
- [x] 构造 token（HMAC 命中但 secret 错）→ AuthTokenInvalid（双层防御不绕过）
- [x] 旧格式 token（无 `.`）→ AuthTokenInvalid；access token（JWT）链路不受影响
- [x] 不改 router/login/logout/change-password/access token（零回归）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-06 | AC-05（O(1) 命中+bcrypt 通过） |
| D-002@v1 | task-02 | AC-01（token 两段格式） |
| D-003@v1 | task-01, task-03 | AC-10（部分唯一索引 NULL 不冲突） |
| D-004@v1 | task-04 | AC-04（refresh_token_hash 仍 bcrypt） |
| D-005@v1 | task-02 | AC-03（hmac 复用 secret_key 确定性） |
| D-006@v1 | task-05, task-07 | AC-07（旧格式 token 失效） |
| D-007@v1 | task-06 | AC-08（revoked O(1) 命中） |
| D-008@v1 | task-03 | AC-10（migration 只加列不清表） |
