---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# Backend -- 已知问题、技术债、风险点

## 高优先级

### auth 模块完全无测试

`auth` 模块涉及 JWT 认证、密码哈希、Refresh Token 轮换、重放攻击检测、RBAC 权限检查。这些是安全关键路径，缺少测试可能导致：
- 权限绕过漏洞无法被检测
- Token 刷新竞态条件
- Refresh token 重放攻击检测失效
- Bootstrap admin 逻辑回归

涉及文件：`auth/service.py`, `auth/rbac.py`, `auth/router.py`, `auth/permissions.py`, `core/security.py`, `core/auth_deps.py`

### settings 模块无测试

`settings` 模块包含用户 CRUD 和平台配置更新，缺少测试可能导致：
- 用户创建/更新/删除逻辑回归
- 密码哈希一致性
- 平台配置验证缺失

### Agent 子进程可靠性

Agent 通过 `asyncio.create_subprocess_exec` 调用 Claude Code CLI：
- CLI 崩溃可能导致孤儿进程（有 `_proc_registry` + kill 机制，但仅在进程对象存活时有效）
- 服务重启时进程注册表丢失，仅靠 `cleanup_stale_runs` 标记为 failed（不实际终止进程）
- 长时间运行可能超时（`ClaudeCodeAdapter` 有 timeout 参数，默认 600s）
- fire-and-forget 模式（`asyncio.create_task`），异常仅记录日志不传播

### Refresh Token 查找性能

`AuthService._consume_refresh_token()` 遍历所有活跃 session 的 bcrypt 哈希来匹配 refresh token。注释中承认这对 V1 可接受（<1k 活跃 session），但不可扩展。如果活跃 session 数量增长，每次刷新都是 O(n) 次 bcrypt 验证。

## 中优先级

### 全局异常处理器捕获裸 Exception

`_unhandled` 处理器捕获所有 `Exception`，记录 `log.exception()` 并返回 500。这意味着未预期的异常不会被暴露到日志之外，开发时可能隐藏真正的 bug。但这是有意的设计选择，避免内部错误信息泄露给客户端。

### 审计上下文注入的静默失败

`_try_inject_audit_context()` 在 token 无效时静默跳过（`except Exception: return`）。这意味着如果 JWT 解码逻辑有 bug，审计上下文会静默丢失，不会报错。

### spec_profile 未完成实现

`spec_profile` 模块部分功能为占位实现：
- `policy.py` 中的阶段冲突检测和文档冲突检测
- 多个 TODO 标记

### M:N 查询的 N+1 问题

`enrich_summaries()` 方法对每个实体单独查询 M:N 关联表。注释中承认 "For MVP scale, per-item queries are sufficient"，但在大规模数据下会产生 N+1 查询问题。

涉及模块：`change/service.py`, `task/service.py`, `agent/service.py`

### datetime.utcnow() 使用

多处使用 `datetime.utcnow()`（Python 3.12 已标记为 deprecated，应使用 `datetime.now(UTC)`）。部分代码已使用 `datetime.now(UTC)`，但不一致。

### type: ignore / noqa 注释

约 12 处 `type: ignore` 和大量 `noqa` 标注。主要集中在：
- 复杂的 SQLAlchemy 类型推断
- FastAPI 依赖注入的类型对齐
- mypy 禁用了一批高噪音错误码

## 低优先级

### OpenTelemetry 占位

`telemetry.py` 仅有 stub 实现，`init_telemetry()` 仅记录日志不实际初始化 OTEL SDK。等待 V2 实现。

### CORS 配置宽松

`allow_methods=["*"]` 和 `allow_headers=["*"]` 允许所有方法和头部。开发阶段可接受，生产环境应收紧。

### Dockerfile 中 Claude Code 路径引用

`claude.exe` 在 Linux 镜像中创建 symlink，文件名包含 `.exe` 后缀，可能引起混淆（实际是 Node.js CLI）。

## 依赖风险

### Claude Code CLI 版本耦合

`CLAUDE_CODE_VERSION` 构建时注入 Dockerfile，升级需重建镜像。Claude Code CLI 的 stream-json 协议变更可能导致适配器不兼容。当前版本 2.1.158。

### SillySpec CLI 版本耦合

同上，`SILLYSPEC_VERSION` 构建时注入。当前版本 3.14.1。

### bcrypt 直接依赖

项目直接使用 `bcrypt` 库而非 `passlib`（`core/security.py` 注释说明了原因：passlib 的 bcrypt 后端检测在当前环境有兼容性问题）。这意味着 passlib 的 `passlib[bcrypt]` 依赖虽然声明了，但实际未使用。

## 架构风险

### 进程内状态 vs 分布式

- Agent 进程注册表 `_proc_registry` 是类属性（进程内共享），多实例部署时无法跨进程 kill
- `asyncio.create_task` 的后台任务在进程重启后丢失
- Redis Pub/Sub 在单实例场景正常，但多实例部署时需要考虑消息广播

### 数据一致性

- Service 方法直接操作文件系统 + 数据库，没有事务性保证（文件系统操作不可回滚）
- `reparse` 模式会删除文件系统中不存在的数据库记录，可能导致数据丢失（设计如此，文件系统是 source of truth）
