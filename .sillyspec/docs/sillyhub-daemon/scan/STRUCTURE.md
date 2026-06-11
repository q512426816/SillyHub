---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 目录结构与模块说明

## 目录树

```
sillyhub-daemon/
+-- pyproject.toml                  # 项目元数据、依赖、构建配置
+-- sillyhub_daemon/                # 主源码包
|   +-- __init__.py                 # 包初始化，版本号 __version__ = "0.1.0"
|   +-- __main__.py                 # CLI 入口 (Click)，start/stop/status/logs 子命令
|   +-- daemon.py                   # 核心守护进程类 Daemon
|   +-- client.py                   # HTTP 客户端 HubClient (httpx)
|   +-- task_runner.py              # 任务执行引擎 TaskRunner
|   +-- config.py                   # 配置管理 DaemonConfig
|   +-- credential.py               # 本地凭证存储 CredentialManager
|   +-- workspace.py                # 工作空间管理 WorkspaceManager
|   +-- agent_detector.py           # Agent 检测器 AgentDetector
|   +-- protocol.py                 # 通信协议常量定义
|   +-- version.py                  # 语义版本解析与校验
|   +-- backends/                   # Agent 协议后端 (策略模式)
|       +-- __init__.py             # ABC 定义 + 工厂函数
|       +-- stream_json.py          # stream-json 协议 (claude/gemini/cursor)
|       +-- json_rpc.py             # JSON-RPC 协议 (codex/hermes/kimi/kiro)
|       +-- jsonl.py                # JSONL 协议 (copilot)
|       +-- ndjson.py               # NDJSON 协议 (opencode/openclaw/pi)
|       +-- text.py                 # 纯文本协议 (antigravity)
+-- tests/                          # 测试套件
    +-- __init__.py
    +-- test_cli.py                 # CLI 命令测试
    +-- test_client.py              # HubClient 测试
    +-- test_daemon.py              # Daemon 核心测试
    +-- test_daemon_multi_runtime.py # 多 Agent 注册测试
    +-- test_task_runner.py         # TaskRunner 测试
    +-- test_task_runner_provider_dispatch.py # Provider 分派测试
    +-- test_agent_detector.py      # AgentDetector 测试
    +-- test_backends_init.py       # Backends 基础设施测试
    +-- test_jsonl_backend.py       # JSONL backend 测试
    +-- test_json_rpc.py            # JSON-RPC backend 测试
    +-- test_ndjson_backend.py      # NDJSON backend 测试
    +-- test_stream_json_backend.py # StreamJSON backend 测试
    +-- test_text_backend.py        # Text backend 测试
    +-- test_credential.py          # CredentialManager 测试
    +-- test_workspace.py           # WorkspaceManager 测试
    +-- test_version.py             # 版本解析/校验测试
```

## 模块职责说明

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| CLI 入口 | `__main__.py` | Click 命令组，PID 文件管理，进程启停 |
| 守护进程 | `daemon.py` | Daemon 类：注册、心跳、轮询、WebSocket、任务分派 |
| HTTP 客户端 | `client.py` | HubClient：REST API 调用封装 |
| 任务执行 | `task_runner.py` | TaskRunner：任务编排、workspace 准备、backend 分派 |
| 协议常量 | `protocol.py` | 消息类型和任务状态常量（与 server 端同步） |

### 基础设施模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 配置 | `config.py` | DaemonConfig：JSON 配置持久化 |
| 凭证 | `credential.py` | CredentialManager：本地秘密存储与占位符渲染 |
| 工作空间 | `workspace.py` | WorkspaceManager：git 仓库镜像管理 |
| Agent 检测 | `agent_detector.py` | AgentDetector：12 种 Agent 的发现与版本检测 |
| 版本工具 | `version.py` | semver 解析和最低版本校验 |

### Backends 模块

| 文件 | 协议 | Provider |
|------|------|----------|
| `stream_json.py` | NDJSON stream-json | claude, gemini, cursor |
| `json_rpc.py` | JSON-RPC | codex, hermes, kimi, kiro |
| `jsonl.py` | JSONL | copilot |
| `ndjson.py` | NDJSON | opencode, openclaw, pi |
| `text.py` | 纯文本 | antigravity |

## 数据流

1. 用户运行 `sillyhub-daemon start` -> CLI 初始化各组件 -> Daemon.start()
2. AgentDetector 检测本地 Agent -> 为每个可用 Agent 向服务器注册独立 runtime
3. WebSocket 接收 task_available 通知 -> claim_lease -> start_lease
4. TaskRunner 准备 workspace -> 获取对应 backend -> 执行 agent -> 收集 diff
5. 事件通过 submit_messages 实时流式转发
6. complete_lease 上报最终结果
