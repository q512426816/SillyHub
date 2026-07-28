# 验证报告 — 2026-07-27-auth-refresh-token-index（refresh token 加编号索引 O(1) 根治慢请求）

## 结论

**PASS**

refresh token 查找从「遍历全部活跃 session 串行 bcrypt」（生产 1.2-3.5s，占慢请求 95%）根治为「HMAC 部分唯一索引 O(1) 定位 + 单次 bcrypt 确认」。8 task 全完成，auth 模块 131 测试绿（含 26 新增对抗测试），双层防御 + 性能根治有测试铁证，migration 单头可逆，零回归。

## 任务完成度

8/8 task 全完成，每 task review.json verdict=pass（exec-2026-07-27-222439 run）：

| task | 内容 | 证据 |
|---|---|---|
| task-01 | Session 加 token_id_hmac 列 + 部分唯一索引（PG/SQLite 双 where） | model.py + migration 镜像 |
| task-02 | generate_refresh_token 返 tuple + parse_refresh_token + hmac_token_id | security.py |
| task-03 | migration 202607271700（加列 + 部分唯一索引，down 可逆） | alembic heads 单头 |
| task-04 | _issue_token_pair 解构 tuple + 写 token_id_hmac | service.py |
| task-05 | _consume_refresh_token 重写 O(1)（核心根治） | service.py + AC-09 性能断言 |
| task-06 | _find_revoked_session 重写 O(1)（去 limit 50 全扫） | service.py + AC-08 |
| task-07 | test_refresh_grace_window.py 适配 tuple 返回 [0] | Grill B1 |
| task-08 | 26 新增对抗测试覆盖 AC-01~AC-10 | test_refresh_token_index.py |

## 设计一致性

独立 QA 验收子代理（execute step 10）对照 design.md rev2 逐项核验，13 项 checklist **全 pass / 0 gap / 0 fail**，docHash `88fc51fbe9f704b6f4a1f4065ad665ccf9429ce921d15cfeaef861c70fdaf4cd` 一致（非伪造）：

- D-001 _consume O(1) HMAC 定位 + 单次 bcrypt ✅
- D-002 token 两段格式 `{token_id}.{secret}` ✅
- D-003 部分唯一索引 PG+SQLite 双 where（对齐 workspace/model.py 范式）✅
- D-004 _issue 写 token_id_hmac + refresh_token_hash 仍 bcrypt ✅
- D-005 hmac 复用 secret_key 确定性 ✅
- D-006 旧格式 token 部署后失效（parse 无点号→AuthTokenInvalid）✅
- D-007 _find_revoked O(1) 去 limit 50 ✅
- D-008 migration 只加列不清表 + 可逆 ✅

## 探针结果

**性能探针（根治铁证）**：`test_consume_o1_single_bcrypt_with_100_other_active_sessions`——插入 100 个其它活跃 session，patch `verify_refresh_token(wraps=real)` 断言 refresh 一个正确 token 时 `call_count == 1`（非 101）。证明 bcrypt 调用从「活跃 session 数」（生产实测 66）降到 **1 次**。

**安全探针（双层防御）**：`test_consume_rejects_forged_token_with_valid_hmac_but_wrong_secret`——构造 token（真 token_id + 假 secret `'0'*43`），HMAC 命中那行但 bcrypt 失败 → `AuthTokenInvalid`。证明不能靠 HMAC 命中绕过 bcrypt。

**旧格式探针**：无点号 token → `AuthTokenInvalid`（D-006）；token_id_hmac NULL 旧行不被误命中。

**migration 探针**：`alembic heads` 单头 `202607271700`；upgrade/downgrade SQLite 可逆 replay；部分唯一索引多 NULL 行共存、重复非 NULL 冲突（索引语义正确）。

## 测试结果

- auth 模块 `uv run pytest tests/modules/auth` = **131 passed, 2 xfailed**（105 既有 + 26 新增，零回归；2 xfail 是 test_refresh_grace_window.py 既有 RED-stage stale 标记，strict=False xpass 不失败）
- ruff check + ruff format + mypy 全过（变更文件）
- 全仓 3160 tests **collection 成功无错误** = 所有 import 完好（security/model/service 改动未破坏任何 importer）
- 隔离证明：grep 确认 generate_refresh_token/parse_refresh_token/hmac_token_id/token_id_hmac 调用方 100% 在 auth 模块内，零外部影响面

## 变更风险等级

**deployment-critical**（auth/session/refresh 关键词命中）。auth 是登录/续期/登出的核心，refresh 路径每次 token 刷新必经。变更触及 session 表结构（加列+索引）+ token 格式 + 核心查找算法。

### 已控风险

- **旧 token 失效（D-006）**：部署后所有现存 refresh token（旧格式无点号）立即 401，用户需重新登录一次。项目未正式上线（除 PPM），可接受。access JWT 在 `auth_access_ttl_minutes`（默认 30min）内仍有效，平滑过渡。
- **HMAC 命中 vs 未命中时序差**：残余可探测面，但 token_id=uuid4 不可枚举（design §7 B5 接受）。
- **并发安全**：FOR UPDATE 行锁 + 锁后复查 revoked_at 保留（R2），并发 refresh 同 token 只产生单一有效对。

## Runtime Evidence（deployment-critical 必填）

1. **O(1) 性能实测**：AC-09 测试在 100 活跃 session 压力下断言 `verify_refresh_token` 只调 1 次——直接证伪旧实现的 O(n) 串行 bcrypt（生产 66 session × 250-400ms = 1.2-3.5s 根因）。新实现单次 bcrypt ≈ 250-400ms，refresh 延迟从秒级降至亚秒级。
2. **双层防御实测**：AC-06 构造 token（HMAC 命中 + secret 错）被拒，证明 HMAC 索引不削弱 bcrypt 校验——即使攻击者构造出能命中索引的 token_id，仍过不了 secret 的 bcrypt。
3. **migration 可逆 + 索引语义**：AC-10 SQLite replay upgrade/downgrade 成功；部分唯一索引 `WHERE token_id_hmac IS NOT NULL` 允许多个 NULL 旧行共存（不破坏既有数据），同时禁止重复非 NULL（防 token_id 碰撞）。
4. **零回归**：131 auth 测试（含 login/logout/refresh/grace/api_key/change_password 全路径）全绿；3160 全仓 collection 无 import 破坏。
5. **生产验证（部署后补）**：部署后观察 backend `slow_request_middleware`（>1s）日志，`/api/auth/refresh` 应从慢请求清单消失；首日用户重登一次后 token 全量切新格式。

## 部署后观察项

- `/api/auth/refresh` 不再出现在 slow.request（>1s）日志。
- 部署后短期内 401 spike（旧 token 失效），属预期（D-006），用户重登后恢复。
- `alembic upgrade head` 在生产 PG 上加列 + 建部分唯一索引（NULL 行不冲突，不锁全表）。
