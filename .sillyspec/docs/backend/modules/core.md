---
schema_version: 1
doc_type: module-card
module_id: core
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 横切基础设施（core）

## 定位
后端横切基础设施层：配置、数据库会话、Redis、JWT/口令安全、凭证加密、RBAC 权限缓存、审计钩子、SSRF 防护、结构化日志、监控、错误类型、spec 路径解析。被全部业务模块依赖，自身不依赖任何业务模块（`used_by` 覆盖所有模块）。无对外路由（`app/core/tests/` 除外），全部以函数/类/FastAPI 依赖项形态供各模块 import。

## 契约摘要
- `config.py` — `Settings`（pydantic-settings，~395 行）+ `get_settings()` 单例：
  数据库/Redis/secret_key/TTL（`auth_access_ttl_minutes`、`auth_refresh_grace_seconds`）、
  `spec_data_root` / `worktree_base_dir`（按 sys.platform 分支）、`file_allowed_type_set`
  文件白名单、`commit_sha`（缺失时 git rev-parse 兜底）。环境变量 > `.env`（非生产）> 类默认。
- `db.py` — `get_engine()` / `get_session_factory()` / `get_session()`：
  asyncpg 连接池（pool 20/overflow 30/timeout 30s/recycle 300s）+ 会话级超时
  （statement_timeout 30s、idle_in_transaction 120s、lock_timeout 5s；SQLite 测试分支忽略
  server_settings）。`get_session` yield 前从请求 token 注入审计上下文
  （`_try_inject_audit_context` → session.info）。
- `security.py` — `create_access_token` / `decode_access_token` / refresh 生成与 hash 校验；
  `TokenPayload`（sub/token_type/session_id）。
- `auth_deps.py` — `get_current_user` / `require_permission` / `require_permission_any` /
  `require_platform_admin` / `get_current_principal`；JWT 走 `Authorization: Bearer`
  （`?token=` query 回退已删），API Key 走 `X-API-Key` header-only。
- `permission_cache.py` — RBAC 三键权限缓存（`get/set_cached_permissions`，Redis 正/负缓存）+
  熔断器（`_breaker_is_open`/`_record_failure`/`_record_success`，Redis 故障时直查 DB）+
  PPM scope 缓存 + `invalidate_all_permissions`。
- `crypto.py` — `CredentialCipher`（NaCl `SecretBox`：encrypt(明文)→(密文, key_id) /
  decrypt(密文, key_id)）+ `get_cipher()` 单例；`MasterKeyMissing` / `CipherKeyMismatch`。
- `ssrf.py` — `assert_public_url`（scheme 白名单 + host 解析公网校验，IPv4/IPv6，
  `asyncio.to_thread` 防 DNS 阻塞事件循环）、`assert_safe_repo_url`、`UnsafeRepoUrl`。
- `audit_hooks.py` — `register_audit_hooks(engine)`：lifespan 挂 SQLAlchemy
  after_insert/update/delete 事件（幂等），`_should_audit` 过滤、`_collect_all_fields`/
  `_collect_changed_fields` 收集载荷、actor/workspace 取自 connection 审计上下文，
  `_write_audit_log` 落 audit_logs。
- `monitoring.py` — `slow_request_middleware`（>1s 打 slow.request）、
  `setup_slow_query_logging`（>500ms SQL 事件监听）、事件循环堵塞看门狗
  （`start/stop_event_loop_watchdog`，100ms 自检）、pg_stat_activity 采样
  （`_sample_pg_stat_activity`）。
- `errors.py` — `AppError` 家族（WorkspaceNotFound 等各域错误统一继承）+
  `register_exception_handlers` 统一映射 HTTP 响应；技术 ID 走 `details`。
- `paths.py` / `spec_paths.py` — `repo_root()` / `resolve_spec_data_root()` /
  `SpecPathResolver`（spec 数据目录解析与归一，Windows `C:/data/...`、Linux `/data/...`）。
- `redis.py` / `logging.py` / `telemetry.py` — `get_redis`/`close_redis`（供 API key
  正负缓存、RBAC 缓存、SSE pub/sub、daemon 心跳等消费）；`configure_logging`/`get_logger`
  （structlog JSON）；telemetry 当前为 stub（otel_endpoint 仅打日志，未接 OTel SDK）。

## 关键逻辑
```
认证依赖链: 请求 → _extract_bearer/_extract_api_key → decode_access_token
            → User → require_permission* 查 permission_cache
            (命中返回 / 未命中查 rbac 回填 / 熔断开直查 DB)
审计:       flush 后 after_insert/update/delete hook → 收集字段
            → connection 取 actor 上下文 → _write_audit_log
SSRF:       assert_public_url → scheme 检查 → to_thread 解析 host
            → 全部地址须公网; 私网/环回 → UnsafeRepoUrl
```

## 注意事项
- 无全局鉴权中间件：新路由不声明 `Depends(require_permission(...))` 即公开端点。
- `get_session` 同时是审计上下文注入点：事务内改受审计表自动落 AuditLog；actor 上下文
  缺失时钩子降级（不阻断业务）。
- 加密主密钥（`CREDENTIAL_MASTER_KEY`）丢失则历史 git 凭证不可解，属运维高危；
  换密钥靠 key_id 版本区分新旧密文。
- `Settings` 字段改动属破坏性变更（依赖方覆盖全部模块）；新增配置优先入 Settings。
- 用户可见报错文案中文（error-message-l10n 后），守护测试
  `tests/core/test_error_message_l10n.py` 强制新 raise message 含 CJK。
- 改 `spec_data_root` 路径语义需同时核对 Windows/Linux 分支与容器挂载路径
  （Windows Docker bind mount 的 stat 性能与脏 mtime 问题见 daemon/change 卡片）。
- permission_cache 熔断器打开期间权限判断直查 DB（性能回退，语义不变）；
  权限变更后须调 `invalidate_all_permissions` 或依赖短 TTL 收敛。
- telemetry 是 stub：otel 配置存在但不产生真实遥测，勿据其排障。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
