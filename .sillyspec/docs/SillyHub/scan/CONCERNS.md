# SillyHub 技术关注点文档

author: qinyi
created_at: 2026-06-03T12:00:05

## 代码质量

- **大文件**: agent/service.py (71KB), claude_code adapter (37KB), settings/page.tsx (23KB) 需拆分
- **测试覆盖不均**: Daemon 最充分(17文件)，后端约30文件，前端仅3个lib测试，E2E为零
- **死依赖**: 前端 @tanstack/react-query、puppeteer、@playwright/test 已安装未使用
- **Lint**: 后端 Ruff 配置完善，前端 ESLint 基础配置
- **类型安全**: 后端 mypy strict=false, 前端 TypeScript strict

## 依赖风险

- **Claude Code 版本硬编码**: Dockerfile 中 CLAUDE_CODE_VERSION 固定，升级需手动改
- **Anthropic API 代理**: 核心功能依赖外部 API，无降级方案
- **Python 3.12 绑定**: 后端和 Daemon 均要求 >=3.12，部署环境受限
- **Next.js 14 版本锁**: App Router 稳定版，升级 15 需评估破坏性变更

## 1. 安全关注点

### 1.1 密钥管理

- **SECRET_KEY**：JWT 签名密钥，通过环境变量注入，生产环境必须设置
- **SILLYSPEC_MASTER_KEY**：SillySpec CLI 主密钥，生产环境必须设置
- **风险**：`.env` 文件不应提交到版本控制（已在 `.gitignore` 中）
- **建议**：考虑使用 HashiCorp Vault 或云密钥管理服务替代环境变量

### 1.2 Claude Code 权限

- Claude Code 以 `--permission-mode bypassPermissions` 运行，跳过所有交互式权限确认
- Agent 可以执行任意 shell 命令、写入任意文件
- **缓解措施**：通过 `allowed_paths` / `denied_paths` 限制工作目录范围
- **风险**：如果 Worktree 租约路径未正确隔离，Agent 可能访问宿主机文件

### 1.3 Git 凭证安全

- Git Identity 凭证使用 NaCl 加密存储在数据库中
- 加密密钥通过 `GIT_IDENTITY_ENCRYPTION_KEY` 环境变量传入
- **风险**：加密密钥泄露将暴露所有存储的 Git 凭证

### 1.4 Refresh Token 安全

- Refresh token 存储为 bcrypt 哈希，防止数据库泄露后直接使用
- 实现了重放检测（`AuthRefreshReused`），重用 token 将使所有 session 失效
- **建议**：考虑添加 refresh token 轮换策略（每次刷新生成新的 refresh token）

### 1.5 CORS 配置

- `cors_allowed_origins` 通过环境变量配置
- 开发环境通常允许 `http://localhost:3000`
- **风险**：生产环境必须严格配置允许的 origin 列表

### 1.6 Agent 子进程隔离

- Claude Code 作为子进程运行在宿主机上（Docker 环境中在容器内）
- **建议**：考虑使用沙箱（如 gVisor / Firecracker）进一步隔离 Agent 执行环境

## 2. 性能关注点

### 2.1 数据库连接池

- 连接池配置：pool_size=10, max_overflow=10
- **风险**：高并发场景下 20 个连接可能不足
- **建议**：监控连接池使用率，根据负载调整

### 2.2 内存 SQLite 测试限制

- 测试使用 SQLite 内存数据库，与生产 PostgreSQL 存在语法和类型差异
- **风险**：某些 PostgreSQL 特有功能（如 JSONB 操作、partial unique index）可能在 SQLite 测试中被忽略
- **建议**：关键业务逻辑添加 PostgreSQL 集成测试

### 2.3 Agent 执行超时

- Agent 子进程默认超时 600 秒（10 分钟）
- stdout 读取使用 `wait_for(timeout)` 逐行读取
- **风险**：长时间运行的 Agent 可能触发超时，stdout 缓冲可能溢出（10 MB 限制）

### 2.4 Redis 单节点

- Redis 作为单节点运行，无集群或哨兵配置
- **风险**：Redis 故障将导致 Agent 实时日志推送中断
- **建议**：生产环境考虑 Redis Sentinel 或 Cluster

### 2.5 SQLAlchemy 审计钩子

- 所有 BaseModel 子类的 insert/update/delete 都触发审计日志写入
- **风险**：高写入频率场景下审计日志表可能成为瓶颈
- **建议**：考虑异步审计（如写入消息队列再批量入库）

### 2.6 Docker 卷 I/O

- 后端容器挂载 `host-projects`、`worktree-data`、`spec-data` 等卷
- **风险**：大量文件扫描和 Agent 操作可能导致 I/O 瓶颈

## 3. 技术债务关注点

### 3.1 已废弃的 API

- `ClaudeCodeAdapter.run()`（legacy 接口）标记为 deprecated，应使用 `run_with_bundle()`
- `TaskContext` dataclass 标记为 deprecated，应使用 `AgentSpecBundle`
- `ChangeFSM`（`workflow/fsm.py`）标记为 deprecated，应使用 `StageEnum + TRANSITIONS`
- `ExecutionCoordinatorService.start_sillyspec_run()` 标记为 deprecated

### 3.2 迁移文件数量

- 当前有 38 个 Alembic 迁移文件，且包含一次合并迁移（`4d9236aa3abb_merge_heads.py`）
- **风险**：随着项目演进，迁移链可能变得复杂且难以管理
- **建议**：定期执行 squash migration，合并历史迁移

### 3.3 部分模块缺少测试

- `auth` 模块无测试文件（认证逻辑通过 conftest 的 auth_admin_token 间接覆盖）
- `health`、`settings` 模块无测试文件
- 部分模块仅有 1-2 个测试文件，覆盖面较窄

### 3.4 Mypy 配置宽松

```ini
strict = false
disable_error_code = ["attr-defined", "union-attr", "assignment", "arg-type", ...]
```
禁用了大量类型检查错误码，类型安全性较弱。

### 3.5 前端测试覆盖不足

- 前端仅有 3 个测试文件（api.test.ts, agent.test.ts, spec-workspaces.test.ts）
- 页面组件无测试
- 状态管理无测试

### 3.6 Telemetry 仅为 Stub

- `telemetry.py` 仅包含 no-op 实现，当 `OTEL_ENDPOINT` 为空时跳过
- **影响**：生产环境缺乏链路追踪和指标采集

### 3.7 dispatch 模块中的 sqlite3 导入

- `change/dispatch.py` 顶部导入了 `sqlite3` 标准库
- **风险**：可能是历史遗留代码，生产环境不应使用 SQLite

### 3.8 硬编码的调度链限制

- `auto_dispatch_next_step` 限制连续自动调度最多 10 次（`_DISPATCH_CHAIN_LIMIT = 10`）
- **风险**：复杂变更可能超过此限制导致调度中断

### 3.9 conftest 中的数据库 URL

- `conftest.py` 硬编码了 `DATABASE_URL` 默认值为 `postgresql+asyncpg://...`
- 实际测试使用内存 SQLite（`db_engine` fixture 覆盖）
- **风险**：Settings 加载时仍会尝试解析 PostgreSQL URL（虽不影响测试，但语义混乱）

### 3.10 前端 API 客户端文件数量

- `src/lib/` 包含 20+ 个 API 客户端文件，每个文件对应一个后端模块
- **建议**：考虑使用 OpenAPI code generator 自动生成 TypeScript 类型
