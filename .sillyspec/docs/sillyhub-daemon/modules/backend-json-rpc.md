---
schema_version: 1
doc_type: module-card
module_id: backend-json-rpc
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backend-json-rpc

## 定位
JSON-RPC 2.0 over stdio 协议后端，服务 codex / hermes / kimi / kiro 四种 provider。遵循 codex app-server 协议流程：initialize -> initialized -> thread/start -> turn/start -> stream items -> turn/completed。内置 `_JsonRpcTransport` 处理底层消息收发。

## 契约摘要
- `JsonRpcBackend(AgentBackend)` — 无固定 provider（运行时确定）
- `_JsonRpcTransport` — 底层 JSON-RPC 2.0 传输层
  - `request(method, params?, timeout?) -> dict` — 发送请求并等待响应
  - `notify(method, params?)` — 发送通知（无响应）
  - `respond(req_id, result)` — 响应 server 请求
- 自动应答：commandExecution、fileChange、mcpServer/elicitation 等 approval 请求

## 关键逻辑
```
execute(cmd_path, task_prompt, work_dir, env)
  spawn(cmd_path, provider_specific_args)
  transport = _JsonRpcTransport(stdin, stdout_reader)
  transport.start_read_loop()  # 后台读线程
  # Handshake
  transport.request("initialize", {...}, timeout=30)
  transport.notify("notifications/initialized")
  # Execute
  transport.request("thread/start", {prompt, ...})
  # 等待 turn/completed 通知
  # 收集 output, session_id, events
  return TaskResult(...)
```

## 注意事项
- 握手超时 `_HANDSHAKE_TIMEOUT = 30s`，语义不活跃超时 `_DEFAULT_SEMANTIC_INACTIVITY_TIMEOUT = 600s`
- `_PROVIDER_COMMANDS` 定义各 provider 的启动参数（codex 需 `app-server --listen stdio://`）
- transport 使用 early_responses 缓存机制处理响应先于请求注册到达的竞态情况
- 自动审批所有 commandExecution 和 fileChange 请求（`decision: "accept"`）
- stderr 仅保留最后 2048 字节用于错误诊断

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
