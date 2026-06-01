---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# SillyHub Backend — 技术债务与关注点

## 1. 已知技术债务

### 1.1 Agent 执行模型

**问题**：当前 Agent 执行采用 fire-and-forget 同步模型，实际 agent 子进程在请求内启动。
虽然代码结构已为真正的任务队列替换预留接口，但缺少以下能力：

- 真正的异步任务队列（Celery / ARQ / 原生 asyncio.Queue）
- 执行超时自动 kill
- 进程级崩溃恢复
- 分布式调度（多实例部署时无法跨节点协调）

**影响**：长时间运行的 Agent 任务会阻塞请求线程，影响 API 响应性。

**建议**：引入 ARQ（基于 Redis 的异步任务队列），与现有 Redis 基础设施无缝集成。

### 1.2 Agent Service 单文件过大

**问题**：`agent/service.py` 达 828 行，职责过重（run 生命周期、子进程管理、进度推送、结果收集）。

**影响**：可维护性下降，测试难度增加。

**建议**：拆分为多个专职服务：RunLifecycleService, ProgressService, ResultCollector。

### 1.3 Coordinator 与 Service 职责重叠

**问题**：`ExecutionCoordinatorService`（534 行）与 `AgentService` 存在部分职责重叠，两者都参与 run 的创建和状态管理。

**建议**：明确分层 — Coordinator 负责可靠性保证（幂等、锁、指纹），Service 负责 Orchestration。

### 1.4 Context Builder 复杂度

**问题**：`context_builder.py`（461 行）构建 AgentSpecBundle 时涉及大量 DB 查询和文件系统操作，且保留了 legacy builder（backward compatibility）。

**建议**：移除 legacy builder，统一为新 bundle 接口；考虑引入缓存减少重复查询。

## 2. 认证与安全

### 2.1 Refresh Token 安全

**问题**：Refresh token 以 bcrypt 哈希存储在 users 表的单一字段中，用户所有 session 共享一个 refresh token。一旦泄露只能吊销当前 token。

**影响**：无法实现细粒度的 session 管理。

**建议**：独立 refresh_tokens 表，支持多 session、单 session 吊销。

### 2.2 MFA 延迟

**问题**：users 表保留了 MFA 相关列（占位），但 V1 未实现。

**影响**：企业安全合规要求可能无法满足。

**建议**：V2 实现 TOTP MFA。

### 2.3 JWT 密钥轮换

**问题**：HS256 单密钥签发，无密钥轮换机制。

**建议**：支持 kid（key ID）+ 密钥版本管理。

### 2.4 Platform Admin 全权绕过

**问题**：`is_platform_admin` 在 `has_permission()` 中直接 return True，无审计日志区分 admin 操作。

**影响**：admin 操作在审计日志中无法区分是否使用了超级权限。

**建议**：admin 操作记录特殊的 audit 标记。

## 3. 数据库

### 3.1 SQLite 测试兼容性

**问题**：测试使用内存 SQLite，但部分 PostgreSQL 特有功能无法测试：

- Partial unique index（workspace root_path 唯一性）
- JSONB 操作
- 高级 JOIN 语法

**影响**：部分 edge case 在测试中无法覆盖。

**建议**：关键路径使用 testcontainers-postgres 做集成测试。

### 3.2 缺少 DB 级约束文档

**问题**：31 个迁移版本缺乏统一的约束文档，FK 关系分散在各 migration 文件中。

**建议**：维护 DB Schema 参考文档（ER 图 + 约束清单）。

### 3.3 Soft Delete 一致性

**问题**：Workspace 支持 soft-delete（deleted_at），但其他表（User, Change 等）的删除策略不统一。

**建议**：统一 soft-delete 策略或明确记录哪些表支持。

## 4. 模块间耦合

### 4.1 直接 Model 跨模块引用

**问题**：部分模块直接 import 其他模块的 model 类（如 agent/service.py import task.model, change.model, workspace.model）。

**影响**：模块边界模糊，循环依赖风险。

**建议**：通过 service 接口访问，或定义共享 DTO。

### 4.2 Workspace 模块过重

**问题**：workspace 模块包含 scanner, parser, topology, relation_service 等多个子系统，是最复杂的模块之一。

**影响**：任何 workspace 相关变更都需要理解大量上下文。

**建议**：将 scanner/parser 拆分为独立的 workspace_detection 模块。

## 5. 可观测性

### 5.1 遥测仅 Stub

**问题**：`telemetry.py` 仅在配置了 OTEL endpoint 时输出一行日志，无实际 tracing/metrics 导出。

**影响**：生产环境缺少分布式追踪和性能指标。

**建议**：V2 集成 OpenTelemetry SDK，导出到 collector。

### 5.2 缺少 Metrics

**问题**：无请求延迟、错误率、Agent 执行时间等核心指标。

**建议**：引入 Prometheus metrics 端点。

### 5.3 日志级别控制

**问题**：全局 log_level 配置，无法按模块调整。

**建议**：支持 per-module log level 配置。

## 6. 性能

### 6.1 N+1 查询风险

**问题**：部分 list 端点可能存在 N+1 查询（如 workspace list 含关联 task 数）。

**建议**：审查 list 端点，使用 `selectinload` / `joinedload` 优化。

### 6.2 无查询分页标准

**问题**：部分 list 端点有分页，部分没有，分页参数不统一。

**建议**：定义标准分页 schema（cursor-based 或 offset-based）。

### 6.3 Redis 缺少连接池配置

**问题**：Redis 客户端使用默认连接池参数。

**建议**：根据负载调整 max_connections 等。

## 7. API 设计

### 7.1 缺少 API 版本控制

**问题**：所有端点在 `/api/` 下，无版本前缀。

**影响**：未来 breaking change 难以管理。

**建议**：`/api/v1/` 版本前缀。

### 7.2 错误码不统一

**问题**：部分错误码以 `HTTP_` 开头（如 `HTTP_404_WORKSPACE_NOT_FOUND`），部分不以（如 `FSM_INVALID_TRANSITION`）。

**建议**：统一错误码命名规范。

### 7.3 OpenAPI 文档

**问题**：Swagger UI 位于 `/api/docs`，但部分端点缺少详细 description。

**建议**：补全 OpenAPI operation description 和 response example。

## 8. 开发体验

### 8.1 无 CLI 工具

**问题**：缺少统一的开发 CLI（如 `make dev`, `make test`, `make migrate`）。

**建议**：引入 Taskfile 或 Makefile。

### 8.2 Docker 构建优化

**问题**：Dockerfile 可能缺少多阶段构建和层缓存优化。

**建议**：使用 uv pip install --no-dev 减小镜像体积。

### 8.3 pre-commit Hooks

**问题**：未配置 pre-commit hooks（ruff check/format）。

**建议**：添加 pre-commit 配置。

## 9. 改进优先级

| 优先级 | 项目 | 影响 | 工作量 |
|--------|------|------|--------|
| P0 | Agent 异步任务队列 | 高 | 大 |
| P1 | Refresh Token 表 | 中 | 中 |
| P1 | OTEL 集成 | 中 | 中 |
| P2 | Agent Service 拆分 | 中 | 中 |
| P2 | API 版本控制 | 低 | 小 |
| P2 | 错误码统一 | 低 | 小 |
| P3 | pre-commit hooks | 低 | 小 |
| P3 | per-module log level | 低 | 小 |
