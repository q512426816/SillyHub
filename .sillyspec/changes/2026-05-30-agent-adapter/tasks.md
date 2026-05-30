---
author: qinyi
created_at: 2026-05-30T18:51:30
---

# Tasks: Agent Adapter 补全

## Wave 1: 后端补全

### Task 1: Diff Collector 模块
- **文件**: `backend/app/modules/agent/diff_collector.py`（新增）
- **说明**: 实现 `collect_diff(lease_path)` 函数，执行 git diff 并返回 `DiffResult`。含 .git 检查、输出脱敏、截断逻辑。

### Task 2: 进程注册表 + Kill 机制
- **文件**: `backend/app/modules/agent/service.py`（修改）, `backend/app/modules/agent/adapters/claude_code.py`（修改）
- **说明**: 在 AgentService 中新增 `_proc_registry` 类属性，ClaudeCodeAdapter._exec_stream 注册/注销进程。新增 `kill_run()` 方法（SIGTERM→5s→SIGKILL）。

### Task 3: Kill API 端点
- **文件**: `backend/app/modules/agent/router.py`（修改）, `backend/app/modules/agent/schema.py`（修改）
- **说明**: 新增 `POST /workspaces/{ws_id}/agent/runs/{run_id}/kill` 端点，返回 AgentKillResponse。含权限检查和状态验证。

### Task 4: Diff 收集集成 + Stale Run 清理
- **文件**: `backend/app/modules/agent/service.py`（修改）
- **说明**: 在 `_execute_run_background` 完成后调用 `collect_diff()`，结果写入 `AgentRun.diff_summary`。新增 `_cleanup_stale_runs()` 清理重启后的 stale running 记录。

## Wave 2: 测试加固

### Task 5: Kill 全流程测试
- **文件**: `backend/app/modules/agent/tests/test_kill.py`（新增）
- **说明**: 测试正常 kill（SIGTERM 成功）、超时强杀（SIGKILL）、kill 不存在的 run、kill 已完成的 run、kill 无权限。Router 级别 mock subprocess。

### Task 6: Diff Collector 测试
- **文件**: `backend/app/modules/agent/tests/test_diff_collector.py`（新增）
- **说明**: 测试有变更、无变更、非 git 目录、大 diff 截断、输出脱敏。Mock subprocess 执行 git diff。

### Task 7: Adapter 隔离 + 脱敏测试
- **文件**: `backend/app/modules/agent/tests/test_adapter_isolation.py`（新增）
- **说明**: 测试 CLAUDE_ALLOWED_PATHS 环境变量注入、空 allowed_paths 不设置环境变量、输出中 PAT/secret 被脱敏、子进程工作目录正确。

## Wave 3: 前端监控页面

### Task 8: Agent API 客户端 + 类型
- **文件**: `frontend/src/lib/agent.ts`（修改 — 补充 Kill 接口）
- **说明**: 现有 agent.ts 已有基础 API 函数，本任务补充 `AgentKillResponse` 类型和 `killAgentRun` 函数。

### Task 9: Agent Run 列表页
- **文件**: `frontend/src/app/(dashboard)/workspaces/[id]/agent/page.tsx`（新增）, `frontend/src/components/agent/AgentRunCard.tsx`（新增）
- **说明**: 展示 workspace 下所有 AgentRun 列表。AgentRunCard 组件含状态 badge（pending/running/completed/failed/killed）、时间、agent_type。

### Task 10: Agent Run 详情页 + SSE 日志流
- **文件**: `frontend/src/app/(dashboard)/workspaces/[id]/agent/[runId]/page.tsx`（新增）, `frontend/src/components/agent/AgentLogStream.tsx`（新增）
- **说明**: 详情页展示运行信息 + SSE 实时日志流（EventSource API）+ Kill 按钮 + Diff Summary。日志按 channel 着色。
