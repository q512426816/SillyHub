---
author: WhaleFall
created_at: 2026-06-08T11:10:17
---
---
id: task-02
title: Parser 新增 `_infer_affected_components()` 模块名提取方法
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/change/parser.py
  - backend/tests/modules/change/test_parser.py
---

# task-02: Parser 新增 `_infer_affected_components()` 模块名提取方法

## 目标

在 `ChangeParser` 类中新增 `@staticmethod _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]`，从变更目录的文件内容中提取受影响的模块名列表。

## 接口定义

```python
# 文件: backend/app/modules/change/parser.py
# 类: ChangeParser

@staticmethod
def _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]:
    """从变更目录的文档中提取受影响的模块名列表。

    推断优先级:
      1. module-impact.md 存在 → 提取"模块影响矩阵"表中的模块名
      2. 否则扫描 tasks.md + tasks/*.md → 提取文件路径 → 匹配 module-map

    Args:
        change_dir: 变更目录路径 (如 .sillyspec/changes/xxx/)
        sillyspec_root: .sillyspec 根目录的父目录 (workspace root)

    Returns:
        模块名列表 (如 ["change", "frontend_app"])，去重且保持出现顺序。
        无匹配返回空列表 []。
    """
```

## 推断逻辑（伪代码）

```
function _infer_affected_components(change_dir, sillyspec_root):
    # ===== 路径 1: module-impact.md =====
    module_impact_path = change_dir / "module-impact.md"
    if module_impact_path.is_file():
        content = module_impact_path.read_text("utf-8")
        modules = extract_from_impact_table(content)
        if modules 不为空:
            return modules

    # ===== 路径 2: tasks.md + tasks/*.md =====
    file_paths = set()
    tasks_md = change_dir / "tasks.md"
    if tasks_md.is_file():
        file_paths |= extract_file_paths(tasks_md)

    tasks_dir = change_dir / "tasks"
    if tasks_dir.is_dir():
        for task_file in sorted(tasks_dir.glob("*.md")):
            file_paths |= extract_file_paths(task_file)

    if file_paths 为空:
        return []

    # ===== 路径 3: 匹配 _module-map.yaml =====
    module_map_path = sillyspec_root / ".sillyspec" / "docs" / "<project>" / "modules" / "_module-map.yaml"
    # 注意: sillyspec_root 下可能有多个项目，需要遍历 modules/ 下的子目录
    # 实际策略: 遍历 .sillyspec/docs/*/modules/_module-map.yaml，找到第一个存在的

    map = load_module_map(module_map_path)
    if map 为空:
        return []

    return match_paths_to_modules(file_paths, map)
```

### 辅助函数 1: `extract_from_impact_table(content: str) -> list[str]`

从 module-impact.md 的"模块影响矩阵"表格中提取第一列的模块名。

```python
@staticmethod
def _extract_from_impact_table(content: str) -> list[str]:
    """从 module-impact.md 的 Markdown 表格提取模块名。

    表格格式示例:
        | 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
        |------|----------|----------|-------------|
        | agent | 逻辑变更 | backend/app/modules/agent/xxx | ... |
        | frontend | 接口变更 | frontend/src/xxx | ... |

    提取规则:
      - 找到含 "| 模块 |" 的表头行
      - 跳过紧随其后的分隔行 (|---|---|)
      - 后续每行取第 1 列（strip 空白）
      - 去重，保持出现顺序
    """
```

识别逻辑：
1. 逐行扫描，找到包含 `| 模块 |` 的行作为表头
2. 跳过下一行（分隔线 `|---|`）
3. 后续以 `|` 开头的行，取第一个 `|` 和第二个 `|` 之间的文本，strip 后作为模块名
4. 遇到空行或非表格行则停止
5. 跳过空字符串，去重保持顺序

### 辅助函数 2: `_extract_file_paths(text: str) -> set[str]`

从文本中提取文件路径。

```python
@staticmethod
def _extract_file_paths(text: str) -> set[str]:
    """从 Markdown 文本中提取文件路径。

    匹配规则（按优先级）:
      1. 行内代码块中的路径: `backend/app/modules/xxx.py`
      2. 裸路径: 行首或空格后的 backend/xxx 或 frontend/xxx 路径

    正则模式:
      - `([a-zA-Z0-9_/.-]+\.(?:py|ts|tsx|js|jsx|yaml|yml|json|html|css|md))`
      - 且以 "backend/" 或 "frontend/" 或 "deploy/" 或 "docs/" 开头
      - 或者匹配行内代码 `...` 中的路径

    返回:
        文件路径集合，如 {"backend/app/modules/agent/router.py", "frontend/src/lib/api.ts"}
    """
```

实现要点：
- 使用正则 `r'`((?:backend|frontend|deploy|docs)/[a-zA-Z0-9_/.-]+\.(?:py|ts|tsx|js|jsx|yaml|yml|json|html|css|md))`'` 提取反引号中的路径
- 额外用正则 `r'(?<!\w)((?:backend|frontend|deploy|docs)/[a-zA-Z0-9_/.-]+\.(?:py|ts|tsx|js|jsx|yaml|yml|json|html|css|md))'` 提取裸路径
- 合并去重

### 辅助函数 3: `_load_module_map(sillyspec_root: Path) -> dict[str, list[str]]`

加载 module-map.yaml 并解析为 `{模块名: [路径前缀列表]}` 的字典。

```python
@staticmethod
def _load_module_map(sillyspec_root: Path) -> dict[str, list[str]]:
    """加载 _module-map.yaml。

    查找路径: .sillyspec/docs/*/modules/_module-map.yaml
    取第一个存在的文件。

    YAML 结构:
        modules:
          agent:
            paths:
              - backend/app/modules/agent/**
            description: ...

    返回:
        {"agent": ["backend/app/modules/agent/"], "frontend_app": ["frontend/src/app/"], ...}
        paths 中的 ** 通配符被去掉，尾部保留 /
    """
```

实现要点：
- 遍历 `sillyspec_root / ".sillyspec" / "docs"` 下的子目录
- 在每个 `<project>/modules/_module-map.yaml` 查找
- 解析 YAML，读取 `modules` → 每个模块 → `paths`
- 每个 path 去掉 `**` 后缀，保留 `/` 结尾作为前缀
- 如果文件不存在或解析失败，返回空 dict

### 辅助函数 4: `_match_paths_to_modules(file_paths: set[str], module_map: dict[str, list[str]]) -> list[str]`

用文件路径集合匹配 module_map 中的模块。

```python
@staticmethod
def _match_paths_to_modules(file_paths: set[str], module_map: dict[str, list[str]]) -> list[str]:
    """将文件路径匹配到模块名。

    匹配策略: 前缀匹配
      - file_path = "backend/app/modules/agent/router.py"
      - module_map["agent"] = ["backend/app/modules/agent/"]
      - file_path.startswith("backend/app/modules/agent/") → 命中 "agent"

    返回:
        匹配到的模块名列表，去重保持出现顺序。
        按 file_paths 的迭代顺序决定模块名出现顺序。
    """
```

## 在 `_parse_change()` 中的调用位置

```python
# parser.py, ChangeParser._parse_change() 方法末尾 (约 line 293 后)

        # ... 现有代码 ...

        # Infer metadata from directory structure
        parsed.change_type = self._infer_change_type(change_dir)
        parsed.affected_components = self._infer_affected_components(change_dir, sillyspec_root)

        return parsed
```

注意: `_infer_change_type()` 是 task-01 的内容。task-02 只实现 `_infer_affected_components()`。在 `_parse_change()` 末尾的实际集成由 task-03 负责。本任务只需确保方法本身可被调用即可。

## 依赖的导入

```python
import re
import yaml  # PyYAML，项目已有依赖

from pathlib import Path
```

检查 yaml 是否已在项目依赖中：如果不在，可以使用手动解析（module-map.yaml 结构简单）。但实际上 PyYAML 在 FastAPI 项目中几乎必定存在。实现时先 `import yaml`，如果 import 失败则 try-except 降级为返回空列表。

## 测试要求

文件: `backend/tests/modules/change/test_parser.py`

### 测试用例列表

| # | 测试名 | 输入 | 预期输出 | 说明 |
|---|--------|------|----------|------|
| 1 | `test_impact_table_extraction` | module-impact.md 含标准表格 | `["agent", "frontend"]` | 主路径：module-impact.md 存在 |
| 2 | `test_impact_table_empty` | module-impact.md 无表格 | `[]` | module-impact.md 存在但无表格 |
| 3 | `test_tasks_md_file_paths` | tasks.md 含反引号路径 | 匹配到对应模块名 | 主路径：从 tasks.md 提取路径 |
| 4 | `test_tasks_dir_glob` | tasks/ 下有 task-01.md 含路径 | 匹配到对应模块名 | tasks/ 子目录扫描 |
| 5 | `test_no_docs_returns_empty` | 空 change_dir | `[]` | 无任何文档 |
| 6 | `test_module_map_not_found` | _module-map.yaml 不存在 | `[]` | module-map 缺失降级 |
| 7 | `test_path_prefix_matching` | 路径 `backend/app/modules/change/parser.py` | 匹配到 `change` 模块 | 前缀匹配准确性 |
| 8 | `test_dedup_modules` | 多个路径属于同一模块 | 模块名只出现一次 | 去重 |
| 9 | `test_impact_priority_over_tasks` | module-impact.md 和 tasks.md 都有内容 | 只返回 impact 表格的模块 | 优先级：impact > tasks |
| 10 | `test_multiple_modules_matched` | 路径涉及 change + frontend_app | `["change", "frontend_app"]` | 多模块匹配 |

### 测试 fixture 结构

```python
import pytest
from pathlib import Path
from app.modules.change.parser import ChangeParser

@pytest.fixture
def module_map_dir(tmp_path):
    """创建包含 _module-map.yaml 的目录结构。"""
    docs_dir = tmp_path / ".sillyspec" / "docs" / "testproject" / "modules"
    docs_dir.mkdir(parents=True)
    map_file = docs_dir / "_module-map.yaml"
    map_file.write_text("""
modules:
  agent:
    paths:
      - backend/app/modules/agent/**
    description: Agent 管理
  change:
    paths:
      - backend/app/modules/change/**
    description: 变更管理
  frontend_app:
    paths:
      - frontend/src/app/**
    description: 前端页面
""", encoding="utf-8")
    return tmp_path

@pytest.fixture
def change_dir(tmp_path):
    """创建空的 change 目录。"""
    d = tmp_path / "change-test"
    d.mkdir()
    return d
```

## 边界处理（至少 5 条）

| # | 边界场景 | 处理方式 | 返回值 |
|---|----------|----------|--------|
| B1 | change_dir 不存在 | 方法不自行检查，由调用方保证。`Path.is_file()` / `Path.is_dir()` 天然返回 False | `[]` |
| B2 | module-impact.md 或 tasks.md 内容为空文件 | 读取空字符串，正则匹配不到任何内容 | `[]` |
| B3 | tasks.md 中的路径不在 module-map 任何前缀下 | 该路径不产生匹配，不影响其他路径的匹配 | 仅返回有匹配的模块名 |
| B4 | _module-map.yaml 不存在或 YAML 格式损坏 | `yaml.safe_load` 异常被 try-except 捕获，返回空 dict | `[]` |
| B5 | module-impact.md 表格中模块名有重复 | 去重，保持首次出现顺序 | 去重后的列表 |
| B6 | 文件路径包含中文或特殊字符 | 正则只匹配 ASCII 字母数字下划线的路径，自动跳过中文路径 | 不匹配 |
| B7 | module-map 的 paths 模式不以 `**` 结尾（如 `backend/app/core/config.py`） | 去掉 `**` 后作为前缀使用，不影响无通配符的 path | 正常前缀匹配 |

## 验收标准

| # | 验收项 | 通过条件 | 验证方式 |
|---|--------|----------|----------|
| A1 | 方法签名正确 | `@staticmethod def _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]` 存在于 `ChangeParser` 类中 | 代码审查 |
| A2 | module-impact.md 路径可用 | 给定含标准"模块影响矩阵"表格的 module-impact.md，返回表格中所有模块名 | `test_impact_table_extraction` 通过 |
| A3 | tasks.md 路径可用 | 给定含反引号路径的 tasks.md，提取路径后匹配 module-map 返回模块名 | `test_tasks_md_file_paths` 通过 |
| A4 | tasks/ 子目录扫描 | tasks/ 目录下的 task-*.md 中的路径也被提取 | `test_tasks_dir_glob` 通过 |
| A5 | 优先级正确 | module-impact.md 存在时只读 impact，不读 tasks.md | `test_impact_priority_over_tasks` 通过 |
| A6 | 空值降级 | 无文档或无匹配时返回 `[]`，不抛异常 | `test_no_docs_returns_empty` 通过 |
| A7 | 去重 | 多个路径属于同一模块时，模块名只出现一次 | `test_dedup_modules` 通过 |
| A8 | module-map 缺失降级 | _module-map.yaml 不存在时返回 `[]`，不抛异常 | `test_module_map_not_found` 通过 |
| A9 | 测试覆盖 | 10 个测试用例全部通过 | `pytest backend/tests/modules/change/test_parser.py -v` |
| A10 | 不影响现有解析 | 现有 `parse_workspace()` 和 `_parse_change()` 行为不变 | 现有测试不受影响 |
