---
schema_version: 1
doc_type: module-card
module_id: backends
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backends

## 定位
Agent 后端的抽象层和工厂。定义 `AgentBackend` ABC、结构化事件/结果数据类、协议到 provider 的映射表、以及延迟加载工厂函数。是 5 种具体后端实现的公共接口层。

## 契约摘要
- `AgentEvent` — 结构化事件：event_type, content, tool_name, call_id, tool_input, tool_output, status, level, session_id
- `TaskResult` — 执行结果：status, output, error, duration_ms, session_id, events
- `AgentBackend(ABC)` — 抽象基类，子类须实现 `execute()` 和 `parse_output()`
- `PROTOCOL_PROVIDERS` — 协议到 provider 列表映射（stream_json/json_rpc/jsonl/ndjson/text）
- `get_protocol(provider) -> str` — 反查 provider 所属协议
- `get_backend(provider) -> type[AgentBackend]` — 延迟导入返回后端类

## 关键逻辑
```
get_backend(provider)
  protocol = get_protocol(provider)  # 反查 PROTOCOL_PROVIDERS
  _PROTOCOL_MODULES[protocol] → (module_path, class_name)
  importlib.import_module(module_path, package=__name__)
  return backend_cls  # 返回类而非实例
```

## 注意事项
- 工厂使用延迟导入（importlib）避免循环依赖，后端子模块只在首次使用时加载
- `PROTOCOL_PROVIDERS` 是协议到 provider 列表的正向映射，新增 provider 需在此注册
- `get_backend` 返回类（type），调用方需自行实例化
- 新增协议类型需同时：1) 实现后端子模块 2) 注册到 PROTOCOL_PROVIDERS 3) 添加到 _PROTOCOL_MODULES
- `AgentEvent.event_type` 的值域：text, tool_use, tool_result, thinking, status, error

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
