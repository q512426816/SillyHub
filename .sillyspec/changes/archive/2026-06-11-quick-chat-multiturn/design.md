---
author: qinyi
created_at: 2026-06-11 08:50:00
---

# Quick Chat 多轮对话设计

## 现状

Quick Chat 每次发送创建新 AgentRun + 新 Claude CLI 进程（`-p` 单轮模式），无上下文延续。

## 方案

利用 Claude CLI 的 `session_id` + `--resume` 机制实现多轮对话，不新增数据库表。

### 数据流

1. 前端发送 prompt 时带上可选的 `run_id`（上一轮的 run_id）
2. 后端收到带 `run_id` 的请求时，从该 AgentRun 的 `session_id` 字段读取上次的 session
3. 创建新 AgentRun，在 lease metadata 中存储 `resume_session_id`
4. daemon claim 时把 `resume_session_id` 传给 task_runner → stream_json backend
5. stream_json backend 在 `_build_args()` 中加入 `--resume <session_id>`
6. 执行完成后，把返回的 `session_id` 存入新 AgentRun 的 `session_id` 字段
7. 后端把新 `run_id` 和 `session_id` 返回前端，前端记住用于下一轮

### 改动文件

- `backend/app/main.py` — quick-chat POST 接受可选 `prev_run_id` 参数，读取 session_id
- `backend/app/modules/daemon/service.py` — `complete_lease` 时存 session_id 到 AgentRun
- `frontend/src/app/(dashboard)/runtimes/page.tsx` — QuickChatPanel 记住 lastRunId
- `frontend/src/lib/daemon.ts` — quickChat API 加 prevRunId 参数
- `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py` — `_build_args` 支持 resume
- `sillyhub-daemon/sillyhub_daemon/task_runner.py` — 传递 resume_session_id 到 backend
