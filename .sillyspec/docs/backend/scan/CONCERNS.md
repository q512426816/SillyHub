---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# Backend 代码债务与风险

## 代码质量

### [RED] Quick Chat 端点内联在 main.py
- **位置**：`app/main.py:112-195`
- **问题**：`_register_quick_chat()` 函数包含完整的路由定义、原始 SQL 和业务逻辑，直接写在 `main.py` 中，违反了项目自身的模块化约定
- **影响**：维护困难，无法单独测试，与 `agent` 模块的架构模式不一致
- **建议**：抽取到 `modules/agent/quick_chat.py` 或独立模块

### [RED] Quick Chat 使用原始 SQL
- **位置**：`app/main.py:135-166`
- **问题**：使用 `sqlalchemy.text()` 写原始 INSERT/UPDATE SQL，绕过了 SQLModel ORM 和审计 hooks
- **影响**：审计日志缺失，SQL 注入风险（虽然使用了参数化查询），与 ORM 模式不一致
- **建议**：改用 SQLModel ORM 操作

### [YELLOW] Spec Profile 多处 TODO 未实现
- **位置**：`modules/spec_profile/provider.py:76,86,96` 和 `modules/spec_profile/policy.py:61,97`
- **问题**：5 个 TODO 标记，涉及 actual discovery、loading、stage conflict detection、document conflict detection
- **影响**：Spec Profile 功能不完整
- **建议**：追踪为后续任务，在 design 文档中标记未完成状态

### [YELLOW] AgentAdapter 只有一个实现
- **位置**：`modules/agent/adapters/claude_code.py`
- **问题**：抽象基类 `AgentAdapter` 只有一个实现，接口抽象可能过早或与实际需求不匹配
- **影响**：未来添加新 adapter 时可能需要重构接口

### [YELLOW] 部分模块缺少独立测试
- **涉及模块**：knowledge, runtime, scan_docs, settings
- **影响**：这些模块的 bug 不容易被 CI 捕获
- **建议**：优先补充 settings 和 runtime 测试

## 依赖风险

### [RED] Claude Code CLI 依赖
- **问题**：核心功能依赖 `@anthropic-ai/claude-code` npm 包（版本固定 2.1.158），通过 CLI 子进程调用
- **风险**：CLI 接口变更可能无声破坏集成；版本升级需要重新测试整个 agent 流程
- **缓解**：Dockerfile 中固定版本号

### [YELLOW] passlib 兼容性问题
- **位置**：`core/security.py:41-47`
- **问题**：代码注释明确说明绕过了 passlib，因为 "local bcrypt wheel is incompatible with passlib's bcrypt backend detection"
- **影响**：直接使用 bcrypt 库而非 passlib 抽象层，如果未来需要支持其他哈希算法需要额外工作
- **现状**：已通过自定义 `_PasswordHasher` 类封装，不影响功能

### [YELLOW] mypy 配置过于宽松
- **位置**：`pyproject.toml [tool.mypy]`
- **问题**：`strict = false`，禁用了 9 个错误码（attr-defined, union-attr, assignment 等）
- **影响**：类型安全网较弱，许多类型错误不会被捕获
- **建议**：逐步收紧，优先启用 assignment 和 arg-type

### [GREEN] OpenTelemetry 为空实现
- **位置**：`core/telemetry.py`
- **问题**：仅输出 stub 日志，无实际追踪/指标采集
- **影响**：生产环境缺乏可观测性
- **现状**：已预留接口，未来可无缝接入

## 架构风险

### [YELLOW] 全局单例模式
- **涉及**：`get_settings()`, `get_redis()`, `get_engine()`, `get_session_factory()`
- **问题**：通过模块级全局变量 + `@lru_cache` 实现单例，测试中需要手动重置
- **影响**：测试隔离性受影响
- **缓解**：`dispose_engine()` 和 `close_redis()` 用于清理

### [YELLOW] 20 个路由模块注册在 main.py
- **位置**：`app/main.py:197-223`
- **问题**：所有路由手动 import 和注册，每次新增模块需修改 main.py
- **建议**：考虑自动发现机制

### [GREEN] Docker 入口脚本
- **位置**：`docker-entrypoint.sh`
- **问题**：ruff 配置中排除对该文件的检查，可能存在 shell 兼容性问题
- **缓解**：Dockerfile 中执行 `sed -i 's/\r$//'` 处理行尾符

## 迁移风险

### [YELLOW] 38 个迁移文件无 merge head 管理
- **问题**：仅发现一个 merge head 文件（`4d9236aa3abb_merge_heads.py`），多分支并行开发时可能产生冲突
- **建议**：确保团队协调迁移文件创建顺序

### [GREEN] 迁移文件命名规范
- 所有迁移按日期时间命名，格式统一
- 但迁移文件较多，建议定期考虑 squash
