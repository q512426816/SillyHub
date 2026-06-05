---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# agent
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/agent/**

## 职责

Agent 模块是 SillyHub 的 AI 执行引擎，负责管理 AI Agent 的生命周期：创建、执行、监控、终止、恢复和检查点。它通过适配器模式（Adapter Pattern）封装底层 AI 工具（当前为 Claude Code CLI），将 SillySpec 工作流中的各阶段任务分发给 Agent 执行。

核心能力包括：
- Agent 运行的创建与异步后台执行
- 进程生命周期管理（启动、终止、恢复）
- 实时日志流式输出（SSE + Redis Pub/Sub）
- 上下文构建（将 change/task/workspace 文档打包为 Agent 可用的 CLAUDE.md）
- 检查点（checkpoint）保存与恢复
- 审批流（approval token 机制）
- Worktree 租约管理与隔离执行
- Diff 收集与输出脱敏

## 当前设计

模块采用分层架构：

```
router.py          → HTTP 接口层（FastAPI 路由）
service.py         → 业务逻辑层（AgentService）
coordinator.py     → 协调器（乐观锁、指纹校验、恢复、审批）
context_builder.py → 上下文构建（TaskContext / AgentSpecBundle → CLAUDE.md）
base.py            → 抽象基类（AgentAdapter ABC）
adapters/
  claude_code.py   → Claude Code CLI 适配器（唯一实现）
diff_collector.py  → Git diff 收集
model.py           → 数据模型（AgentRun, AgentRunLog）
schema.py          → Pydantic 请求/响应 schema
coordinator_schema.py → 协调器专用 schema
```

### 关键类

| 类 | 文件 | 说明 |
|---|---|---|
| `AgentRun` | model.py | Agent 运行记录（SQLModel ORM） |
| `AgentRunLog` | model.py | Agent 运行日志条目 |
| `AgentService` | service.py | 核心业务服务，管理运行生命周期 |
| `ExecutionCoordinatorService` | coordinator.py | 协调器：乐观锁、指纹、恢复、审批 |
| `AgentAdapter` | base.py | 适配器抽象基类 |
| `ClaudeCodeAdapter` | adapters/claude_code.py | Claude Code CLI 适配器实现 |
| `AgentSpecBundle` | base.py | Agent 执行所需的完整上下文包 |
| `TaskContext` | base.py | 任务上下文（已废弃，保留兼容） |
| `DiffResult` | diff_collector.py | Diff 收集结果 |

## 对外接口（表格）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/workspaces/{workspace_id}/agent/runs` | 创建并启动 Agent 运行 |
| GET | `/workspaces/{workspace_id}/agent/runs/{run_id}` | 获取运行详情 |
| POST | `/workspaces/{workspace_id}/agent/runs/{run_id}/kill` | 终止运行中的 Agent |
| GET | `/workspaces/{workspace_id}/agent/runs/{run_id}/logs` | 获取运行日志 |
| GET | `/workspaces/{workspace_id}/agent/runs/{run_id}/stream` | SSE 流式获取日志 |
| GET | `/workspaces/{workspace_id}/agent/runs` | 列出 workspace 下所有运行 |
| GET | `/workspaces/{workspace_id}/tasks/{task_id}/agent/runs` | 列出 task 下所有运行 |
| POST | `/workspaces/{workspace_id}/agent/runs/{run_id}/resume` | 恢复已暂停的运行 |
| POST | `/workspaces/{workspace_id}/agent/runs/{run_id}/approve` | 审批通过（token 校验） |
| GET | `/workspaces/{workspace_id}/agent/runs/{run_id}/checkpoint` | 获取检查点 |
| POST | `/workspaces/{workspace_id}/agent/runs/{run_id}/checkpoint` | 保存检查点 |

## 关键数据流

```
用户/调度器 → router.create_agent_run
  → AgentService.start_run
    → 协调器: check_idempotency → compute_fingerprint
    → context_builder.build_spec_bundle (组装上下文)
    → _try_acquire_lease (获取 worktree 租约)
    → _execute_run_background (后台执行)
      → ClaudeCodeAdapter.run_with_bundle
        → 子进程执行 claude CLI
        → Redis Pub/Sub 发布日志
      → collect_diff (收集 diff)
      → 更新 AgentRun 状态
```

```
用户 → router.stream_agent_run_logs
  → Redis Pub/Sub 订阅
  → SSE 事件流推送到前端
```

```
调度器 → AgentService.start_stage_dispatch
  → build_stage_bundle (构建阶段上下文)
  → load_prompt_template (加载阶段 prompt)
  → SillySpecStageDispatchService 协调
```

## 设计决策（表格）

| 决策 | 原因 | 备注 |
|---|---|---|
| 适配器模式（AgentAdapter ABC） | 解耦具体 AI 工具，支持未来扩展其他后端 | 当前仅 ClaudeCodeAdapter |
| 乐观锁 + 指纹校验 | 防止并发冲突和上下文漂移 | coordinator.py |
| Redis Pub/Sub 日志流 | 支持多客户端实时订阅 Agent 输出 | SSE endpoint |
| 进程注册表（class 级别 dict） | 支持 kill 操作：SIGTERM → 超时 → SIGKILL | service.py |
| 检查点机制 | 支持长时间运行任务的断点续跑 | coordinator.py |
| 审批 token 机制 | 安全审批流，防止未授权审批 | coordinator.py |
| 输出脱敏（redact） | 防止 PAT/Bearer 等敏感信息泄露 | git_gateway.service.redact_output |

## 依赖关系

### 内部依赖（被本模块使用）

| 依赖模块 | 用途 |
|---|---|
| `app.core.auth_deps` | 权限校验（require_permission） |
| `app.core.db` | 数据库会话 |
| `app.core.errors` | 错误类型（AgentRunNotFound, AgentRunNotRunning 等） |
| `app.core.logging` | 日志 |
| `app.core.redis` | Redis 连接 |
| `app.modules.auth` | 用户模型、权限定义 |
| `app.modules.change` | Change/ChangeDocument 模型、dispatch、prompt 模板 |
| `app.modules.git_gateway` | 输出脱敏（redact_output） |
| `app.modules.git_identity` | Git 身份 |
| `app.modules.scan_docs` | ScanDocument 模型 |
| `app.modules.spec_profile` | SpecProfileProvider |
| `app.modules.spec_workspace` | SpecWorkspace 模型 |
| `app.modules.task` | Task 模型 |
| `app.modules.worktree` | WorktreeLease、ExecEnvBuilder |
| `app.modules.workspace` | Workspace、AgentRunWorkspace、TaskWorkspace、WorkspaceRelation |
| `app.modules.workflow` | AuditLog |
| `app.models.base` | BaseModel 基类 |

### 被依赖（其他模块使用本模块）

| 使用方模块 | 用途 |
|---|---|
| `change` (dispatch.py) | 调度 Agent 执行各阶段 |
| `change_writer` (router.py) | 触发 Agent 执行变更 |

## 注意事项

1. **进程安全**：kill 操作采用 SIGTERM → 等待超时 → SIGKILL 的渐进策略，需注意僵尸进程清理。
2. **Redis 依赖**：日志流强依赖 Redis Pub/Sub，Redis 不可用会降级为空流。
3. **租约隔离**：每次运行需要 worktree 租约，租约不足会创建失败。
4. **上下文构建**：`build_spec_bundle` 会递归获取关联 workspace（最多 depth=2），需防止循环引用。
5. **class 级别进程注册表**：AgentService 使用 class 变量存储进程引用，多实例部署时需注意一致性。
6. **output_redacted**：所有输出均经过脱敏处理，原始输出不落库。

## 变更索引（表格，初始为空）

| 变更 ID | 类型 | 简述 | 日期 |
|---|---|---|---|
| ql-20260605-002 | quick | auto_dispatch触发条件增加stage_completed | 2026-06-05 |
