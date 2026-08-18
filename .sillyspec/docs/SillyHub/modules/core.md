---
schema_version: 1
doc_type: module-card
module_id: core
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 后端基础设施层（core）

## 定位
后端基础设施层，被全部业务模块依赖。集中提供配置、数据库会话（含审计上下文注入）、安全（JWT/密码/refresh token）、认证依赖、领域错误体系、Redis、凭证加密、遥测、结构化日志、慢请求/事件循环监控、审计钩子、权限缓存、SSRF 校验、SillySpec 路径解析。
只提供横切能力，不承载任何业务逻辑。

## 契约摘要
- **配置**（`Settings`，BaseSettings 单例）——全应用唯一配置出口，新增可调参数必须在此声明并给默认值：
  - 基础：数据库/Redis URL、secret_key、日志级别、环境、CORS 白名单、OTel endpoint、commit sha。
  - 认证类：access TTL（默认 30 分钟）/refresh TTL/refresh 宽限秒、bcrypt 轮数、API key 正负缓存 TTL 与 last_used 写节流、登录限流与失败阈值/窗口、captcha token TTL。
  - 权限缓存：TTL + 熔断阈值/冷却时间。
  - 平台引导：bootstrap 管理员三元组（email/password/display_name，均可空）。
  - spec 数据：`spec_data_root` + host/container 路径前缀映射 + shared/tar 传输模式（容器内路径↔宿主路径换算，支撑 Docker bind mount 场景）。
  - 其它：worktree 基目录、daemon 分发目录、技能 bundle 目录、对象存储（backend 类型 + S3 五元组）、文件校验阈值、LiteLLM 网关（base_url/master key/hub 代理地址）。
- **数据库**：`get_engine / get_session_factory / get_session()`——异步引擎 + FastAPI 会话依赖；`get_session` 尝试从请求 token 解出用户注入会话审计上下文（user_id/request_id），供 audit_hooks 落审计行；`dispose_engine()` 优雅关闭。
- **安全**：
  - HS256 JWT 签发/解码；`TokenPayload.email` 可空（username-only 账号 email=NULL 不崩），decode 后无人消费 email。
  - refresh token：secrets 生成、仅哈希存储、HMAC token_id、过期计算、verify 走 bcrypt。
  - 密码：`_PasswordHasher`（bcrypt，轮数可配）。
- **认证依赖**：`get_current_user / get_optional_user / require_permission / require_permission_any / require_platform_admin / get_current_principal`——从 Bearer 或 API Key 双通道解析用户；权限判定的数据聚合在 auth.rbac，此处只做依赖装配。
- **错误体系**：`AppError`——message 优先构造，code/http_status 为类默认 + 可按实例覆盖（translator 场景免建一次性子类）；全局异常处理器统一序列化 `{code, message, request_id, details}`；各业务错误子类集中定义于此（WorkspaceNotFound 等），报错文案已全面中文化。
- **审计钩子**：`register_audit_hooks(engine)` 注册 ORM after_insert/update/delete 事件，向 audit_log 写增删改记录（变更前后字段 diff、审计上下文、表名单数化 action）。
- **凭证加密**：`CredentialCipher`——对称加密 credential 字段，密文自带 key_id 支持主密钥轮转匹配；密钥缺失/不匹配抛结构化 AppError。
- **监控**：慢请求中间件（超阈值异步采 `pg_stat_activity` 阻塞链，节流防风暴）+ 事件循环 watchdog（阻塞告警任务）+ 慢 SQL 引擎日志（仅 PG）。
- **权限缓存**：Redis 缓存用户权限集与 PPM data scope；熔断器（连续失败开闸冷却、期间降级直查 DB）；`invalidate_all_permissions` 全量失效。
- **SSRF**：
  - `assert_public_url`：scheme 白名单 + host 解析公网校验（IPv4+IPv6），每次调用重新解析防 DNS 重绑定；用于 webhook/http_get 等替用户外呼入口。
  - `assert_safe_repo_url`：git URL 形态白名单（https/ssh/git:// + scp-like），拒 ext::、file、Windows 盘符等本地路径形态。
- **路径**：
  - `repo_root / resolve_spec_data_root`——spec 数据根解析（含修复迁移逻辑）。
  - `SpecPathResolver`——SillySpec v4 目录布局统一解析，双模式：repo-native（`<root>/.sillyspec/...` 包裹）与 platform-managed（扁平，root 即内容根），`for_spec_workspace` 工厂按 spec_workspace.strategy 自动选模式；定义标准文档文件名常量（proposal/design/plan/tasks/verify-result/module-impact/MASTER）与旧名映射（verification.md→verify-result.md）。

## 关键逻辑
```
# 认证依赖链
request → _extract_bearer 或 _extract_api_key → decode_access_token / ApiKeyService
       → get_current_user(User) → require_permission(p) 查 rbac 权限集（优先 Redis 权限缓存+熔断）

# 数据库 + 审计
get_session() → _try_inject_audit_context(session, request)
ORM write → audit_hooks after_* → _write_audit_log(带 user_id/request_id/字段 diff)

# 领域错误统一出口
raise AppError 子类（可实例覆盖 code/http_status）→ 全局 handler → 统一 JSON + request_id

# spec 路径
SpecPathResolver.for_spec_workspace(ws) → strategy==platform-managed ? 扁平布局 : .sillyspec 包裹
```

## 注意事项
- `Settings` 是唯一配置出口，禁止业务模块散落硬编码参数；改环境变量名/默认值需同步部署配置与文档。
- audit_hooks 基于 ORM 事件：直接 `connection.execute` 绕过 ORM 的写入不产生审计记录；全应用数据模型必须继承 `models.base.BaseModel`。
- `ssrf.py` 是 façade——IP 原语（`assert_public_hostname`）实际在 `tool_gateway.tool_policy`，core 对 modules 存在这一处受控反向依赖，改 IP 原语须两侧同步。
- `SpecPathResolver` 双模式是平台托管工作区与仓库原生工作区的分界；新读写 `.sillyspec` 的代码必须走 resolver，禁止手拼路径。
- JWT 默认 HS256 + `secret_key`，密钥变更使所有存量 token 失效；`CredentialCipher` 主密钥轮转后旧密文需重加密（key_id 匹配旧密钥解密）。
- 权限缓存有熔断降级语义：Redis 故障自动降级直查 DB，调用侧勿再包 try/except 改变行为。
- 监控采样与告警有节流窗口（防风暴），调整阈值走 Settings，勿在代码里另设第二套阈值。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
