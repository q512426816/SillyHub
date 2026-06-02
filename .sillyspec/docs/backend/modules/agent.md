---
author: qinyi
created_at: 2026-05-30 20:20:00
---

# agent

> 最后更新：2026-06-02
> 最近变更：2026-06-02-spec-bootstrap-agent-stream-interaction
> 模块路径：`app/modules/agent/**`

## 职责

管理 AI Agent（Claude Code）的运行生命周期：启动、日志流收集、Kill 终止、diff 收集、状态管理、执行可靠性保证。通过适配器模式支持多种 Agent 类型。

## 当前设计

### 架构

```
AgentService（编排层）
  ├── ClaudeCodeAdapter（适配器）— subprocess 管理
  ├── DiffCollector（diff 收集）— git diff 脱敏
  ├── ContextBuilder（上下文构建）— CLAUDE.md 生成
  ├── ExecutionCoordinatorService（协调器）— 执行可靠性保证
  └── _proc_registry（进程注册表）— run_id → Process 映射
```

### 关键逻辑

1. **进程注册表**：`AgentService._proc_registry` 是类级别 dict，`run_id → asyncio.subprocess.Process`，所有实例共享
2. **Kill 机制**：先 SIGTERM，等 5s，未终止则 SIGKILL；仅 `pending`/`running` 状态可 kill
3. **Diff 收集**：agent 执行完成后自动调用 `collect_diff()`，结果写入 `AgentRun.diff_summary`
4. **Stale Run 清理**：`_cleanup_stale_runs()` 定期清理超过 1h 仍 running 的僵尸 run
5. **流式日志**：通过 Redis Pub/Sub SSE 实时推送 agent 输出
6. **执行可靠性保证**：`ExecutionCoordinatorService` 封装 6 个能力点：
   - **幂等创建**：`idempotency_key` 去重，相同 key 返回已有 AgentRun
   - **乐观锁**：`version` 字段 + UPDATE WHERE version=expected + rowcount 检测
   - **上下文指纹**：SHA-256 哈希 proposal+design+plan+task_markdown
   - **执行恢复**：`resume_token`（一次性）恢复 failed/killed 的 AgentRun
   - **进度快照**：`checkpoint_data` JSONB + `checkpoint_version` 递增
   - **审批门**：`approval_token`（一次性）管理高风险操作审批
7. **用户指导输入**：`AgentService.submit_run_input()` 接受用户对 `pending_input` 事件的回复，写入 `AgentRunLog(channel="user_input")` 并通过 Redis Pub/Sub 推送给订阅该 run 的 SSE 客户端。新增通道约定：`pending_input`（Agent 请求用户确认或指导）和 `user_input`（用户提交的指导文本）。

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /workspaces/{ws}/agent/runs` | `start_run()` | 启动 agent run（支持 idempotency_key） | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}` | `get_run()` | 查询单个 run | 前端 |
| `GET /workspaces/{ws}/agent/runs` | `list_runs()` | 列出 workspace runs | 前端 |
| `GET /workspaces/{ws}/tasks/{tid}/agent/runs` | `list_runs(task_id=)` | 列出 task runs | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/logs` | `get_run_logs()` | 获取历史日志 | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/stream` | `stream_run_logs()` | SSE 实时日志流 | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/kill` | `kill_run()` | 终止 running agent | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/resume` | `resume_run()` | 恢复中断的 run（需 resume_token） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/approve` | `approve()` | 审批 pending_approval 的 run（需 approval_token） | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/checkpoint` | `load_checkpoint()` | 获取最新 checkpoint | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/checkpoint` | `save_checkpoint()` | 保存 checkpoint（version 递增） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/input` | `submit_run_input()` | 向 AgentRun 提交用户指导文本（pending_input 通道回复） | 前端 |

## 关键数据流

```
前端 → POST /runs → AgentService.start_run()
  → ExecutionCoordinatorService.check_idempotency()   # 幂等检查
  → ContextBuilder.render_bundle_to_claude_md()
  → ExecutionCoordinatorService.compute_fingerprint()  # 上下文指纹
  → ExecutionCoordinatorService.generate_resume_token() # 恢复令牌
  → ClaudeCodeAdapter.run() [subprocess]
    → register_process() → _proc_registry[run_id] = proc
    → stdout → Redis Pub/Sub
    → unregister_process() → del _proc_registry[run_id]
  → DiffCollector.collect_diff()
  → AgentRun.diff_summary = result
```

```
前端 → POST /runs/{id}/kill → AgentService.kill_run()
  → proc.terminate() → wait 5s → proc.kill()
  → AgentRun.status = "killed"
```

```
前端 → POST /runs/{id}/resume → ExecutionCoordinatorService.resume_run()
  → 校验 resume_token + 可选校验 context_fingerprint
  → AgentRun.status = "pending", retry_count++
```

```
前端 → POST /runs/{id}/approve → ExecutionCoordinatorService.approve()
  → 校验 approval_token + 状态检查
  → AgentRun.status = "pending", token 置 NULL
```

```
前端 → POST /runs/{id}/input → AgentService.submit_run_input()
  → 校验 run 属于 workspace 且用户具备 WORKSPACE_WRITE
  → 创建 AgentRunLog(channel="user_input", content_redacted=content)
  → Redis Pub/Sub publish → SSE 推送到所有订阅该 run 的客户端
  ← { run_id, accepted: true }
```

```
Agent 执行中 → ClaudeCodeAdapter 输出 pending_input
  → AgentRunLog(channel="pending_input", content_redacted=问题文本)
  → Redis Pub/Sub publish → SSE 推送
  → 前端展示交互输入面板
  → 用户提交指导 → POST /input → 如上流程
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 类级别 `_proc_registry` | 无需外部状态存储，进程生命周期与 Python 进程一致 | 2026-05-30-agent-adapter |
| SIGTERM → SIGKILL 两阶段 kill | 给 agent 优雅退出的机会，超时强制终止 | 2026-05-30-agent-adapter |
| DiffCollector 独立模块 | 单一职责，复用 git_gateway 的 `redact_output()` | 2026-05-30-agent-adapter |
| 适配器模式（AgentAdapter 基类） | 支持多种 Agent 类型，当前实现 claude_code | 初始设计 |
| ExecutionCoordinatorService 分层 | 单一职责，AgentService 专注执行，Coordinator 专注可靠性 | 2026-05-30-execution-coordinator |
| AgentRun 字段扩展（不建新表） | 6 能力点高度内聚，共享同一模型；字段可 NULL 向后兼容 | 2026-05-30-execution-coordinator |
| 乐观锁用 version 字段 | 实现简单、无额外依赖、与 SQLModel/SQLAlchemy 兼容 | 2026-05-30-execution-coordinator |
| Checkpoint 存 JSONB 列 | 与 AgentRun 1:1 关系，数据量小，不需要独立表 | 2026-05-30-execution-coordinator |
| Fingerprint 用 SHA-256 | 碰撞概率可忽略、计算快速、输出固定 64 字符 | 2026-05-30-execution-coordinator |
| Token 一次性消费 | resume_token/approval_token 使用后置 NULL | 2026-05-30-execution-coordinator |
| pending_input/user_input 通道约定 | 用户指导作为结构化日志事件，复用 AgentRunLog + SSE 推送，不新增表或 schema enum | 2026-06-02-spec-bootstrap-agent-stream-interaction |

## 依赖关系

### 依赖本模块
- `router.py`（HTTP API 层）
- 前端 Agent 监控页面（W3 延后）

### 本模块依赖
- `core/errors`：`AgentRunNotFound`, `AgentRunNotRunning`, `AgentRunNotKillable`
- `core/redis`：Pub/Sub 日志流
- `core/db`：SQLAlchemy session
- `git_gateway/service`：`redact_output()` 脱敏
- `worktree/model`：`WorktreeLease` 路径解析
- `workspace/model`：workspace 关联
- `task/model`：task 关联

## 注意事项

- `_proc_registry` 不持久化，服务重启后 running 状态的 run 会变成孤儿 → 由 `_cleanup_stale_runs()` 处理
- `CLAUDE_ALLOWED_PATHS` 环境变量在 adapter 中注入，限制 agent 文件访问范围
- PAT 脱敏通过 `redact_output()` 实现，agent 输出中不会泄露 token
- DiffCollector 超时：stat 15s、full diff 30s，超时返回 `ZERO_DIFF_RESULT`
- Optimistic lock 冲突返回 409，客户端需获取最新 version 后重试
- Checkpoint 只保留最新快照（历史快照不保留）
- resume_token 和 approval_token 使用 `secrets.token_urlsafe(32)` 生成

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 2026-05-30-execution-coordinator | ExecutionCoordinatorService + AgentRun 9 字段 + 4 新端点 + 25 测试 |
| 2026-05-30 | 2026-05-30-agent-adapter | Kill API + Diff Collector + 进程注册表 + 40 新增测试 |
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | 新增 `submit_run_input()` 服务方法、`POST /runs/{id}/input` 端点、`pending_input`/`user_input` 通道约定、SSE 用户指导推送 |
