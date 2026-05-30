---
author: qinyi
created_at: 2026-05-30 20:20:00
---

# agent

> 最后更新：2026-05-30
> 最近变更：2026-05-30-agent-adapter
> 模块路径：`app/modules/agent/**`

## 职责

管理 AI Agent（Claude Code）的运行生命周期：启动、日志流收集、Kill 终止、diff 收集、状态管理。通过适配器模式支持多种 Agent 类型。

## 当前设计

### 架构

```
AgentService（编排层）
  ├── ClaudeCodeAdapter（适配器）— subprocess 管理
  ├── DiffCollector（diff 收集）— git diff 脱敏
  ├── ContextBuilder（上下文构建）— CLAUDE.md 生成
  └── _proc_registry（进程注册表）— run_id → Process 映射
```

### 关键逻辑

1. **进程注册表**：`AgentService._proc_registry` 是类级别 dict，`run_id → asyncio.subprocess.Process`，所有实例共享
2. **Kill 机制**：先 SIGTERM，等 5s，未终止则 SIGKILL；仅 `pending`/`running` 状态可 kill
3. **Diff 收集**：agent 执行完成后自动调用 `collect_diff()`，结果写入 `AgentRun.diff_summary`
4. **Stale Run 清理**：`_cleanup_stale_runs()` 定期清理超过 1h 仍 running 的僵尸 run
5. **流式日志**：通过 Redis Pub/Sub SSE 实时推送 agent 输出

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /workspaces/{ws}/agent/runs` | `start_run()` | 启动 agent run | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}` | `get_run()` | 查询单个 run | 前端 |
| `GET /workspaces/{ws}/agent/runs` | `list_runs()` | 列出 workspace runs | 前端 |
| `GET /workspaces/{ws}/tasks/{tid}/agent/runs` | `list_runs(task_id=)` | 列出 task runs | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/logs` | `get_run_logs()` | 获取历史日志 | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/stream` | `stream_run_logs()` | SSE 实时日志流 | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/kill` | `kill_run()` | 终止 running agent | 前端 |

## 关键数据流

```
前端 → POST /runs → AgentService.start_run()
  → ContextBuilder.render_bundle_to_claude_md()
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
  → AgentRun.status = "cancelled"
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 类级别 `_proc_registry` | 无需外部状态存储，进程生命周期与 Python 进程一致 | 2026-05-30-agent-adapter |
| SIGTERM → SIGKILL 两阶段 kill | 给 agent 优雅退出的机会，超时强制终止 | 2026-05-30-agent-adapter |
| DiffCollector 独立模块 | 单一职责，复用 git_gateway 的 `redact_output()` | 2026-05-30-agent-adapter |
| 适配器模式（AgentAdapter 基类） | 支持多种 Agent 类型，当前实现 claude_code | 初始设计 |

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

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-30 | 2026-05-30-agent-adapter | Kill API + Diff Collector + 进程注册表 + 40 新增测试 |
