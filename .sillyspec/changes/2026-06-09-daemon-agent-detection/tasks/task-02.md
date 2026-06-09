---
id: task-02
title: "版本校验模块（semver 解析 + 最低版本检查）"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-01, task-10]
allowed_paths:
  - sillyhub-daemon/sillyhub_daemon/version.py
  - sillyhub-daemon/tests/test_version.py
author: qinyi
created_at: "2026-06-09 23:25:05"
---

# task-02: 版本校验模块（semver 解析 + 最低版本检查）

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 新增 | `sillyhub-daemon/sillyhub_daemon/version.py` |
| 新增 | `sillyhub-daemon/tests/test_version.py` |

## 实现要求

1. 实现 `parse_semver(raw: str) -> tuple[int, int, int] | None`
   - 使用正则 `r"(\d+)\.(\d+)\.(\d+)"` 提取 major/minor/patch
   - 从字符串中找第一个匹配（处理 "Claude Code 2.1.5" 等前缀噪声）
   - 转为 `int` 返回，不匹配则返回 `None`
   - 不依赖第三方库（如 semver/packaging），纯标准库实现

2. 定义 `MIN_VERSIONS` 常量映射：

   ```python
   MIN_VERSIONS: dict[str, tuple[int, int, int]] = {
       "claude":  (2, 0, 0),
       "codex":   (0, 100, 0),
       "copilot": (1, 0, 0),
   }
   ```

3. 实现 `check_min_version(provider: str, version: str) -> str | None`
   - 调用 `parse_semver(version)` 获取 parsed version
   - 如果 provider 不在 `MIN_VERSIONS` 中，返回 `None`（无要求）
   - 如果 `parse_semver` 返回 `None`，返回 `None`（无法解析，不报警告）
   - 如果 parsed version < MIN_VERSIONS[provider]，返回警告消息字符串：`f"{provider} version {version} is below minimum required version {min_ver_str}"`
   - 如果 version >= 最低版本，返回 `None`

4. 辅助函数 `format_semver(triple: tuple[int, int, int]) -> str`：将 tuple 转回 `"major.minor.patch"` 字符串

## 接口定义

```python
"""Semver parsing and minimum version checking for agent binaries."""

from __future__ import annotations

import re

_SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")

MIN_VERSIONS: dict[str, tuple[int, int, int]] = {
    "claude":  (2, 0, 0),
    "codex":   (0, 100, 0),
    "copilot": (1, 0, 0),
}

def parse_semver(raw: str) -> tuple[int, int, int] | None:
    """Extract first semver triple from an arbitrary string."""
    match = _SEMVER_RE.search(raw)
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))

def format_semver(triple: tuple[int, int, int]) -> str:
    """Format a semver triple as 'major.minor.patch'."""
    return f"{triple[0]}.{triple[1]}.{triple[2]}"

def check_min_version(provider: str, version: str) -> str | None:
    """Return warning message if version is below minimum, else None."""
    ...
```

## 边界处理

1. **版本字符串含前缀噪声**（如 `"Claude Code 2.1.5"`）：`parse_semver` 使用 `search()` 而非 `match()`，正确提取 `2.1.5`
2. **版本字符串含后缀**（如 `"0.118.0-rc.1"`）：正则只取前三个数字段，忽略后缀
3. **空字符串**：`parse_semver("")` 返回 `None`，`check_min_version` 返回 `None`
4. **provider 不在 MIN_VERSIONS 中**：`check_min_version` 返回 `None`（无版本要求）
5. **版本号各段含前导零**（如 `"02.01.05"`）：`int("02")` 正常解析为 2，不影响比较
6. **超大版本号**（如 `"999.999.999"`）：tuple 比较天然正确，无需特殊处理
7. **版本字符串含多个 semver**（如 `"requires 1.0.0, found 2.1.5"`）：`search()` 取第一个匹配 `1.0.0`——调用方应先提取纯版本再传入

## 非目标

- 不实现完整的 semver 规范（pre-release 标识、build metadata 等）
- 不实现版本范围语法（`>=1.0.0 <2.0.0`）
- 不引入第三方依赖
- 不修改 agent_detector.py（task-01 负责）

## 参考

- design.md 版本最低要求表格
- multica `server/pkg/agent/agent.go` DetectVersion 模式
- Python tuple 比较语义：(1,2,3) < (2,0,0) 为 True

## TDD步骤

1. 写测试：`test_parse_semver_standard` — `"2.1.5"` → `(2, 1, 5)`
2. 写测试：`test_parse_semver_with_prefix` — `"Claude Code 2.1.5"` → `(2, 1, 5)`
3. 写测试：`test_parse_semver_with_suffix` — `"0.118.0-rc.1"` → `(0, 118, 0)`
4. 写测试：`test_parse_semver_no_match` — `"no-version-here"` → `None`
5. 写测试：`test_parse_semver_empty` — `""` → `None`
6. 写测试：`test_format_semver` — `(2, 1, 5)` → `"2.1.5"`
7. 写测试：`test_check_min_version_below` — claude "1.5.0" → 非 None 警告
8. 写测试：`test_check_min_version_equal` — claude "2.0.0" → None
9. 写测试：`test_check_min_version_above` — claude "2.1.5" → None
10. 写测试：`test_check_min_version_unknown_provider` — `"unknown" "1.0.0"` → None
11. 写测试：`test_check_min_version_codex_large_minor` — codex "0.100.0" → None, codex "0.99.0" → 非 None
12. 写测试：`test_check_min_version_unparseable` — claude "no-version" → None
13. 实现所有代码使测试通过

## 验收标准

| 编号 | 验收条件 | 验证方式 |
|------|---------|---------|
| AC-01 | parse_semver 从标准版本字符串正确提取三元组 | 单元测试 |
| AC-02 | parse_semver 从含前缀/后缀噪声的字符串提取版本 | 单元测试 |
| AC-03 | parse_semver 对不匹配输入返回 None | 单元测试 |
| AC-04 | MIN_VERSIONS 包含 claude/codex/copilot 三项 | 断言 len(MIN_VERSIONS) == 3 |
| AC-05 | check_min_version 低于最低版本时返回警告字符串 | 单元测试 |
| AC-06 | check_min_version 等于或高于最低版本时返回 None | 单元测试 |
| AC-07 | check_min_version 对未知 provider 返回 None | 单元测试 |
| AC-08 | check_min_version 对无法解析的版本返回 None | 单元测试 |
| AC-09 | 不引入第三方依赖 | import 检查 |
