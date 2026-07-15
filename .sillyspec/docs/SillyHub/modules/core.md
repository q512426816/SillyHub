---
schema_version: 1
doc_type: module-card
module_id: core
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# core

## 定位
后端基础设施层，被全部业务模块依赖。集中管理配置、数据库会话、安全（JWT/密码）、认证依赖、领域错误、Redis、加密、遥测、审计钩子、SillySpec 路径解析。不承载业务逻辑，只提供横切能力。

## 契约摘要
- `Settings`（BaseSettings 单例）：从环境变量注入，供全应用读取（secret_key、数据库 URL、Redis、OTel endpoint 等）。
- `get_session()`：FastAPI 异步数据库会话依赖，yield `AsyncSession`；业务 service 通过它注入 `session: AsyncSession`。
- `create_access_token / decode_access_token`：HS256 签发的 JWT，payload 见 `TokenPayload`；refresh token 用 `secrets` 生成并哈希存储，`AccessTokenError(code,message)` 为解码异常。
- 认证依赖：`get_current_user / get_optional_user / require_permission(p) / require_permission_any / require_platform_admin / get_current_principal`，从 Bearer 或 API Key 解析用户与权限，受保护端点直接声明。
- `AppError(code, http_status)`：领域错误基类，子类自带 code/http_status，由全局异常处理器转为统一 JSON（如 `WorkspaceNotFound`、`AgentRunNotFound`）。
- `get_redis()`：全局复用的 `redis.asyncio.Redis` 单例，`close_redis()` 优雅关闭。
- `CredentialCipher`：对称加密 credential 字段，密文携带 key_id 以支持 master key 轮转与匹配。
- `SpecPathResolver`：统一解析 `.sillyspec/changes|archive|knowledge|...` 路径，定义 PROPOSAL/DESIGN/PLAN/TASKS 文件名常量。
- `register_audit_hooks(engine)`：注册 SQLAlchemy ORM 事件钩子，向 audit_log 写入增删改记录。

## 关键逻辑
```
# 认证依赖链（受保护端点）
request → _extract_bearer 或 _extract_api_key → decode_access_token / ApiKeyService
       → get_current_user(User) → require_permission(p) 检查 rbac 权限集
# 数据库会话
create_async_engine(dsn) → async_sessionmaker → get_session() yield session
# 领域错误统一出口
raise AppError subclass → 全局 handler → {"code","message","details"}
# 审计
register_audit_hooks(engine) → after_insert/update/delete → _write_audit_log
```

## 注意事项
- `Settings` 严格从环境变量读取，新增可调参数必须在此声明并补默认值，禁止散落硬编码。
- JWT 默认 HS256 + `secret_key`，密钥变更会使所有现有 token 失效。
- `CredentialCipher` 加密依赖 master key，key_id 用于密文与密钥匹配；轮转时旧密文需重新加密。
- `audit_hooks` 基于 ORM 事件钩子，直接用 `connection.execute` 绕过 ORM 的写入不会产生审计记录。
- 全应用禁止直接 `SQLModel(...)`，数据模型必须继承 `models.base.BaseModel`，以便审计与元数据统一。

## 变更索引
- ql-20260627-001-a3f2 | `Settings` 新增 `auth_api_key_last_used_throttle_seconds`（API key `last_used_at` 写入节流，默认 60s，0=每次都写）。
- 2026-06-27-p0-perf-optimization | `Settings` 新增 `auth_api_key_cache_ttl`（默认 60s）/ `auth_api_key_negative_cache_ttl`（默认 30s）：API key 认证 Redis 正/负缓存 TTL。生产根因 cost12 bcrypt 同步阻塞事件循环的性能优化（2核1.6G 单用户即卡）。0=禁用对应缓存。
- 2026-07-15-change-password | `errors.py` 新增 `PasswordIncorrect`(401 `HTTP_401_PASSWORD_INCORRECT`) AppError 子类，供 `AuthService.change_password` 旧密码校验失败抛出（对齐既有 Auth* 错误类模式）。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
