---
schema_version: 1
doc_type: module-card
module_id: core
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# core
## 定位
后端基础设施层，提供全局共享能力：配置、异步数据库会话、JWT/口令安全、Redis、加密、结构化日志、审计钩子、错误类型、spec 路径解析。被几乎所有业务模块依赖，本身不依赖任何业务模块。
## 契约摘要
- `get_settings() -> Settings`：pydantic-settings 单例，含 database_url/redis_url/secret_key/ttl/bcrypt_rounds/worktree_base_dir/spec_data_root 等字段。
- `get_engine()` / `get_session_factory()` / `get_session()`：asyncpg AsyncEngine + async_sessionmaker；`get_session` 依赖项同时注入审计上下文（actor 从请求 token 解析）。
- `create_access_token` / `decode_access_token` / `generate_refresh_token` / `hash_refresh_token` / `verify_refresh_token`：JWT 签发与校验，TokenPayload 含 sub/token_type/session_id。
- `get_current_user` / `get_optional_user` / `require_permission` / `require_permission_any` / `require_platform_admin` / `get_current_principal`：FastAPI 依赖项，无全局中间件，路由显式 opt-in。
- `CredentialCipher` / `get_cipher()`：Fernet 对称加密凭证（PAT 等），主密钥来自环境 `CREDENTIAL_MASTER_KEY`。
- `configure_logging` / `get_logger`：structlog 配置与绑定日志器。
- `register_audit_hooks(engine)`：在 AsyncEngine 上挂 SQLAlchemy after_insert/update/delete 事件，自动写 AuditLog。
- `repo_root()` / `resolve_spec_data_root(raw)` / `SpecPathResolver`：spec 数据目录路径解析与归一。
- `AppError` 及其全部子类：统一业务异常基类，`register_exception_handlers` 将其映射为 HTTP 响应。
## 关键逻辑
- 认证依赖链：请求 → `_extract_bearer`/`_extract_api_key` → `decode_access_token` → 取 User → `require_permission` 再查 rbac 权限集合。
- 审计写入：SQLAlchemy flush 后触发 hook → 收集变更字段 → 从 connection 拿 actor 上下文 → `_write_audit_log`。
- 凭证加解密：`get_cipher` 缓存单例，主密钥缺失抛 `MasterKeyMissing`；密钥版本不匹配抛 `CipherKeyMismatch`。
## 注意事项
- 无全局鉴权中间件，新路由必须显式声明 `Depends(require_permission(...))`，否则即公开端点。
- `get_session` 既是 DB 会话也是审计上下文注入点，事务内修改受审计表会自动落 AuditLog。
- 改 Settings 字段属破坏性变更，依赖方众多。
- 加密主密钥丢失即历史凭证不可解密，属运维高危项。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
