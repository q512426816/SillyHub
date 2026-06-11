---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 技术架构

## 技术栈

| 层级 | 技术 | 版本要求 |
|------|------|----------|
| 语言 | Python | >=3.12 |
| HTTP 客户端 | httpx | >=0.27 |
| WebSocket | websockets | >=12.0 |
| CLI 框架 | Click | >=8.0 |
| 构建 | hatchling | pyproject.toml |
| 测试 | pytest | >=9.0 (via dev) |

## 架构概览

```
                    +-------------------+
                    |  SillyHub Server  |
                    |  (FastAPI backend)|
                    +--------+----------+
                             |
                 REST API + WebSocket
                             |
                    +--------v----------+
                    |   HubClient       |  HTTP (httpx)
                    |   Daemon          |  WS   (websockets)
                    +--------+----------+
                             |
               +-------------+-------------+
               |             |             |
        +------v------+ +---v--------+ +--v----------+
        | TaskRunner  | | AgentDetector | | CredentialMgr|
        +------+------+ +---+--------+ +--^-----------+
               |              |             |
        +------v--------------v-------------v------+
        |            Backends (策略模式)              |
        | stream_json | json_rpc | jsonl | ndjson | text |
        +------+--------------------------------------+
               |
        +------v------+
        | WorkspaceMgr|  git clone/pull/diff
        +-------------+
```

## 核心组件

### Daemon (daemon.py)
- 核心守护进程管理，实现完整的生命周期：启动 -> 检测 Agent -> 注册 -> 后台循环
- 三个并行 asyncio 任务：heartbeat_loop、poll_loop、ws_loop
- WebSocket 自动重连（5 秒退避）
- 多 Agent 注册：每个检测到的 Agent 注册为独立的 runtime_id

### HubClient (client.py)
- 基于 httpx.AsyncClient 的 HTTP 客户端
- 覆盖完整 lease 生命周期：register -> claim -> start -> heartbeat -> submit_messages -> complete
- trust_env=False，绕过系统代理（本地通信）

### TaskRunner (task_runner.py)
- 任务执行引擎，编排完整的执行流程：workspace 准备 -> CLAUDE.md 写入 -> 凭证渲染 -> backend 分派 -> diff 收集
- 通过 `get_backend()` 工厂方法按 provider 获取对应的 AgentBackend 实现
- 事件回调机制：agent 执行事件实时转发到服务器

### AgentBackend (backends/)
- 抽象基类 `AgentBackend(ABC)`，定义 `execute()` 和 `parse_output()` 两个抽象方法
- 策略模式实现，5 种协议 backend：
  - **StreamJsonBackend**: claude/gemini/cursor，NDJSON 流式协议
  - **JsonRpcBackend**: codex/hermes/kimi/kiro，JSON-RPC 协议
  - **JsonlBackend**: copilot，JSONL 协议
  - **NdjsonBackend**: opencode/openclaw/pi，NDJSON 协议
  - **TextBackend**: antigravity，纯文本协议
- 懒加载工厂 `get_backend()` 避免循环依赖

### AgentDetector (agent_detector.py)
- 支持 12 种 Agent 的本地检测
- 检测优先级：环境变量覆盖 -> PATH 查找 -> 标记不可用
- 异步版本检测（`--version`）和最低版本校验

### CredentialManager (credential.py)
- 本地凭证存储，文件权限 0600
- `{{USER_*}}` 占位符渲染：凭证文件 -> 环境变量

### WorkspaceManager (workspace.py)
- git 仓库镜像策略（Strategy A: mirror workspace）
- clone / pull --ff-only / diff 收集
- Windows 兼容的 rmtree 错误处理

## 进程管理

- CLI 入口通过 Click 提供 4 个子命令：`start`、`stop`、`status`、`logs`
- PID 文件管理（`~/.sillyhub/daemon/daemon.pid`）
- 信号处理：stop 命令发送 SIGTERM
- 日志文件：`~/.sillyhub/daemon/daemon.log`

## 通信协议

- REST API: `/api/daemon/*` 端点
- WebSocket: `/api/daemon/ws?runtime_id=xxx` 实时任务通知
- 消息类型定义在 `protocol.py`，需与 server 端 `backend/app/modules/daemon/protocol.py` 保持同步
