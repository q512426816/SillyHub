---
id: task-05
title: run_tests handler 实现
priority: P0
estimated_hours: 3
depends_on: [task-03]
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/tool_gateway/service.py
  - backend/tests/modules/tool_gateway/test_run_tests.py
---

# task-05: run_tests handler 实现

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/modules/tool_gateway/service.py` | 修改 | 新增 `_handle_run_tests` 方法、`parse_pytest_output` / `parse_go_test_output` 辅助函数、更新 `TOOL_TYPES` |
| `backend/tests/modules/tool_gateway/test_run_tests.py` | 新增 | run_tests handler 单元测试 |

## 依据文档

- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/design.md` — AD-4: run_tests 结构化封装
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/requirements.md` — FR-07: run_tests 工具
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/plan.md` — Wave 2, task-05

## 实现要求

1. 在 `service.py` 的 `TOOL_TYPES` frozenset 中新增 `"run_tests"`
2. 实现 `_handle_run_tests(self, params: dict, lease_root: Path) -> dict` 方法
3. 根据 `runner` 参数选择对应命令并执行子进程（复用 `_handle_shell_exec` 的 asyncio 子进程模式）
4. 解析测试输出为结构化 JSON，包含 `passed`、`failed`、`skipped`、`errors` 计数及 `failures` 列表
5. 支持 pytest / go_test / cargo_test 三种 runner
6. 在 `_dispatch` 方法中注册 run_tests handler，路由签名与 shell_exec 一致（只接收 params + lease_root，不需要 allowed_paths）

## 接口定义（代码类任务必填）

### 方法签名

```python
async def _handle_run_tests(
    self,
    params: dict,
    lease_root: Path,
) -> dict:
    """
    Execute test runner and return structured results.

    Args:
        params: {
            "runner": str,        # "pytest" | "go_test" | "cargo_test"，必填
            "args": list[str],    # 额外参数，默认 []
            "path": str,          # 测试路径，默认 "."
            "timeout": int,       # 超时秒数，默认 DEFAULT_TIMEOUT
        }
        lease_root: worktree lease 根目录

    Returns:
        {
            "result_code": int,     # 0=全部通过，1=有失败，-1=超时，127=runner 未找到，2=参数错误
            "output": str,          # 结构化 JSON 字符串（见 TestRunResult）
        }
    """
```

### 数据结构

```python
# 返回的 output 字段是 JSON 字符串，结构如下：
TestRunResult = {
    "runner": str,              # "pytest" | "go_test" | "cargo_test"
    "exit_code": int,           # 子进程原始退出码
    "timed_out": bool,          # 是否超时
    "summary": {
        "total": int,           # 总测试数
        "passed": int,          # 通过数
        "failed": int,          # 失败数
        "skipped": int,         # 跳过数
        "errors": int,          # 错误数
    },
    "failures": [               # 失败测试列表
        {
            "name": str,        # 测试名
            "message": str,     # 失败消息（截断到 500 字符）
        }
    ],
    "raw_output": str,          # 原始输出（截断到 MAX_OUTPUT_SIZE）
}
```

### Runner 命令映射

```python
RUNNER_COMMANDS = {
    "pytest": "python",       # 命令: python -m pytest {args} {path}
    "go_test": "go",          # 命令: go test {args} {path}/...
    "cargo_test": "cargo",    # 命令: cargo test {args} -- {path}
}
```

### 控制流伪代码

```
_handle_run_tests(params, lease_root):
    1. 提取参数
       runner = params.get("runner", "")
       args = params.get("args", [])
       path = params.get("path", ".")
       timeout = min(params.get("timeout", DEFAULT_TIMEOUT), 120)

    2. 校验 runner
       IF runner 不在 RUNNER_COMMANDS 中:
           RETURN {result_code: 2, output: json({"runner": runner, "error": "Unsupported runner"})}

    3. 构建命令
       cmd, effective_args = _build_runner_command(runner, args, path)
       调用 validate_shell_command(cmd, effective_args)  # 复用全局命令黑名单

    4. 校验路径
       target_path = lease_root / path
       IF target_path.resolve() 不在 lease_root 内:
           RETURN {result_code: 2, output: json({"error": "Path escapes lease boundary"})}

    5. 执行子进程（复用 shell_exec 模式）
       proc = create_subprocess_exec(*[cmd, *effective_args], cwd=lease_root, stdout=PIPE, stderr=STDOUT)
       stdout = wait_for(proc.communicate(), timeout=timeout)
       IF 超时:
           proc.kill()
           RETURN {result_code: -1, output: json(TestRunResult(timed_out=True, ...))}

    6. 解析输出
       raw = stdout.decode(errors="replace")
       result = _parse_test_output(runner, raw, proc.returncode)

    7. RETURN {result_code: (0 if result.summary.failed == 0 else 1), output: json(result)}
```

### 解析器伪代码

```python
def _parse_test_output(runner: str, raw_output: str, exit_code: int) -> dict:
    """
    根据 runner 类型分发到对应解析器。
    解析失败时不抛异常，返回 raw_output 保留在结果中。
    """
    IF runner == "pytest":
        return _parse_pytest_output(raw_output, exit_code)
    ELIF runner == "go_test":
        return _parse_go_test_output(raw_output, exit_code)
    ELIF runner == "cargo_test":
        return _parse_cargo_test_output(raw_output, exit_code)
    ELSE:
        # 兜底：不解析，全部放 raw_output
        return _build_fallback_result(runner, raw_output, exit_code)


def _parse_pytest_output(raw: str, exit_code: int) -> dict:
    """
    解析 pytest 最后的 summary 行，格式：
    "=== N passed, M failed, K skipped, J errors in X.XXs ==="
    或变体形式。

    正则匹配策略：
    1. 匹配 "N passed"
    2. 匹配 "M failed"（可选）
    3. 匹配 "K skipped"（可选）
    4. 匹配 "J errors"（可选）
    5. 匹配失败列表 "FAILED test_file::test_name"
    """
    summary = {"total": 0, "passed": 0, "failed": 0, "skipped": 0, "errors": 0}
    failures = []

    # 匹配 summary 行
    passed_match = re.search(r"(\d+) passed", raw)
    failed_match = re.search(r"(\d+) failed", raw)
    skipped_match = re.search(r"(\d+) skipped", raw)
    errors_match = re.search(r"(\d+) error", raw)

    IF passed_match: summary["passed"] = int(passed_match.group(1))
    IF failed_match: summary["failed"] = int(failed_match.group(1))
    IF skipped_match: summary["skipped"] = int(skipped_match.group(1))
    IF errors_match: summary["errors"] = int(errors_match.group(1))
    summary["total"] = summary["passed"] + summary["failed"] + summary["skipped"] + summary["errors"]

    # 匹配失败测试名
    FOR match IN re.finditer(r"FAILED (.+)", raw):
        failures.append({"name": match.group(1).strip(), "message": ""})

    # 如果 summary 行没匹配到但 exit_code != 0，尝试从 FAILED 行推断
    IF summary["total"] == 0 AND exit_code != 0:
        summary["failed"] = max(len(failures), 1)
        summary["total"] = summary["failed"]

    RETURN _build_result_dict("pytest", exit_code, summary, failures, raw)


def _parse_go_test_output(raw: str, exit_code: int) -> dict:
    """
    解析 go test 输出：
    "ok  package/name  0.123s"
    "FAIL  package/name  0.123s"
    "--- FAIL: TestName (0.00s)"

    正则：
    1. 匹配 "--- FAIL: TestName" 获取失败列表
    2. 匹配 "--- PASS: TestName" 计数 passed
    3. 匹配 "--- SKIP: TestName" 计数 skipped
    4. 匹配 "FAIL\t" 开头的行判断整体失败
    """
    # 实现逻辑同 pytest 解析思路，匹配 go test 输出格式
    ...


def _parse_cargo_test_output(raw: str, exit_code: int) -> dict:
    """
    解析 cargo test 输出：
    "test result: ok. N passed; M failed; K ignored; 0 measured; 0 filtered out"

    正则：
    1. 匹配 "test result: ..." 行
    2. 匹配 "test test_name ... FAILED" 获取失败列表
    """
    # 实现逻辑同 pytest 解析思路，匹配 cargo test 输出格式
    ...
```

### _dispatch 注册

在 `_dispatch` 方法的 handlers 字典中新增：

```python
handlers = {
    # ... 已有 handlers ...
    "shell_exec": self._handle_shell_exec,
    "run_tests": self._handle_run_tests,  # 新增
}
```

路由逻辑中，run_tests 与 shell_exec 一样，只传 `(params, lease_root)`，不传 `allowed_paths`：

```python
if tool_type in ("shell_exec", "run_tests"):
    return await handler(params, lease_root)
```

### 辅助函数

```python
def _build_runner_command(runner: str, args: list[str], path: str) -> tuple[str, list[str]]:
    """根据 runner 类型构建 (command, effective_args) 元组。"""
    IF runner == "pytest":
        RETURN ("python", ["-m", "pytest", *args, path])
    ELIF runner == "go_test":
        path_arg = path if path == "." else f"{path}/..."
        RETURN ("go", ["test", *args, path_arg])
    ELIF runner == "cargo_test":
        RETURN ("cargo", ["test", *args, "--", path])
    ELSE:
        RETURN (runner, [*args, path])
```

## 边界处理（必填）

1. **runner 为空或不支持**：`params.get("runner", "")` 为空或不在 `RUNNER_COMMANDS` 中时，返回 `result_code=2`，output 为 JSON `{"runner": "<value>", "error": "Unsupported runner: <value>"}`，不抛异常
2. **path 路径逃逸**：`lease_root / path` 解析后不在 `lease_root` 内时，返回 `result_code=2`，output 为 JSON `{"error": "Path escapes lease boundary"}`，不抛异常
3. **args 含恶意命令**：通过 `validate_shell_command()` 校验，命中黑名单时抛出 `ToolOperationForbidden`（与其他 handler 一致）
4. **子进程超时**：`asyncio.wait_for` 超时后 kill 进程并 wait，返回 `result_code=-1`，`timed_out=True`，summary 全为 0
5. **runner 不存在（FileNotFoundError）**：返回 `result_code=127`，output 为 JSON `{"runner": "<runner>", "error": "Runner command not found: <command>"}`
6. **解析失败**：解析器 try/except 包裹，匹配不到结构化数据时回退为 `{"raw_output": <原始输出>}`，`summary` 全为 0，不抛异常
7. **stdout 为空**：`raw = stdout.decode(errors="replace") if stdout else ""`，空字符串进入解析器返回全 0 的 summary
8. **不修改传入参数**：`params` 字典只读取不修改，`args` 列表通过 `*args` 解包创建新列表
9. **failures message 截断**：每个 failure 的 message 字段截断到 500 字符，防止单条过长
10. **raw_output 截断**：传入 `redact_output()` 自动截断到 `MAX_OUTPUT_SIZE`（64000 字符）

## 非目标（本任务不做的事）

- 不做 policy check（由 task-07 在 execute 层集成）
- 不做审计双写（由 task-07 集成）
- 不修改 `_dispatch` 的调度签名（只新增 handler 注册 + 路由条件）
- 不修改 `schema.py` 中的 `ToolExecuteRequest` / `ToolExecuteRequest`（由 task-08 负责）
- 不修改 `model.py`（tool_type 长度由 task-08 负责）
- 不修改 `execute()` 方法签名或流程
- 不实现 test runner 自动检测（Agent 必须显式指定 runner）
- 不实现并行测试执行
- 不实现覆盖率收集

## 参考

- 可参考的模式：`_handle_shell_exec` 方法（同文件 265-303 行）
  - asyncio 子进程创建 + 超时处理 + 输出解码
  - FileNotFoundError 处理
  - validate_shell_command 校验
- `redact_output` 函数（`git_gateway/service.py` 94-101 行）：输出截断 + token 脱敏
- `validate_path` 函数（同文件 68-100 行）：路径逃逸校验模式

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/tool_gateway/test_run_tests.py` 编写以下测试用例
2. **确认失败**：运行 `pytest backend/tests/modules/tool_gateway/test_run_tests.py`，确认全部 FAIL（因为 `_handle_run_tests` 尚不存在）
3. **写代码**：在 `service.py` 中实现 `_handle_run_tests` + 解析器 + `_build_runner_command`
4. **确认通过**：运行测试确认全部 PASS
5. **回归**：运行 `pytest backend/` 确认无已有测试回归

### 测试用例清单

```python
# 文件: backend/tests/modules/tool_gateway/test_run_tests.py

# === 基础功能 ===

async def test_run_tests_pytest_success(tmp_path):
    """pytest 全部通过：创建 fake pytest 脚本，返回 2 passed 输出
    验证 result_code=0, summary.passed=2, summary.failed=0, failures=[]
    """

async def test_run_tests_pytest_mixed(tmp_path):
    """pytest 部分失败：返回 2 passed, 1 failed, 1 skipped
    验证 result_code=1, failures 列表长度=1, 包含正确的 test name
    """

async def test_run_tests_go_test_success(tmp_path):
    """go test 通过：模拟 go test 输出
    验证 result_code=0, summary.passed 正确
    """

async def test_run_tests_cargo_test_success(tmp_path):
    """cargo test 通过：模拟 cargo test 输出
    验证 result_code=0
    """

async def test_run_tests_output_is_valid_json(tmp_path):
    """输出为合法 JSON 字符串
    验证 json.loads(output) 不抛异常且包含 runner/summary/failures/raw_output 字段
    """

# === 参数校验 ===

async def test_run_tests_unsupported_runner(tmp_path):
    """不支持的 runner：params.runner="npm_test"
    验证 result_code=2, output 包含 "Unsupported runner"
    """

async def test_run_tests_empty_runner(tmp_path):
    """runner 为空：params.runner=""
    验证 result_code=2, output 包含 "Unsupported runner"
    """

async def test_run_tests_path_escape(tmp_path):
    """路径逃逸：params.path="../../etc"
    验证 result_code=2, output 包含 "Path escapes lease boundary"
    """

# === 超时 ===

async def test_run_tests_timeout(tmp_path):
    """超时：创建 sleep 60s 的 fake runner，timeout=1
    验证 result_code=-1, timed_out=True
    """

# === 命令黑名单 ===

async def test_run_tests_blocked_command(tmp_path):
    """args 含 sudo：params.args=["--sudo"]
    验证抛出 ToolOperationForbidden
    """

# === Runner 不存在 ===

async def test_run_tests_runner_not_found(tmp_path):
    """python 命令不存在（通过 PATH 操控）
    验证 result_code=127
    """

# === 解析器容错 ===

async def test_run_tests_unparseable_output(tmp_path):
    """无法解析的输出：fake runner 输出随机文本
    验证 summary 全为 0, raw_output 保留原始输出
    """

async def test_run_tests_empty_output(tmp_path):
    """空输出：fake runner 无任何输出
    验证 summary 全为 0, 不崩溃
    """

# === 结果结构验证 ===

async def test_run_tests_result_structure(tmp_path):
    """验证返回 dict 包含 result_code + output，output 解析后结构完整
    验证字段：runner, exit_code, timed_out, summary, failures, raw_output
    """

async def test_run_tests_failure_message_truncated(tmp_path):
    """失败消息截断：超长失败消息
    验证 message 长度 <= 500
    """
```

测试实现策略：在 tmp_path 中创建 fake runner 脚本（如 `fake_pytest.sh`），该脚本 echo 预定义的测试输出并 exit 指定退出码。通过 monkey-patch `RUNNER_COMMANDS` 或临时修改 PATH 使 `python`/`go`/`cargo` 指向 fake 脚本。或者更简单：直接 mock `asyncio.create_subprocess_exec` 来控制 stdout 和 returncode。

推荐 mock 策略：

```python
from unittest.mock import AsyncMock, patch

async def test_run_tests_pytest_success(tmp_path):
    service = ToolGatewayService(session=AsyncMock())

    fake_stdout = b"=== 2 passed in 0.5s ==="
    mock_proc = AsyncMock()
    mock_proc.communicate = AsyncMock(return_value=(fake_stdout, b""))
    mock_proc.returncode = 0

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        result = await service._handle_run_tests(
            {"runner": "pytest", "path": "tests/"},
            lease_root=tmp_path,
        )

    assert result["result_code"] == 0
    data = json.loads(result["output"])
    assert data["summary"]["passed"] == 2
    assert data["summary"]["failed"] == 0
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `_handle_run_tests` 方法存在于 `ToolGatewayService` 类中 | 方法可被调用，签名正确 `(self, params: dict, lease_root: Path) -> dict` |
| AC-02 | `TOOL_TYPES` 包含 `"run_tests"` | `"run_tests" in TOOL_TYPES` 为 True |
| AC-03 | `_dispatch` 中 `run_tests` 路由到 `_handle_run_tests` | 调用 dispatch("run_tests", ...) 不报 "Unhandled tool type" |
| AC-04 | pytest runner 全部通过场景 | result_code=0, summary.passed 正确, failures 为空列表 |
| AC-05 | pytest runner 部分失败场景 | result_code=1, summary.failed > 0, failures 列表包含失败测试名 |
| AC-06 | go_test runner 场景 | 正确解析 go test 输出格式 |
| AC-07 | cargo_test runner 场景 | 正确解析 cargo test 输出格式 |
| AC-08 | 不支持的 runner（空值或未知值） | result_code=2, output 含 "Unsupported runner" |
| AC-09 | path 参数逃逸（`../../etc`） | result_code=2, output 含 "Path escapes lease boundary" |
| AC-10 | 执行超时 | result_code=-1, timed_out=True, 子进程已被 kill |
| AC-11 | args 含黑名单命令（如 sudo） | 抛出 ToolOperationForbidden |
| AC-12 | runner 命令不存在（FileNotFoundError） | result_code=127 |
| AC-13 | 无法解析的输出 | 不崩溃, summary 全为 0, raw_output 保留原始输出 |
| AC-14 | 空输出 | 不崩溃, summary 全为 0 |
| AC-15 | 输出为合法 JSON 字符串 | json.loads(output) 成功，含 runner/summary/failures/raw_output 字段 |
| AC-16 | 失败消息截断 | 每个 failure 的 message 长度 <= 500 字符 |
| AC-17 | 输出经过 redact_output 处理 | raw_output 中无明文 token |
| AC-18 | 所有新增测试通过 | `pytest backend/tests/modules/tool_gateway/test_run_tests.py` 全绿 |
| AC-19 | 无回归 | `pytest backend/` 已有测试全部通过 |
