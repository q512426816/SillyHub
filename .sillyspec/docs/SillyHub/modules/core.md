---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# core
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/core/**

## 职责

应用基础设施层，提供配置管理、数据库连接、Redis 连接、安全认证、错误处理、日志、审计钩子、加密、遥测、SillySpec 路径解析和布局迁移等横切关注点。

- **config** — 基于 pydantic-settings 的全局配置管理（环境变量 / .env）
- **db** — AsyncEngine + async session factory，自动注入审计上下文
- **redis** — 异步 Redis 连接的获取与关闭
- **security** — JWT access token 签发/验证、bcrypt 密码哈希、refresh token 管理
- **auth_deps** — FastAPI 依赖注入：当前用户解析、权限校验（require_permission / require_permission_any / require_platform_admin）
- **errors** — 统一异常层级（AppError 及子类）+ 全局异常处理器注册
- **logging** — structlog 日志配置
- **audit_hooks** — SQLAlchemy 事件钩子，自动写入审计日志
- **crypto** — NaCl 对称加密（CredentialCipher），用于敏感凭据存储
- **telemetry** — OpenTelemetry 初始化
- **spec_paths** — SpecPathResolver，统一 .sillyspec 目录路径解析
- **layout_migration** — 工作区目录布局迁移

## 当前设计

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `Settings` | config.py | 全局配置单例，包含 DB/Redis/Auth/Worktree 等 20+ 字段 |
| `TokenPayload` | security.py | JWT token 解码后的 payload 模型 |
| `_PasswordHasher` | security.py | bcrypt 密码哈希封装 |
| `AppError` | errors.py | 所有业务异常的基类，包含 status_code / error_code / detail |
| `SpecPathResolver` | spec_paths.py | .sillyspec 路径解析器，提供 changes_root / archive_dir / db_path 等 |
| `CredentialCipher` | crypto.py | NaCl secretbox 对称加解密 |

### 关键函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `get_settings()` | config.py | LRU-cached 获取 Settings 实例 |
| `get_engine()` | db.py | 获取/创建 AsyncEngine |
| `get_session()` | db.py | FastAPI 依赖，提供 AsyncSession |
| `get_redis()` / `close_redis()` | redis.py | Redis 连接获取与关闭 |
| `create_access_token()` | security.py | 签发 JWT access token |
| `decode_access_token()` | security.py | 解码并验证 JWT |
| `get_current_user()` | auth_deps.py | 从请求提取并验证用户 |
| `require_permission()` | auth_deps.py | 权限校验依赖工厂 |
| `register_exception_handlers()` | errors.py | 注册全局异常处理器到 FastAPI app |
| `register_audit_hooks()` | audit_hooks.py | 注册 SQLAlchemy after_insert/update/delete 钩子 |
| `configure_logging()` | logging.py | 配置 structlog |
| `get_cipher()` | crypto.py | 获取 CredentialCipher 实例 |
| `init_telemetry()` | telemetry.py | 初始化 OpenTelemetry |
| `migrate_layout()` | layout_migration.py | 执行工作区目录布局迁移 |

### 错误层级

errors.py 定义了约 20 个 AppError 子类，按域分组：
- **工作区**：WorkspacePathNotFound / NotDir / NotSillyspec / Duplicate / PermissionDenied / NotFound / SlugDuplicate
- **Spec**：SpecWorkspaceNotFound / ScanDocNotFound / SpecConflictNotFound
- **关联**：RelationNotFound / SelfLoop / Duplicate
- **Agent**：AgentRunNotFound / NotRunning
- **变更**：ChangeNotFound / DocNotFound
- **任务**：TaskNotFound
- **认证**：AuthTokenMissing / Invalid / Expired / InvalidCredentials / RefreshReused / UserInactive
- **权限**：PermissionDenied
- **状态机**：InvalidTransition
- **Worktree**：WorktreeLeaseNotFound / AlreadyReleased / AcquireFailed
- **加密**：CipherKeyMismatch / MasterKeyMissing

## 对外接口

core 模块不直接暴露 HTTP 端点，通过 Python API 供其他模块调用：

| 函数/类 | 类型 | 说明 |
|---------|------|------|
| `get_session` | FastAPI 依赖 | 提供 DB session |
| `get_current_user` | FastAPI 依赖 | 提取当前认证用户 |
| `require_permission` | FastAPI 依赖工厂 | 权限校验 |
| `require_platform_admin` | FastAPI 依赖 | 平台管理员校验 |
| `get_redis` | 函数 | 获取 Redis 实例 |
| `register_exception_handlers` | 函数 | 注册到 FastAPI app |
| `register_audit_hooks` | 函数 | 注册到 AsyncEngine |
| `Settings` | 类 | 全局配置 |

## 关键数据流

1. **请求认证流**：Request → auth_deps.get_current_user() → security.decode_access_token() → User
2. **审计日志流**：SQLAlchemy after_insert/update/delete → audit_hooks → 审计记录写入 DB
3. **配置加载流**：环境变量 / .env → Settings (BaseSettings) → get_settings() 单例
4. **凭据加密流**：plaintext → CredentialCipher.encrypt() → ciphertext + key_id → DB 存储

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| pydantic-settings 管理配置 | 类型安全、环境变量自动映射 | python-decouple / dotenv 手动管理 |
| structlog 结构化日志 | 便于日志分析和搜索 | 标准 logging |
| bcrypt 密码哈希 | 工业标准，可调 rounds | argon2 / scrypt |
| NaCl secretbox 加密 | 认证加密，简洁 API | AES-GCM 手动实现 |
| AppError 统一异常层级 | 统一错误响应格式 | 分散在各模块的异常处理 |
| LRU cache 管理单例 | 简单高效，线程安全 | 手动单例模式 |

## 依赖关系

### 内部依赖
- `app.models.base` — BaseModel

### 外部库
- fastapi — Web 框架、依赖注入
- pydantic / pydantic-settings — 数据验证、配置管理
- sqlalchemy (async) — 异步 ORM
- sqlmodel — SQLModel ORM 基类
- redis (async) — 异步 Redis 客户端
- bcrypt — 密码哈希
- python-jose — JWT 编解码
- nacl (pynacl) — 对称加密
- structlog — 结构化日志
- opentelemetry — 遥测

## 注意事项

- `get_settings()` 使用 `@lru_cache`，测试时需调用 `get_settings.cache_clear()` 重置
- `audit_hooks` 通过 SQLAlchemy event 注册，需在 engine 创建后调用 `register_audit_hooks()`
- `CredentialCipher` 依赖环境变量 `MASTER_KEY`，缺失时抛出 MasterKeyMissing
- `auth_deps` 直接依赖 `app.modules.auth` 的 User 和 Permission，存在循环风险（core → auth → core），但通过 FastAPI Depends 延迟解析缓解

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| | | |
