---
id: task-01
title: "扩展 AgentDetector — 12 种 agent 定义 + 环境变量覆盖 + 版本检测"
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-07, task-10]
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/agent_detector.py
  - sillyhub-daemon/tests/test_agent_detector.py
author: qinyi
created_at: "2026-06-09 23:25:05"
---

# task-01: 扩展 AgentDetector — 12 种 agent 定义 + 环境变量覆盖 + 版本检测

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 修改 | `sillyhub-daemon/sillyhub_daemon/agent_detector.py` |
| 新增 | `sillyhub-daemon/tests/test_agent_detector.py` |

## 实现要求

1. 新增 `AgentDef` dataclass，字段：`bin: str`, `env_path: str`, `version_pattern: str`, `protocol: str`, `min_version: str | None = None`
2. 新增 `DetectedAgent` dataclass，字段：`name: str`, `bin_path: str`, `version: str | None`, `protocol: str`, `available: bool`, `version_warning: str | None`
3. 定义 `AGENT_DEFS` 类变量（`dict[str, AgentDef]`），包含 12 种 agent：

   | key | bin | env_path | version_pattern | protocol |
   |-----|-----|----------|----------------|----------|
   | claude | `claude` | `SILLYHUB_CLAUDE_PATH` | `r"Claude Code (\d+\.\d+\.\d+)"` | stream_json |
   | codex | `codex` | `SILLYHUB_CODEX_PATH` | `r"(\d+\.\d+\.\d+)"` | json_rpc |
   | copilot | `copilot` | `SILLYHUB_COPILOT_PATH` | `r"(\d+\.\d+\.\d+)"` | jsonl |
   | opencode | `opencode` | `SILLYHUB_OPENCODE_PATH` | `r"(\d+\.\d+\.\d+)"` | ndjson |
   | openclaw | `openclaw` | `SILLYHUB_OPENCLAW_PATH` | `r"(\d+\.\d+\.\d+)"` | ndjson |
   | hermes | `hermes` | `SILLYHUB_HERMES_PATH` | `r"(\d+\.\d+\.\d+)"` | json_rpc |
   | gemini | `gemini` | `SILLYHUB_GEMINI_PATH` | `r"(\d+\.\d+\.\d+)"` | stream_json |
   | pi | `pi` | `SILLYHUB_PI_PATH` | `r"(\d+\.\d+\.\d+)"` | ndjson |
   | cursor | `cursor-agent` | `SILLYHUB_CURSOR_PATH` | `r"(\d+\.\d+\.\d+)"` | stream_json |
   | kimi | `kimi` | `SILLYHUB_KIMI_PATH` | `r"(\d+\.\d+\.\d+)"` | json_rpc |
   | kiro | `kiro-cli` | `SILLYHUB_KIRO_PATH` | `r"(\d+\.\d+\.\d+)"` | json_rpc |
   | antigravity | `agy` | `SILLYHUB_ANTIGRAVITY_PATH` | `r"(\d+\.\d+\.\d+)"` | text |

4. 检测优先级：`os.getenv(env_path)` → `shutil.which(bin)` → 标记不可用
5. 版本检测使用 `asyncio.create_subprocess_exec(cmd, "--version")`，合并 stdout + stderr 输出，用 `version_pattern` 正则提取版本号
6. 调用 `version.py` 的 `check_min_version()` 生成 `version_warning`
7. 保留旧 `AgentInfo` / `get_capabilities` 向后兼容（标记 deprecated），新增 `detect_all()` 返回 `list[DetectedAgent]`
8. 保留 `is_available()` 方法，内部适配新 `AGENT_DEFS` 结构

## 接口定义

```python
import os
import re
import shutil
import asyncio
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class AgentDef:
    bin: str
    env_path: str
    version_pattern: str
    protocol: str
    min_version: str | None = None

@dataclass
class DetectedAgent:
    name: str
    bin_path: str
    version: str | None
    protocol: str
    available: bool
    version_warning: str | None = None

class AgentDetector:
    AGENT_DEFS: dict[str, AgentDef] = { ... }  # 12 entries

    async def detect_all(self) -> list[DetectedAgent]: ...
    async def detect_one(self, name: str) -> DetectedAgent | None: ...

    # 内部方法
    def _resolve_bin_path(self, defn: AgentDef) -> str | None: ...
    async def _detect_version(self, bin_path: str, defn: AgentDef) -> str | None: ...
```

## 边界处理

1. **环境变量指向不存在的路径**：`os.getenv()` 返回非空但文件不存在时，应 fallback 到 `shutil.which()`，不直接报错
2. **`shutil.which()` 返回 None**：bin_path 设为空字符串，`available=False`，`version=None`
3. **`--version` 命令超时**：`asyncio.wait_for` 设置 10 秒超时，超时后 `version=None`，`available=True`（二进制存在但版本未知）
4. **`--version` 命令 FileNotFoundError**：捕获异常，`version=None`，`available=True`（二进制被 which 找到但执行失败）
5. **版本正则不匹配**：`version=None`，`available=True`，不阻塞检测流程
6. **版本字符串格式异常**（如含非数字字符）：`parse_semver` 返回 None 时 `version_warning=None`，不产生误报警告
7. **环境变量路径含空格**：`create_subprocess_exec` 直接传路径参数，不经 shell，天然支持空格路径

## 非目标

- 不实现 login-shell fallback（Windows 不适用）
- 不实现模型发现（ListModels）
- 不修改 daemon.py 或 client.py（属于 task-07）
- 不新增后端 API

## 参考

- design.md Phase 1 Agent 检测体系
- multica `server/pkg/agent/agent.go` `New()` 工厂模式 + 12 种 agent 映射
- multica `server/pkg/agent/claude.go` `detectCLIVersion()` 版本检测模式
- 现有 `agent_detector.py` 的 `_detect_agent()` + `_get_version()` 实现

## TDD步骤

1. 写测试：`test_agent_defs_contains_12_entries` — 验证 AGENT_DEFS 有 12 个 key
2. 写测试：`test_resolve_bin_path_env_override` — mock os.getenv 返回自定义路径，验证优先于 shutil.which
3. 写测试：`test_resolve_bin_path_fallback_to_which` — env var 为空时 fallback 到 shutil.which
4. 写测试：`test_detect_version_success` — mock subprocess 返回 "Claude Code 2.1.5"，验证解析
5. 写测试：`test_detect_version_timeout` — mock asyncio.wait_for raise TimeoutError，验证 version=None
6. 写测试：`test_detect_version_pattern_no_match` — mock 输出不匹配正则，验证 version=None
7. 写测试：`test_detect_all_returns_all_agents` — mock which + version，验证返回 12 个 DetectedAgent
8. 写测试：`test_detect_all_marks_unavailable` — mock which 返回 None，验证 available=False
9. 写测试：`test_version_warning_set_when_below_min` — 检测到 claude 1.0.0，验证 version_warning 非空
10. 写测试：`test_backward_compat_agent_info` — 验证旧 AgentInfo/get_capabilities 仍可调用
11. 实现所有代码使测试通过

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-01 | AGENT_DEFS 包含 12 种 agent 定义 | 单元测试断言 len(AGENT_DEFS) == 12 |
| AC-02 | 环境变量覆盖优先于 PATH 查找 | mock os.getenv + shutil.which，验证优先级 |
| AC-03 | 二进制不存在时 available=False，bin_path="" | shutil.which 返回 None 的 mock 测试 |
| AC-04 | 版本检测成功时 version 字段有值 | mock subprocess 测试 |
| AC-05 | 版本检测失败（超时/异常/无匹配）时 version=None 但 available=True | 三种异常场景的 mock 测试 |
| AC-06 | 版本低于最低要求时 version_warning 非空 | 检测 claude 1.0.0，验证 warning |
| AC-07 | detect_all() 返回 12 个 DetectedAgent 实例 | 断言 len == 12 |
| AC-08 | 旧 AgentInfo/get_capabilities 接口仍可正常调用 | 向后兼容测试 |
| AC-09 | 所有 12 种 agent 的 protocol 字段正确映射 | 断言每个 AGENT_DEFS[key].protocol 值 |
