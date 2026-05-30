---
id: task-08
title: schema 扩展 + API 更新
priority: P0
estimated_hours: 1
depends_on: [task-05, task-06]
blocks: [task-09]
allowed_paths:
  - backend/app/modules/tool_gateway/schema.py
  - backend/app/modules/tool_gateway/model.py
---

# task-08: schema 扩展 + API 更新

## 修改文件（必填）

| 操作 | 文件路径 |
|------|----------|
| 修改 | `backend/app/modules/tool_gateway/schema.py` |
| 修改 | `backend/app/modules/tool_gateway/model.py` |

## 实现要求

### 1. 扩展 `schema.py` 中 `ToolExecuteRequest.tool_type` 枚举

当前 `tool_type` 是一个 `Literal["file_read", "file_write", "file_list", "file_search", "shell_exec"]`，只支持 5 种工具。需要新增 `"run_tests"` 和 `"http_get"` 两种工具类型。

扩展后：
```python
tool_type: Literal[
    "file_read", "file_write", "file_list", "file_search",
    "shell_exec", "run_tests", "http_get",
]
```

### 2. 新增 `RunTestsParams` 请求参数 schema

为 `run_tests` 工具定义独立的 Pydantic 模型，用于参数校验：

```python
class RunTestsParams(BaseModel):
    runner: Literal["pytest", "go_test", "cargo_test"]
    args: list[str] = Field(default_factory=list)
    path: str = "."
    timeout: int = Field(default=60, ge=1, le=600)
```

### 3. 新增 `HttpGetParams` 请求参数 schema

为 `http_get` 工具定义独立的 Pydantic 模型：

```python
class HttpGetParams(BaseModel):
    url: str  # 由 service 层做域名白名单 + SSRF 校验
    headers: dict[str, str] = Field(default_factory=dict)
    timeout: int = Field(default=10, ge=1, le=120)
```

### 4. 新增 `RunTestsResult` 响应 schema

结构化测试结果：

```python
class RunTestsResult(BaseModel):
    runner: str
    passed: int
    failed: int
    skipped: int
    errors: int
    failures: list[str] = Field(default_factory=list)  # 失败用例摘要列表
    raw_output: str | None = None  # 解析失败时回退原始输出
    duration_seconds: float = 0.0
```

### 5. 新增 `HttpGetResult` 响应 schema

HTTP GET 结果：

```python
class HttpGetResult(BaseModel):
    status_code: int
    headers: dict[str, str] = Field(default_factory=dict)
    body: str  # 已截断到 max_output_size
    truncated: bool = False
```

### 6. 调整 `model.py` 中 `ToolOperationLog.tool_type` 列宽

当前 `tool_type` 列宽为 `String(30)`，需要扩展为 `String(50)` 以兼容新增的 tool_type 名称。design.md 明确要求此调整。

## 接口定义（代码类任务必填）

### schema.py 完整代码

```python
"""Pydantic schemas for tool gateway API."""

from __future__ import annotations

import datetime
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RunTestsParams(BaseModel):
    """Parameters for run_tests tool invocation."""

    runner: Literal["pytest", "go_test", "cargo_test"]
    args: list[str] = Field(default_factory=list)
    path: str = "."
    timeout: int = Field(default=60, ge=1, le=600)


class HttpGetParams(BaseModel):
    """Parameters for http_get tool invocation."""

    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    timeout: int = Field(default=10, ge=1, le=120)


class RunTestsResult(BaseModel):
    """Structured test execution result."""

    runner: str
    passed: int
    failed: int
    skipped: int
    errors: int
    failures: list[str] = Field(default_factory=list)
    raw_output: str | None = None
    duration_seconds: float = 0.0


class HttpGetResult(BaseModel):
    """HTTP GET response result."""

    status_code: int
    headers: dict[str, str] = Field(default_factory=dict)
    body: str
    truncated: bool = False


class ToolExecuteRequest(BaseModel):
    tool_type: Literal[
        "file_read", "file_write", "file_list", "file_search",
        "shell_exec", "run_tests", "http_get",
    ]
    params: dict[str, Any] = Field(default_factory=dict)


class ToolExecuteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tool_type: str
    result_code: int
    redacted_output: str | None = None
    timestamp: datetime.datetime
```

### model.py 变更

仅修改 `tool_type` 字段的 `max_length` 和 `Column(String(...))`：

```python
# 修改前（第 46-49 行）：
tool_type: str = Field(
    max_length=30,
    sa_column=Column(String(30), nullable=False),
)

# 修改后：
tool_type: str = Field(
    max_length=50,
    sa_column=Column(String(50), nullable=False),
)
```

### 控制流伪代码

```
1. 编辑 schema.py:
   - 导入保持不变
   - 新增 RunTestsParams、HttpGetParams、RunTestsResult、HttpGetResult 四个模型
   - 修改 ToolExecuteRequest.tool_type 枚举，新增 "run_tests" 和 "http_get"
   - ToolExecuteResponse 不变

2. 编辑 model.py:
   - 将 ToolOperationLog.tool_type 的 String(30) 改为 String(50)
   - 将 max_length=30 改为 max_length=50

3. 不需要修改 router.py：
   - 现有 execute_tool 端点签名不变
   - tool_type 校验由 schema Literal 完成（请求级别）
   - service 层 TOOL_TYPES 常量的扩展由 task-07 负责
```

## 边界处理（必填）

1. **tool_type 枚举严格校验**：`ToolExecuteRequest.tool_type` 使用 `Literal` 类型，FastAPI/Pydantic 自动拒绝不在枚举中的值，返回 422 Validation Error。不会静默接受非法 tool_type。

2. **RunTestsParams.timeout 边界**：使用 `ge=1, le=600` 约束，确保 timeout 在 1~600 秒之间。超出范围由 Pydantic 返回 422。实际执行时的超时上限由 ToolPolicy.max_timeout 限制（task-07 集成）。

3. **HttpGetParams.url 不在 schema 层做域名校验**：URL 格式和域名白名单校验由 service 层负责（task-06 handler + task-03 policy check）。schema 层只确保 `url` 是非空字符串。

4. **HttpGetParams.headers 默认空字典**：使用 `default_factory=dict`，避免可变默认参数陷阱。调用方不传 headers 时默认为空。

5. **RunTestsParams.args 默认空列表**：使用 `default_factory=list`，避免可变默认参数陷阱。不传 args 时使用测试框架默认参数。

6. **RunTestsResult.raw_output 可为 None**：当解析器成功解析测试输出时 `raw_output=None`；当解析失败回退原始输出时 `raw_output` 包含原始文本，同时 passed/failed/skipped/errors 等字段为 0。

7. **ToolOperationLog.tool_type 列宽兼容**：从 30 扩展到 50，纯加法操作。现有数据中 tool_type 最大长度为 `"file_search"`（10 字符），远小于 30，扩展到 50 不影响已有数据。Alembic 无需为列宽变更生成迁移（SQLite 无 ALTER COLUMN 支持，但测试环境可重建表；PostgreSQL 支持 ALTER COLUMN）。

8. **ToolExecuteResponse 不变**：响应结构完全不变，`result_code` 和 `redacted_output` 足以承载所有工具类型的结果。`RunTestsResult` 和 `HttpGetResult` 是独立模型，供 service 层内部使用，不直接作为 API 响应。

## 非目标（本任务不做的事）

- **不修改** `router.py`（端点签名和逻辑不变）
- **不修改** `service.py`（TOOL_TYPES 常量扩展、handler 注册、policy check 集成由 task-07 负责）
- **不新增** Alembic 迁移文件（tool_type 列宽从 30→50 在开发阶段可直接重建表，本项目未上线不需要数据迁移）
- **不实现** run_tests 和 http_get 的 handler 逻辑（由 task-05、task-06 负责）
- **不实现** Policy CRUD API（由 task-04 负责）
- **不在** router 中新增任何端点

## 参考

- **现有 schema**：`backend/app/modules/tool_gateway/schema.py` — `ToolExecuteRequest` 和 `ToolExecuteResponse` 定义
- **现有 model**：`backend/app/modules/tool_gateway/model.py` — `ToolOperationLog.tool_type` 字段定义
- **design.md API 设计章节**：`run_tests params`、`http_get params` 的 JSON 结构定义
- **design.md 兼容策略**：`ToolOperationLog.tool_type 列宽从 30 调整到 50`
- **Pydantic v2 模式**：`Literal` 类型用于枚举约束，`Field(default_factory=...)` 用于可变默认值，`ConfigDict(from_attributes=True)` 用于 ORM 模式

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/tool_gateway/test_schema.py` 中编写以下测试用例（如文件不存在则创建）：

   - `test_tool_type_accepts_file_read` — 验证 `"file_read"` 被接受
   - `test_tool_type_accepts_run_tests` — 验证 `"run_tests"` 被接受
   - `test_tool_type_accepts_http_get` — 验证 `"http_get"` 被接受
   - `test_tool_type_rejects_unknown` — 验证 `"unknown_tool"` 被 Pydantic 拒绝，抛出 `ValidationError`
   - `test_run_tests_params_defaults` — 创建 `RunTestsParams(runner="pytest")`，验证 `args=[]`、`path="."`、`timeout=60`
   - `test_run_tests_params_timeout_bounds` — 验证 `timeout=0` 被拒绝（ge=1），`timeout=601` 被拒绝（le=600）
   - `test_run_tests_params_invalid_runner` — 验证 `runner="invalid"` 被拒绝
   - `test_http_get_params_defaults` — 创建 `HttpGetParams(url="https://example.com")`，验证 `headers={}`、`timeout=10`
   - `test_http_get_params_timeout_bounds` — 验证 `timeout=0` 被拒绝（ge=1），`timeout=121` 被拒绝（le=120）
   - `test_http_get_params_url_required` — 验证缺少 `url` 时被拒绝
   - `test_run_tests_result_defaults` — 创建 `RunTestsResult(runner="pytest", passed=5, failed=1, skipped=0, errors=0)`，验证 `failures=[]`、`raw_output=None`、`duration_seconds=0.0`
   - `test_http_get_result_defaults` — 创建 `HttpGetResult(status_code=200, body="ok")`，验证 `headers={}`、`truncated=False`
   - `test_tool_operation_log_tool_type_max_length` — 验证 `ToolOperationLog` 模型的 `tool_type` 字段 `max_length=50`
   - `test_tool_execute_response_from_attributes` — 验证 `ToolExecuteResponse` 可以从 ORM 对象创建

2. **确认失败**：运行 `pytest tests/modules/tool_gateway/test_schema.py -x`，确认因新 schema 类不存在而失败

3. **写代码**：按上述接口定义修改 `schema.py` 和 `model.py`

4. **确认通过**：运行 `pytest tests/modules/tool_gateway/test_schema.py -x`，全部通过

5. **回归**：运行 `pytest --tb=short -q` 全套无回归

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 检查 `schema.py` 中 `ToolExecuteRequest.tool_type` 类型 | `Literal` 包含全部 7 种工具：`file_read, file_write, file_list, file_search, shell_exec, run_tests, http_get` |
| AC-02 | 检查 `schema.py` 中 `RunTestsParams` 类存在 | 类存在，包含 `runner`（Literal 3 种）、`args`（list）、`path`（str）、`timeout`（int, ge=1, le=600） |
| AC-03 | 检查 `schema.py` 中 `HttpGetParams` 类存在 | 类存在，包含 `url`（str）、`headers`（dict）、`timeout`（int, ge=1, le=120） |
| AC-04 | 检查 `schema.py` 中 `RunTestsResult` 类存在 | 类存在，包含 `runner, passed, failed, skipped, errors, failures, raw_output, duration_seconds` |
| AC-05 | 检查 `schema.py` 中 `HttpGetResult` 类存在 | 类存在，包含 `status_code, headers, body, truncated` |
| AC-06 | 检查 `model.py` 中 `ToolOperationLog.tool_type` 列宽 | `String(50)` 且 `max_length=50`（从 30 扩展到 50） |
| AC-07 | `ToolExecuteRequest(tool_type="run_tests", params={})` 不抛异常 | Pydantic 验证通过 |
| AC-08 | `ToolExecuteRequest(tool_type="http_get", params={})` 不抛异常 | Pydantic 验证通过 |
| AC-09 | `ToolExecuteRequest(tool_type="unknown", params={})` 抛出 `ValidationError` | Pydantic 拒绝未知 tool_type |
| AC-10 | `RunTestsParams(runner="pytest")` 使用默认值 | `args=[]`, `path="."`, `timeout=60` |
| AC-11 | `HttpGetParams(url="https://example.com")` 使用默认值 | `headers={}`, `timeout=10` |
| AC-12 | `RunTestsParams(runner="pytest", timeout=0)` 抛出 `ValidationError` | `ge=1` 约束生效 |
| AC-13 | `HttpGetParams(url="https://example.com", timeout=121)` 抛出 `ValidationError` | `le=120` 约束生效 |
| AC-14 | `ToolExecuteResponse` 可从 ORM 对象创建 | `model_validate` 正常工作，`from_attributes=True` 生效 |
| AC-15 | 测试文件 `tests/modules/tool_gateway/test_schema.py` 存在且包含 >=14 个测试 | 全部通过 |
| AC-16 | 全量回归无失败 | `pytest --tb=short -q` 全部通过，无新增失败/错误 |
