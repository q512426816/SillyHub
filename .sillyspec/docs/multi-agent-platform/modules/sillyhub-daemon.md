---
schema_version: 1
doc_type: module-card
module_id: sillyhub-daemon
author: qinyi
created_at: 2026-06-11T09:05:00+08:00
---

# sillyhub-daemon

## 定位
本地守护进程，运行在用户机器上，负责检测本地已安装的 Agent（Claude Code、Codex、Cursor 等），注册到 SillyHub 后端，接收任务并委派给对应的 Agent 后端执行。

边界：
- 包含：Agent 检测、运行时注册、WebSocket 心跳、任务轮询、CLI 后端执行、工作空间管理
- 不包含：任务调度（由后端 placement 模块负责）、前端 UI（由 frontend 模块负责）

## 契约摘要

### 入口命令
`sillyhub-daemon start --server <URL> --token <JWT>`

### 核心组件
| 组件 | 文件 | 职责 |
|------|------|------|
| Daemon | daemon.py | 主循环：检测→注册→WS/心跳/轮询→任务分发 |
| AgentDetector | agent_detector.py | 检测本地已安装 Agent（claude/codex/cursor/gemini 等） |
| TaskRunner | task_runner.py | 任务执行引擎：准备 workspace→选 backend→执行→收集 diff |
| HubClient | client.py | 与后端 REST API 通信（注册/心跳/claim/complete） |
| CredentialManager | credential.py | 渲染 `{{USER_*}}` 凭据占位符 |
| WorkspaceManager | workspace.py | 本地 workspace 镜像（clone/pull/diff） |

### Agent 后端（backends/）
| 后端 | 文件 | 协议 |
|------|------|------|
| StreamJsonBackend | stream_json.py | NDJSON stream-json（Claude CLI `-p --output-format stream-json`） |
| TextBackend | text.py | 纯文本 stdout |
| JsonlBackend | jsonl.py | JSONL 协议 |
| NdjsonBackend | ndjson.py | NDJSON 协议 |
| JsonRpcBackend | json_rpc.py | JSON-RPC 协议 |

### 与后端通信协议
- REST: `/api/daemon/runtimes`（注册）、`/api/daemon/heartbeat`、`/api/daemon/leases/claim`、`/api/daemon/leases/complete`
- WebSocket: `/api/daemon/ws?runtime_id=<id>`（实时任务推送）
- HTTP 轮询: `/api/daemon/leases/pending`（WS 不可用时的降级方案）

## 关键逻辑

```
启动流程:
1. AgentDetector.detect_all() → 检测本机已安装 Agent
2. HubClient.register() → 每个 Agent 注册为独立 runtime
3. 并发启动三个循环:
   - _heartbeat_loop: 定期 HTTP 心跳
   - _poll_loop: HTTP 轮询待处理任务
   - _ws_loop: WebSocket 实时接收任务推送

任务执行:
1. WS/poll 收到 task_available → claim_lease → start_lease
2. TaskRunner.execute_task():
   a. prepare_workspace (clone/pull)
   b. 写 CLAUDE.md
   c. 渲染凭据 → env
   d. get_backend(provider) → 选对应后端
   e. backend.execute() → 拉起 CLI 子进程
   f. collect_diff → 统一 diff
3. complete_lease → 上报结果

Claude CLI 交互:
- stdin 写入 prompt 后保持 OPEN（CLI 会发 control_request）
- 自动 approve 所有 control_request（bypassPermissions 模式）
- 支持 --resume <session_id> 多轮对话
- 收到 result 事件后关闭 stdin
```

## 注意事项

1. **Windows 兼容**: `.cmd` 包装文件需解析到实际 `.exe` 路径
2. **stdin 管理**: Claude CLI 需要stdin 保持打开以接收 control_response，不能过早关闭
3. **WebSocket 超时**: 必须设置 `open_timeout` 防止阻塞 asyncio 事件循环
4. **JSON 列变更检测**: SQLAlchemy JSON 列原地修改需 `flag_modified()` 标记
5. **多 Agent 注册**: 每个 Agent 作为独立 runtime 注册，心跳需逐个发送
6. **会话恢复**: 通过 `--resume <session_id>` 实现多轮对话上下文延续

## 变更索引

- ql-20260611-001-c7a3 | Quick Chat 多轮对话：stream_json backend 支持 --resume，stdin 管理，control_request 自动审批

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
