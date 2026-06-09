---
author: qinyi
created_at: 2026-06-09 23:01:00
---

# Tasks: Daemon Agent 检测体系扩展

## Wave 1: Agent 检测基础

- [ ] task-01: 扩展 AgentDetector — 12 种 agent 定义 + 环境变量覆盖 + 版本检测
  - `sillyhub-daemon/sillyhub_daemon/agent_detector.py`
  - `sillyhub-daemon/sillyhub_daemon/version.py`（新增）

## Wave 2: 执行协议层

- [ ] task-02: AgentBackend 抽象接口 + StreamJsonBackend（claude/gemini/cursor）
  - `sillyhub-daemon/sillyhub_daemon/backends/__init__.py`（新增）
  - `sillyhub-daemon/sillyhub_daemon/backends/stream_json.py`（新增）
- [ ] task-03: JsonRpcBackend（codex/hermes/kimi/kiro）
  - `sillyhub-daemon/sillyhub_daemon/backends/json_rpc.py`（新增）
- [ ] task-04: JsonlBackend + NdjsonBackend + TextBackend（copilot/opencode/openclaw/pi/antigravity）
  - `sillyhub-daemon/sillyhub_daemon/backends/jsonl.py`（新增）
  - `sillyhub-daemon/sillyhub_daemon/backends/ndjson.py`（新增）
  - `sillyhub-daemon/sillyhub_daemon/backends/text.py`（新增）

## Wave 3: Daemon 集成

- [ ] task-05: Daemon 多 runtime 注册循环
  - `sillyhub-daemon/sillyhub_daemon/daemon.py`
  - `sillyhub-daemon/sillyhub_daemon/client.py`
- [ ] task-06: TaskRunner 按 provider 分发执行
  - `sillyhub-daemon/sillyhub_daemon/task_runner.py`

## Wave 4: 前端展示

- [ ] task-07: Runtimes 页面 provider 展示增强
  - `frontend/src/app/(dashboard)/runtimes/page.tsx`
  - `frontend/src/lib/daemon.ts`

## Wave 5: 测试

- [ ] task-08: AgentDetector 单元测试（mock 检测、版本校验、环境变量覆盖）
- [ ] task-09: Backend 协议解析单元测试（各协议的 parse_output）
- [ ] task-10: 集成测试（daemon 启动 → 多 runtime 注册 → 任务执行）
