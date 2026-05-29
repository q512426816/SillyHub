---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Design

## 参考实现

参考目录：`C:\Users\qinyi\IdeaProjects\multica`

抽取的核心模式：
- local daemon 按 workspace/provider 注册 runtime。
- heartbeat 维持 online 状态。
- runner 轮询并 claim task。
- 每个任务有独立 `{workspacesRoot}/{workspaceID}/{shortTaskID}/workdir|output|logs`。
- backend adapter 统一 Claude/Codex CLI。
- 消息流批量上报，session id 出现后 pin 住。
- watchdog 区分普通空闲和 tool call in-flight。
- daemon 提供 start/stop/status/logs/disk-usage 生命周期命令。

## 架构决策

### ADR-01: Local daemon 是一等 runtime

server 不直接在后端进程里跑 CLI。Local daemon 负责本机执行，server 负责任务、日志、审计和状态。

### ADR-02: claim task 是显式协议

runner 必须 claim 成功后才能执行。claim 要绑定 runtime_id，避免多个 runner 重复执行同一任务。

### ADR-03: Agent backend 抽象 CLI 差异

Claude、Codex 等 CLI 通过统一 `execute(prompt, options)` 抽象返回消息流和最终结果。

## API 设计

- `POST /api/runtimes/register`
- `POST /api/runtimes/{id}/heartbeat`
- `POST /api/runtimes/{id}/deregister`
- `POST /api/runner/tasks/claim`
- `POST /api/runner/tasks/{task_id}/start`
- `POST /api/runner/tasks/{task_id}/messages`
- `POST /api/runner/tasks/{task_id}/complete`
- `POST /api/runner/tasks/{task_id}/fail`
- `GET /api/agent-runs/{run_id}/events`

## 文件变更清单

- `backend/app/modules/runtime/model.py`
- `backend/app/modules/runtime/schema.py`
- `backend/app/modules/runtime/service.py`
- `backend/app/modules/runtime/router.py`
- `backend/app/modules/agent/adapters/`
- `backend/app/modules/agent/service.py`
- `backend/app/modules/worktree/service.py`
- `backend/app/modules/workflow/service.py`
- `runner/`（新增本地 daemon/CLI）
- `frontend/src/lib/runtime.ts`
- `frontend/src/app/(dashboard)/workspaces/[id]/runtime/`
- `frontend/src/app/(dashboard)/workspaces/[id]/agent/`

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| CLI 输出格式不稳定 | 日志解析失败 | adapter 层保留 raw messages |
| daemon 掉线任务悬挂 | Task 卡住 | heartbeat timeout + orphan recovery |
| 空闲超时误杀长工具 | 任务失败 | watchdog 识别 tool in-flight |
| 本地环境污染 | 难以复现 | 每任务隔离 workdir/output/logs |
