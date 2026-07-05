---
id: task-07
title: "Daemon 多 runtime 注册循环 + client 改造"
author: qinyi
created_at: "2026-06-09 23:25:05"
priority: P0
estimated_hours: 3
depends_on:
  - task-01
  - task-03
blocks:
  - task-09
  - task-11
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/daemon.py
  - sillyhub-daemon/sillyhub_daemon/client.py
  - sillyhub-daemon/tests/test_daemon_multi_runtime.py
---

# Task-07: Daemon 多 runtime 注册循环 + client 改造

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `sillyhub-daemon/sillyhub_daemon/daemon.py` | 多 runtime 注册循环 |
| 修改 | `sillyhub-daemon/sillyhub_daemon/client.py` | `register()` 支持 `runtime_id` 参数 |

## 实现要求

### daemon.py 改造

当前 `Daemon.start()` 的注册逻辑（第 67-78 行）：

```python
result = await self._client.register(
    name=platform.node(),
    provider="claude-code",
    version="0.1.0",
    os=platform.system().lower(),
    arch=platform.machine(),
    capabilities=capabilities,
)
```

问题：硬编码 `provider="claude-code"`，只注册一个 runtime。

**改造为多 runtime 注册循环**：

```python
# 新逻辑伪代码
detector = AgentDetector()
agents = await detector.detect_all()

for agent in agents:
    if not agent.available:
        continue

    # 每个 agent 生成独立的 runtime_id
    runtime_id = f"{self._config.runtime_id}--{agent.name}"

    try:
        result = await self._client.register(
            runtime_id=runtime_id,
            name=platform.node(),
            provider=agent.name,
            version=agent.version or "unknown",
            protocol=agent.protocol,
            os=platform.system().lower(),
            arch=platform.machine(),
            capabilities={
                "provider": agent.name,
                "version": agent.version,
                "protocol": agent.protocol,
                "bin_path": agent.bin_path,
            },
        )
        logger.info("daemon.registered provider=%s runtime_id=%s", agent.name, runtime_id)
    except Exception as exc:
        logger.error("daemon.register_failed provider=%s error=%s", agent.name, exc)
        # Continue registering other agents — one failure shouldn't block all.
```

**关键变更**：

1. `runtime_id` 格式：`{base_runtime_id}--{agent_name}`，例如 `rt-abc123--codex`、`rt-abc123--claude`。
2. 遍历所有 `agent.available == True` 的 agent，每个独立注册。
3. `provider` 从硬编码 `"claude-code"` 改为 `agent.name`（如 `"claude"`、`"codex"`、`"copilot"` 等）。
4. `version` 从硬编码 `"0.1.0"` 改为 `agent.version or "unknown"`。
5. `capabilities` 扩展为包含 `provider`、`version`、`protocol`、`bin_path`。
6. 新增 `protocol` 字段传入注册请求（如 `"stream_json"`、`"json_rpc"`、`"ndjson"` 等）。
7. 单个 agent 注册失败不阻塞其他 agent 的注册。
8. 无 agent 可用时，daemon 正常启动但不注册任何 runtime（日志提示）。
9. 存储 runtime_id 列表，后续 heartbeat/ws 使用主 runtime_id 或全部 runtime_id。

**心跳和 WebSocket 适配**：

- `_heartbeat_loop`：只对第一个（或主）runtime_id 发送心跳，或者遍历所有已注册 runtime_id 分别发送。当前阶段选择**只对主 runtime_id 发送心跳**（保持现有行为不变）。
- `_ws_loop`：WebSocket URL 中使用主 runtime_id（保持现有行为）。
- `_build_ws_url`：使用 `self._runtime_id`（主 runtime_id，不含 agent 后缀）。

### client.py 改造

当前 `HubClient.register()` 接受 `**kwargs`：

```python
async def register(self, **kwargs: Any) -> dict[str, Any]:
    resp = await self._http.post("/api/daemon/register", json=kwargs)
    resp.raise_for_status()
    return resp.json()
```

**变更**：显式声明 `runtime_id` 参数，使其成为命名参数而非仅依赖 kwargs 传递。

```python
async def register(
    self,
    *,
    runtime_id: str | None = None,
    name: str = "",
    provider: str = "",
    version: str = "",
    protocol: str = "",
    os: str = "",
    arch: str = "",
    capabilities: dict[str, Any] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Register this daemon runtime with the server.

    Parameters
    ----------
    runtime_id:
        Unique runtime identifier. If not provided, the server generates one.
    name:
        Hostname of the machine running the daemon.
    provider:
        Agent provider name (e.g. "claude", "codex").
    version:
        Agent binary version string.
    protocol:
        Execution protocol (e.g. "stream_json", "json_rpc").
    """
    body = {
        "name": name,
        "provider": provider,
        "version": version,
        "os": os,
        "arch": arch,
        **kwargs,
    }
    if runtime_id is not None:
        body["runtime_id"] = runtime_id
    if protocol:
        body["protocol"] = protocol
    if capabilities:
        body["capabilities"] = capabilities
    resp = await self._http.post("/api/daemon/register", json=body)
    resp.raise_for_status()
    return resp.json()
```

## 接口定义

### Daemon 新属性

```python
class Daemon:
    # 已注册的 runtime_id 列表
    _registered_runtimes: dict[str, str]  # {agent_name: runtime_id}

    async def start(self) -> None:
        """Start daemon: detect agents, register each, begin background loops."""
        ...
```

### HubClient.register 改造

```python
async def register(
    self,
    *,
    runtime_id: str | None = None,
    name: str = "",
    provider: str = "",
    version: str = "",
    protocol: str = "",
    os: str = "",
    arch: str = "",
    capabilities: dict[str, Any] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    ...
```

## 边界处理

1. **无 agent 可用**：`detect_all()` 返回空列表或所有 agent `available=False` -> daemon 正常启动，日志 `daemon.no_agents_detected`，不注册任何 runtime，后台循环照常运行。
2. **单个 agent 注册失败**：某 agent 注册抛异常（网络错误、服务端 400 等）-> 捕获异常记录 error 日志，继续注册下一个 agent。至少有一个 agent 注册成功即视为部分成功。
3. **runtime_id 冲突**：如果 `{base_runtime_id}--{agent_name}` 已存在于服务端（daemon 重启），服务端返回的响应中应包含已有 runtime 的信息，daemon 直接使用返回的 runtime_id 更新本地记录。
4. **capabilities 字段扩展向后兼容**：新增的 `protocol`、`bin_path` 字段加到 `capabilities` 对象内，服务端 `daemon_runtimes` 表已有 `capabilities` JSON 字段，无需 schema 变更。
5. **heartbeat 只用主 runtime_id**：避免 N 个 agent 导致 N 倍心跳请求。主 runtime_id 是第一个成功注册的 agent 对应的 runtime_id。
6. **runtime_id 格式中 agent.name 包含特殊字符**：agent.name 都是 `AgentDetector` 中定义的小写字母名称（`claude`、`codex` 等），不含特殊字符，`--` 分隔符不会混淆。
7. **旧版 daemon 客户端兼容**：不传 `runtime_id` 时服务端自行生成，保持向后兼容。

## 非目标

- 不实现批量注册 API（每个 agent 单独 POST 请求，V2 考虑合并为单次批量注册）。
- 不实现 runtime_id 去重逻辑（依赖服务端幂等性）。
- 不实现注册重试机制（失败就跳过，依赖 heartbeat 恢复）。
- 不修改 `_poll_loop` 和 `_ws_loop` 的 runtime_id 使用方式。
- 不实现多 runtime_id 的并行心跳。

## 参考

- `sillyhub-daemon/sillyhub_daemon/daemon.py`：当前 `start()` 方法（第 52-86 行）。
- `sillyhub-daemon/sillyhub_daemon/client.py`：当前 `register()` 方法（第 55-63 行）。
- `sillyhub-daemon/sillyhub_daemon/agent_detector.py`：`AgentDetector.detect_all()` 返回 `list[DetectedAgent]`。
- Design 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/design.md` Phase 2。
- Plan 文档 `.sillyspec/changes/2026-06-09-daemon-agent-detection/plan.md` Wave 3。

## TDD步骤

1. **写测试 `_test_daemon_registers_each_available_agent`**：mock `AgentDetector.detect_all()` 返回 3 个 agent（2 available + 1 unavailable），验证 `client.register()` 被调用 2 次，每次参数包含正确的 `provider`、`version`、`runtime_id`。
2. **写测试 `_test_daemon_runtime_id_format`**：验证 runtime_id 格式为 `{base}--{agent_name}`。
3. **写测试 `_test_daemon_no_agents_detected`**：mock 返回空列表，验证 `client.register()` 未被调用，daemon 不崩溃。
4. **写测试 `_test_daemon_single_registration_failure_continues`**：mock 第一个 agent 注册抛异常，验证第二个 agent 仍被注册。
5. **写测试 `_test_daemon_registers_with_capabilities`**：验证 `capabilities` 字典包含 `provider`、`version`、`protocol`、`bin_path`。
6. **写测试 `_test_client_register_with_runtime_id`**：验证 `HubClient.register(runtime_id="rt-123", ...)` 发送 POST body 包含 `runtime_id`。
7. **写测试 `_test_client_register_without_runtime_id`**：验证 `HubClient.register(...)` 不传 `runtime_id` 时 body 不包含该字段（向后兼容）。
8. **写测试 `_test_client_register_with_protocol`**：验证 `protocol` 参数传入时包含在 body 中。
9. **修改 `client.py`**：实现显式参数的 `register()` 方法，使测试 6-8 通过。
10. **修改 `daemon.py`**：实现多 runtime 注册循环，使测试 1-5 通过。

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| A-01 | `daemon.py` 的 `start()` 遍历所有 `available=True` 的 agent 分别注册 | 单元测试 |
| A-02 | 每个 agent 注册时 `provider` 使用 `agent.name`（非硬编码 `"claude-code"`） | 单元测试 |
| A-03 | 每个 agent 注册时 `runtime_id` 格式为 `{base}--{agent.name}` | 单元测试 |
| A-04 | `version` 使用 `agent.version or "unknown"` | 单元测试 |
| A-05 | `capabilities` 包含 `provider`、`version`、`protocol`、`bin_path` | 单元测试 |
| A-06 | 无 agent 可用时 daemon 正常启动不崩溃 | 单元测试 |
| A-07 | 单个 agent 注册失败不阻塞其他 agent 注册 | 单元测试 |
| A-08 | `HubClient.register()` 接受显式 `runtime_id` 命名参数 | 单元测试 |
| A-09 | `HubClient.register()` 不传 `runtime_id` 时向后兼容（body 不含该字段） | 单元测试 |
| A-10 | `HubClient.register()` 支持 `protocol` 参数 | 单元测试 |
| A-11 | 心跳循环使用主 runtime_id（第一个成功注册的） | 代码审查 |
| A-12 | 所有测试通过 `pytest sillyhub-daemon/tests/test_daemon_multi_runtime.py` | CI |
