---
author: qinyi
created_at: 2026-05-30T18:50:00
---

# Proposal: Agent Adapter 补全

## 动机

Goal 5 (task-14) 的核心目标是让平台能够受控启动 AI Agent（首发 Claude Code），执行任务并收集结果。现有 agent/ 模块已实现了基础的 Adapter 抽象层、ClaudeCodeAdapter（stream-json 协议）、context_builder 和 SSE 流式输出，但缺少以下关键能力：

1. **无法中断运行中的 Agent**：一旦启动只能等完成或超时，无法手动 kill
2. **无法收集代码变更**：Agent 执行后的 git diff 没有自动收集和关联
3. **前端无监控界面**：运维和开发人员无法直观查看 Agent 运行状态
4. **测试覆盖不足**：缺少 mock 子进程全流程测试和安全边界测试

## 关键问题

### 为什么现有方案不够？

1. **缺少 kill 机制**：ClaudeCodeAdapter 的 `_exec_stream` 创建子进程后没有保存引用，无法从外部终止。用户在 Agent 执行出错或耗时过长时无计可施。

2. **缺少 diff 收集**：Agent 执行完毕后，代码变更散落在 lease 目录中，没有统一的收集和展示机制。需要手动 git diff 查看，不利于审计和回溯。

3. **前端空白**：Agent 运行是平台的核心能力之一，但前端完全没有对应的监控界面，用户只能通过 API 查看状态。

## 变更范围

### Wave 1: 后端补全
- `agent/service.py`：新增 `_proc_registry` 进程映射 + `kill_run()` 方法
- `agent/diff_collector.py`：新增 `collect_diff()` 函数
- `agent/router.py`：新增 `POST /runs/{run_id}/kill` 端点
- `agent/schema.py`：新增 `AgentKillRequest` / `AgentKillResponse` schema
- `agent/service.py`：在 `_execute_run_background` 完成后调用 diff_collector

### Wave 2: 测试加固
- `agent/tests/test_kill.py`：kill 全流程测试（正常终止 + 超时强杀 + 不存在的 run）
- `agent/tests/test_diff_collector.py`：diff 收集测试（有变更 + 无变更 + 路径安全）
- `agent/tests/test_adapter_isolation.py`：allowed_paths 隔离 + 脱敏测试

### Wave 3: 前端监控页面
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`：列表页
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx`：详情页 + SSE

## 不在范围内（显式清单）

- ❌ 不做 Celery/ARQ 任务队列迁移（当前内存映射足够）
- ❌ 不做 Codex / Cursor 等其他 Agent 适配器（首发仅 Claude Code）
- ❌ 不做 Agent 并发调度 / 限流
- ❌ 不做 Agent 输出的持久化存储（仅 DB 记录摘要）
- ❌ 不做 Agent 运行的重试机制
- ❌ 不做 tool_policy 统一策略引擎（属于 Goal 6 范畴）

## 成功标准（可验证）

1. 运行中的 Agent Run 可通过 API kill，状态变为 `killed`，审计日志记录 kill 事件
2. Agent 执行完成后 `AgentRun.diff_summary` 字段包含 git diff 统计信息
3. `CLAUDE_ALLOWED_PATHS` 环境变量正确注入，隔离测试通过
4. 输出中不包含 PAT/secret 明文（脱敏验证）
5. 后端新增测试 ≥ 30，全套测试无回归
6. 前端 Agent Run 列表页展示所有 run（含状态 badge）
7. 前端详情页展示实时 SSE 日志流
8. 前端 Kill 按钮（仅 running 状态可用）
