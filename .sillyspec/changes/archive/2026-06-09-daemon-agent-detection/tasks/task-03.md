---
id: task-03
title: "AgentBackend 抽象接口 + Backend 工厂"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-04, task-05, task-06, task-08]
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/backends/__init__.py
  - sillyhub-daemon/tests/test_backends_init.py
author: qinyi
created_at: "2026-06-09 23:25:05"
---

# task-03: AgentBackend 抽象接口 + Backend 工厂

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 新增 | `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` |
| 新增 | `sillyhub-daemon/tests/test_backends_init.py` |

## 实现要求

1. 创建 `sillyhub-daemon/sillyhub_daemon/backends/` 包（`__init__.py` 作为模块入口）

2. 定义 `AgentBackend` 抽象基类：

   ```python
   from abc import ABC, abstractmethod

   class AgentBackend(ABC):
       provider: str  # 子类必须设置

       @abstractmethod
       async def execute(
           self,
           cmd_path: str,
           task_prompt: str,
           work_dir: str,
           env: dict | None = None,
       ) -> TaskResult:
           """Execute agent CLI and return structured result."""

       @abstractmethod
       async def parse_output(self, line: str) -> AgentEvent | None:
           """Parse a single output line into a structured event."""
   ```

3. 定义 `AgentEvent` dataclass：

   ```python
   @dataclass
   class AgentEvent:
       event_type: str  # "text", "tool_use", "tool_result", "thinking", "status", "error"
       content: str = ""
       tool_name: str = ""
       call_id: str = ""
       tool_input: dict | None = None
       tool_output: str = ""
       status: str = ""
       level: str = ""       # for log/error events
   ```

4. 定义 `TaskResult` dataclass：

   ```python
   @dataclass
   class TaskResult:
       status: str       # "completed", "failed", "timeout", "aborted"
       output: str       # accumulated text output
       error: str = ""   # error message if failed
       duration_ms: int = 0
       session_id: str = ""
       events: list[AgentEvent] = field(default_factory=list)
   ```

5. 定义协议 → provider 映射常量：

   ```python
   PROTOCOL_PROVIDERS: dict[str, list[str]] = {
       "stream_json": ["claude", "gemini", "cursor"],
       "json_rpc":    ["codex", "hermes", "kimi", "kiro"],
       "jsonl":       ["copilot"],
       "ndjson":      ["opencode", "openclaw", "pi"],
       "text":        ["antigravity"],
   }
   ```

6. 实现 `get_backend(provider: str) -> type[AgentBackend]` 工厂函数：
   - 返回对应 provider 的 backend 类（type，不是实例）
   - provider 不在映射中时 raise `ValueError(f"Unknown provider: {provider}")`
   - 使用延迟导入（lazy import），避免循环依赖：在函数体内 `from .stream_json import StreamJsonBackend` 等

7. 实现 `get_protocol(provider: str) -> str` 辅助函数：
   - 从 PROTOCOL_PROVIDERS 反查，返回 provider 对应的协议类型字符串
   - 未找到时 raise `ValueError`

## 接口定义

```python
"""Agent backend abstraction and factory."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

@dataclass
class AgentEvent:
    event_type: str
    content: str = ""
    tool_name: str = ""
    call_id: str = ""
    tool_input: dict | None = None
    tool_output: str = ""
    status: str = ""
    level: str = ""

@dataclass
class TaskResult:
    status: str
    output: str
    error: str = ""
    duration_ms: int = 0
    session_id: str = ""
    events: list[AgentEvent] = field(default_factory=list)

class AgentBackend(ABC):
    provider: str

    @abstractmethod
    async def execute(self, cmd_path: str, task_prompt: str, work_dir: str, env: dict | None = None) -> TaskResult: ...

    @abstractmethod
    async def parse_output(self, line: str) -> AgentEvent | None: ...

PROTOCOL_PROVIDERS: dict[str, list[str]] = {
    "stream_json": ["claude", "gemini", "cursor"],
    "json_rpc":    ["codex", "hermes", "kimi", "kiro"],
    "jsonl":       ["copilot"],
    "ndjson":      ["opencode", "openclaw", "pi"],
    "text":        ["antigravity"],
}

def get_backend(provider: str) -> type[AgentBackend]: ...
def get_protocol(provider: str) -> str: ...
```

## 边界处理

1. **provider 为空字符串**：`get_backend("")` raise `ValueError("Unknown provider: ")`
2. **provider 不在已知列表中**：raise `ValueError`，携带 provider 名称以便调试
3. **Backend 子模块尚未实现**：task-04/05/06 实现前，`get_backend` 的延迟导入会 `ImportError`。本任务中工厂函数先注册已知的映射关系，子模块导入失败时 raise `ImportError` 并附带友好消息（`f"Backend module for {protocol} not implemented yet"`）
4. **PROTOCOL_PROVIDERS 中同一 provider 出现在多个协议**：当前设计中不会出现；如果发生，`get_protocol` 返回第一个匹配的协议
5. **循环导入**：`get_backend` 使用函数体内延迟导入，避免模块级别循环依赖
6. **多线程并发调用 get_backend**：无状态，纯函数返回 type，天然线程安全

## 非目标

- 不实现具体的 Backend 子类（task-04/05/06 负责）
- 不实现任务队列或并发控制
- 不实现进程管理（子类负责）
- 不实现 MCP 配置注入

## 参考

- design.md Phase 3 执行协议层
- multica `server/pkg/agent/agent.go` `Backend` 接口 + `New()` 工厂函数
- multica `server/pkg/agent/claude.go` `claudeBackend` 结构体（参考 Message/Result 类型设计）

## TDD步骤

1. 写测试：`test_agent_event_dataclass` — 验证 AgentEvent 字段默认值
2. 写测试：`test_task_result_dataclass` — 验证 TaskResult 字段默认值 + events 默认空列表
3. 写测试：`test_agent_backend_is_abstract` — 验证不能直接实例化 AgentBackend
4. 写测试：`test_agent_backend_requires_methods` — 子类缺少 execute/parse_output 时 TypeError
5. 写测试：`test_protocol_providers_mapping` — 验证 5 种协议覆盖所有 12 个 provider
6. 写测试：`test_get_protocol_known_providers` — 验证 claude→stream_json, codex→json_rpc 等
7. 写测试：`test_get_protocol_unknown_raises` — 验证 ValueError
8. 写测试：`test_get_backend_returns_type` — 验证 get_backend 返回 type 而非实例
9. 写测试：`test_get_backend_unknown_raises` — 验证 ValueError 包含 provider 名
10. 写测试：`test_protocol_providers_no_duplicates` — 每个 provider 只出现一次
11. 实现所有代码使测试通过

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-01 | AgentBackend 是 ABC，不能直接实例化 | `with pytest.raises(TypeError): AgentBackend()` |
| AC-02 | AgentEvent 有所有必要字段且默认值合理 | dataclass 字段检查 |
| AC-03 | TaskResult 有所有必要字段，events 默认空列表 | dataclass 字段检查 |
| AC-04 | PROTOCOL_PROVIDERS 覆盖全部 12 种 provider | 扁平化后 len == 12 |
| AC-05 | get_backend 对已知 provider 返回 AgentBackend 子类 | isinstance 检查 |
| AC-06 | get_backend 对未知 provider raise ValueError | pytest.raises(ValueError) |
| AC-07 | get_protocol 对已知 provider 返回正确协议名 | 断言返回值 |
| AC-08 | get_protocol 对未知 provider raise ValueError | pytest.raises(ValueError) |
| AC-09 | 无模块级循环导入 | 延迟导入实现 |
