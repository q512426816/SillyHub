---
author: qinyi
created_at: 2026-06-13 23:59:42
---

# Tasks

> 变更：`2026-06-13-daemon-nodejs-rewrite`
> 任务按 Wave 分组，依赖方向：`W0 → (W1 ‖ W2) → W3 → W4 → W5`。
> 仅列任务名 + 对应文件路径，**细节（拆解/顺序/验收用例）在 plan 阶段展开**。

## W0 — 项目骨架

- **T-W0-01 Node 工程初始化** — `sillyhub-daemon/package.json`、`sillyhub-daemon/tsconfig.json`（strict）、`sillyhub-daemon/vitest.config.ts`
- **T-W0-02 共享类型定义** — `sillyhub-daemon/src/types.ts`（AgentEvent / TaskResult / DaemonMessage / Lease payload）
- **T-W0-03 协议常量定义** — `sillyhub-daemon/src/protocol.ts`（对齐 backend protocol.py）
- **T-W0-04 测试脚手架** — `sillyhub-daemon/tests/`（fixture 目录复用 Python 样本）

## W1 — 协议抽象层 ★（方案B 核心）

- **T-W1-01 ProtocolAdapter 接口 + AgentEvent IR** — `sillyhub-daemon/src/adapters/protocol-adapter.ts`
- **T-W1-02 stream_json adapter** — `sillyhub-daemon/src/adapters/stream-json.ts`（替代 `backends/stream_json.py`，claude/gemini/cursor）
- **T-W1-03 json_rpc adapter** — `sillyhub-daemon/src/adapters/json-rpc.ts`（替代 `backends/json_rpc.py`，codex/hermes/kimi/kiro）
- **T-W1-04 jsonl adapter** — `sillyhub-daemon/src/adapters/jsonl.ts`（替代 `backends/jsonl.py`，copilot）
- **T-W1-05 ndjson adapter** — `sillyhub-daemon/src/adapters/ndjson.ts`（替代 `backends/ndjson.py`，opencode/openclaw/pi）
- **T-W1-06 text adapter** — `sillyhub-daemon/src/adapters/text.ts`（替代 `backends/text.py`，antigravity）
- **T-W1-07 工厂 + provider 映射** — `sillyhub-daemon/src/adapters/index.ts`（替代 `backends/__init__.py`，`getBackend` + `PROTOCOL_PROVIDERS`）

## W2 — 基础设施（与 W1 并行）

- **T-W2-01 config** — `sillyhub-daemon/src/config.ts`（替代 `config.py`，DaemonConfig + config.json）
- **T-W2-02 credential** — `sillyhub-daemon/src/credential.ts`（替代 `credential.py`，0600 + `{{USER_*}}` 渲染）
- **T-W2-03 version** — `sillyhub-daemon/src/version.ts`（替代 `version.py`，semver 校验）
- **T-W2-04 workspace** — `sillyhub-daemon/src/workspace.ts`（替代 `workspace.py`，git mirror/pull/diff）
- **T-W2-05 agent-detector** — `sillyhub-daemon/src/agent-detector.ts`（替代 `agent_detector.py`，12 provider 探测）

## W3 — 通信层

- **T-W3-01 HubClient（REST）** — `sillyhub-daemon/src/hub-client.ts`（替代 `client.py`，lease 生命周期端点）
- **T-W3-02 WsClient（WebSocket）** — `sillyhub-daemon/src/ws-client.ts`（5s 重连 + HTTP 轮询兜底）

## W4 — 编排层

- **T-W4-01 TaskRunner** — `sillyhub-daemon/src/task-runner.ts`（替代 `task_runner.py`，编排链 + 子进程执行）
- **T-W4-02 Daemon 主类** — `sillyhub-daemon/src/daemon.ts`（替代 `daemon.py`，register/心跳/事件分发/lease 状态机）

## W5 — CLI + 冒烟 + 收尾

- **T-W5-01 CLI** — `sillyhub-daemon/src/cli.ts`（替代 `__main__.py`，commander: start/stop/status/logs）
- **T-W5-02 测试迁移** — `sillyhub-daemon/tests/**/*.test.ts`（1:1 迁移 17 个 Python 测试文件）
- **T-W5-03 真实 backend 冒烟** — 手动验证一次完整 lease（task_available→claim→start→messages→complete+patch）
- **T-W5-04 删除 Python 源码** — `sillyhub-daemon/sillyhub_daemon/**`、`sillyhub-daemon/pyproject.toml`（冒烟通过后）
- **T-W5-05 Docker/构建切换**（如涉及 daemon 镜像）— `deploy/docker-compose*.yml`
