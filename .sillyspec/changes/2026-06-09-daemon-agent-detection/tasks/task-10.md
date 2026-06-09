---
id: task-10
title: "单元测试（AgentDetector + Backend 解析 + 版本校验）"
priority: P1
estimated_hours: 3
depends_on:
  - task-01
  - task-02
  - task-04
  - task-05
  - task-06
blocks: []
allowed_paths:
  - sillyhub-daemon/tests/test_agent_detector.py
  - sillyhub-daemon/tests/test_version.py
  - sillyhub-daemon/tests/test_backends.py
author: qinyi
created_at: 2026-06-09 23:25:05
---

# task-10: 单元测试（AgentDetector + Backend 解析 + 版本校验）

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 新增 | `sillyhub-daemon/tests/test_agent_detector.py` |
| 新增 | `sillyhub-daemon/tests/test_version.py` |
| 新增 | `sillyhub-daemon/tests/test_backends.py` |

## 实现要求

### test_agent_detector.py

1. **Mock `shutil.which`**：使用 `unittest.mock.patch` 模拟 `shutil.which` 返回值，控制哪些 agent 二进制被"检测到"。

2. **Mock `asyncio.create_subprocess_exec`**：模拟 agent CLI 子进程调用，控制 `--version` 输出内容。需要 mock `Process` 对象的 `stdout.read()` 返回版本字符串，`returncode` 设为 0。

3. 测试全部 12 种 agent 定义存在于 `AGENT_DEFS` 字典中：
   ```python
   EXPECTED_AGENTS = [
       "claude", "codex", "copilot", "opencode", "openclaw",
       "hermes", "gemini", "pi", "cursor", "kimi", "kiro", "antigravity"
   ]
   ```

4. 测试每种 agent 的 `AgentDef` 字段完整性：`bin`、`env_path`、`version_pattern`、`protocol` 全部非空。

5. 测试环境变量覆盖机制：
   - 设置 `os.environ["SILLYHUB_CLAUDE_PATH"] = "/custom/claude"`
   - 调用 `detect()` 后，检测到的 `bin_path` 应为 `/custom/claude` 而非 `shutil.which` 返回值
   - 测试结束后清理环境变量

6. 测试 `shutil.which` 返回 `None` 时该 agent 不被检测到（`available=False`）。

7. 测试版本输出解析：模拟 `--version` 返回各种格式的输出，验证正则匹配是否正确提取版本号。

### test_version.py

1. 测试 `parse_semver` 对标准 semver 的解析：
   - `"2.1.0"` -> `(2, 1, 0)`
   - `"0.100.3"` -> `(0, 100, 3)`

2. 测试 v 前缀处理：
   - `"v2.1.0"` -> `(2, 1, 0)`
   - `"V1.0.0"` -> `(1, 0, 0)`（大写 V 也兼容）

3. 测试非标准输入：
   - `"not-a-version"` -> 返回 `None` 或抛出异常（按实际实现）
   - `""` -> 同上
   - `"2.1"` -> 补零为 `(2, 1, 0)` 或拒绝（按实际实现）

4. 测试 `check_min_version` 逻辑：
   - `check_min_version("claude", "1.9.0")` -> 返回非 None 的错误消息
   - `check_min_version("claude", "2.0.0")` -> 返回 None（刚好等于最低版本）
   - `check_min_version("claude", "2.1.0")` -> 返回 None（高于最低版本）

5. 测试 `MIN_VERSIONS` 映射完整性：
   ```python
   assert MIN_VERSIONS["claude"] == "2.0.0"
   assert MIN_VERSIONS["codex"] == "0.100.0"
   assert MIN_VERSIONS["copilot"] == "1.0.0"
   ```
   - 无最低版本要求的 provider（如 gemini）调用 `check_min_version` 应返回 None

### test_backends.py

1. 测试 `BackendFactory.get_backend(protocol)` 能按协议类型返回正确的 backend 实例：
   - `"stream_json"` -> `StreamJsonBackend`
   - `"json_rpc"` -> `JsonRpcBackend`
   - `"jsonl"` -> `JsonlBackend`
   - `"ndjson"` -> `NdjsonBackend`
   - `"text"` -> `TextBackend`

2. 测试 `StreamJsonBackend.parse_output`：
   - 输入一行 NDJSON（`{"type":"assistant","content":"hello"}`），返回正确的 `AgentEvent`
   - 输入空行或非 JSON 行，返回 None 或抛出受控异常

3. 测试 `JsonRpcBackend.parse_output`：
   - 输入 JSON-RPC 2.0 响应行，返回正确解析的 `AgentEvent`
   - 输入不含 `jsonrpc` 字段的行，优雅降级

4. 测试 `JsonlBackend.parse_output`：
   - 输入 `{"event":"tool_use","data":{...}}` 格式的 JSONL 行
   - 验证点分事件名解析正确

5. 测试 `NdjsonBackend.parse_output`：
   - 输入标准 NDJSON 行
   - 验证解析结果

6. 测试 `TextBackend.parse_output`：
   - 输入纯文本行
   - 验证返回包含原始文本的 `AgentEvent`

7. 测试每种 backend 的 `execute` 方法被正确调用（mock `asyncio.create_subprocess_exec`）：
   - 验证构建的命令行参数包含正确的 flags（如 `--output-format stream-json`）
   - 验证工作目录和环境变量被正确传递

## 接口定义

本任务不新增接口，测试覆盖以下已定义接口：

```python
# AgentDetector（来自 task-01）
AGENT_DEFS: dict[str, AgentDef]

class AgentDetector:
    async def detect() -> list[DetectedAgent]

# version 模块（来自 task-02）
MIN_VERSIONS: dict[str, str]
def parse_semver(version_str: str) -> tuple[int, int, int] | None
def check_min_version(provider: str, version: str) -> str | None

# Backend 工厂（来自 task-03）
def get_backend(protocol: str) -> AgentBackend

# AgentBackend（来自 task-03, task-04, task-05, task-06）
class AgentBackend(ABC):
    async def execute(self, cmd_path, task_prompt, work_dir, env) -> TaskResult
    async def parse_output(self, line: str) -> AgentEvent | None
```

## 边界处理

1. **shutil.which 返回 None**：agent 未安装，`available=False`，不抛异常
2. **子进程返回非 0 退出码**：`--version` 执行失败时 version 为 None，agent 仍标记为 detected 但 version 缺失
3. **版本字符串为空或非 semver 格式**：`parse_semver` 返回 None，`check_min_version` 视为无法校验（不警告）
4. **环境变量指向不存在的路径**：`detect()` 应仍尝试使用该路径（后续 execute 时才报错），或做 `os.path.exists` 检查标记 `available=False`
5. **parse_output 收到空字符串**：所有 backend 的 `parse_output("")` 应返回 None
6. **parse_output 收到非 UTF-8 字节**：应捕获 UnicodeDecodeError，返回 None 而非崩溃
7. **未知 protocol 传入 get_backend**：应抛出 `ValueError` 或返回 None（按实际实现验证）

## 非目标

- 不做集成测试（daemon 启动 + 真实注册），那是 task-11
- 不做 E2E 测试（真实安装 agent 二进制）
- 不测试前端代码
- 不测试后端 HTTP API

## 参考

- design.md: Phase 1（Agent 检测体系） — 12 种 agent 定义表
- design.md: Phase 2（Daemon 注册改造） — DetectedAgent 结构
- design.md: Phase 3（执行协议层） — 5 种 Backend 分类
- design.md: 接口定义 — AgentDef / DetectedAgent / AgentBackend / MIN_VERSIONS
- plan.md: Wave 1（task-01, task-02）、Wave 2（task-03 ~ task-06）

## TDD步骤

1. 创建 `test_version.py`，先写 `parse_semver` 测试用例（标准、v 前缀、垃圾输入），确认版本解析逻辑正确
2. 补充 `check_min_version` 测试用例（claude/codex/copilot 三种有最低要求的 provider + gemini 无要求的 provider）
3. 创建 `test_agent_detector.py`，先写 AGENT_DEFS 完整性测试（12 个 key、字段非空）
4. Mock `shutil.which` 测试 detect() 基本流程（全检测到 / 全检测不到 / 部分检测到）
5. Mock 环境变量覆盖测试（`SILLYHUB_CLAUDE_PATH` 优先于 PATH）
6. Mock `asyncio.create_subprocess_exec` 测试版本输出解析
7. 创建 `test_backends.py`，先写 BackendFactory 路由测试
8. 为每种 Backend 写 `parse_output` 测试（正常输入 + 边界输入）
9. 为每种 Backend 写 `execute` 测试（mock 子进程，验证命令行构造）

## 验收标准

| # | 验收项 | 通过条件 |
|---|--------|---------|
| 1 | AGENT_DEFS 完整性 | 断言 `set(AGENT_DEFS.keys()) == set(EXPECTED_AGENTS)`，12 个 agent 全部存在 |
| 2 | AgentDef 字段完整性 | 每个 AgentDef 的 bin/env_path/version_pattern/protocol 均非空字符串 |
| 3 | 环境变量覆盖 | `SILLYHUB_CLAUDE_PATH=/custom/claude` 时检测到的 bin_path 为该值 |
| 4 | shutil.which None | agent 未安装时 `DetectedAgent.available == False`，不抛异常 |
| 5 | parse_semver 标准 | `"2.1.0"` -> `(2, 1, 0)`，`"0.100.3"` -> `(0, 100, 3)` |
| 6 | parse_semver v 前缀 | `"v2.1.0"` -> `(2, 1, 0)` |
| 7 | parse_semver 垃圾输入 | `"not-a-version"` -> None，不崩溃 |
| 8 | check_min_version claude | `("claude", "1.9.0")` -> 非None, `("claude", "2.0.0")` -> None, `("claude", "2.1.0")` -> None |
| 9 | MIN_VERSIONS 映射 | claude="2.0.0", codex="0.100.0", copilot="1.0.0" |
| 10 | BackendFactory 路由 | 5 种 protocol 返回正确 backend 实例类型 |
| 11 | parse_output 正常输入 | 每种 backend 正确解析样本数据，返回 AgentEvent |
| 12 | parse_output 空行 | 所有 backend 对空行输入返回 None |
| 13 | execute 命令行构造 | StreamJsonBackend 传入 `--output-format stream-json` flag |
| 14 | pytest 全通过 | `pytest sillyhub-daemon/tests/ -v` 无失败用例 |
