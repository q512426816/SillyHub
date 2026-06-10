---
author: WhaleFall
created_at: 2026-06-08T11:10:17
---
---
id: task-01
title: "Parser 新增 `_infer_change_type()` 目录结构推断方法"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/change/parser.py
  - backend/tests/modules/change/test_parser.py
---

# task-01: Parser 新增 `_infer_change_type()` 目录结构推断方法

## 修改文件

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `backend/app/modules/change/parser.py` | 在 `ChangeParser` 类中新增 `_infer_change_type()` 静态方法 |
| 新增 | `backend/tests/modules/change/test_parser.py` | 单元测试，覆盖全部推断规则和边界情况 |

## 实现要求

### 1. 方法签名

在 `ChangeParser` 类中新增静态方法，放在 `_extract_title()` 方法之后、`_parse_change()` 方法之前：

```python
@staticmethod
def _infer_change_type(change_dir: Path) -> str:
    """从目录结构推断变更类型。

    推断规则（按优先级从高到低）：
    1. 有 prototype-*.html 文件 → "prototype"
    2. 目录名包含 "quick" → "quick"
    3. 有 tasks/ 子目录 且 有 (plan.md 或 design.md) → "feature"
    4. 仅有 MASTER.md + request.md（无 tasks/、无 design.md、无 plan.md）→ "quick"
    5. 默认 → "feature"

    Args:
        change_dir: 变更目录的 Path，例如 `.sillyspec/changes/2026-06-08-xxx/`

    Returns:
        字符串，取值为 "feature" / "quick" / "prototype"
    """
```

### 2. 推断规则详细说明

按以下顺序依次判断，命中即返回：

| 优先级 | 条件检查 | 返回值 | 说明 |
|--------|----------|--------|------|
| 1 | `any((change_dir / f).exists() is False for f in []) and any(change_dir.glob("prototype-*.html"))` → 有匹配文件 | `"prototype"` | 只要存在任何 `prototype-*.html` 文件就判定为原型 |
| 2 | `"quick"` in `change_dir.name.lower()` | `"quick"` | 目录名（即 change_key）包含 "quick" |
| 3 | `(change_dir / "tasks").is_dir() and ((change_dir / "plan.md").is_file() or (change_dir / "design.md").is_file())` | `"feature"` | 有 tasks 子目录且有 plan 或 design |
| 4 | `not (change_dir / "tasks").is_dir() and not (change_dir / "design.md").is_file() and not (change_dir / "plan.md").is_file()` 且 `(change_dir / "MASTER.md").is_file()` | `"quick"` | 仅 MASTER.md，无 tasks/ 无 design/plan |
| 5 | 以上均未命中 | `"feature"` | 兜底默认值 |

**注意**：规则 4 的完整判定条件为——没有 tasks/ 子目录、没有 design.md、没有 plan.md，且有 MASTER.md。这种"光杆"目录视为 quick 变更。

### 3. 代码实现参考

```python
@staticmethod
def _infer_change_type(change_dir: Path) -> str:
    """从目录结构推断变更类型。"""
    # 规则 1: prototype 文件
    if any(change_dir.glob("prototype-*.html")):
        return "prototype"

    dir_name_lower = change_dir.name.lower()

    # 规则 2: 目录名含 "quick"
    if "quick" in dir_name_lower:
        return "quick"

    has_tasks_dir = (change_dir / "tasks").is_dir()
    has_design = (change_dir / "design.md").is_file()
    has_plan = (change_dir / "plan.md").is_file()

    # 规则 3: tasks/ + (plan.md 或 design.md)
    if has_tasks_dir and (has_plan or has_design):
        return "feature"

    # 规则 4: 仅 MASTER.md（无 tasks/、无 design.md、无 plan.md）
    has_master = (change_dir / "MASTER.md").is_file()
    if not has_tasks_dir and not has_design and not has_plan and has_master:
        return "quick"

    # 规则 5: 默认
    return "feature"
```

### 4. 放置位置

- 在 `parser.py` 中，放在 `_extract_title()` 方法（第 168 行附近）之后、`_parse_change()` 方法（第 182 行附近）之前
- 属于 `ChangeParser` 类的内部方法

### 5. 本次任务不调用此方法

`_infer_change_type()` 的调用逻辑在 task-03（`_parse_change()` 末尾调用推断方法）中实现。本任务只需实现方法本身和测试。

## 接口定义

### 输入

| 参数 | 类型 | 约束 | 示例 |
|------|------|------|------|
| `change_dir` | `Path` | 必须是有效目录路径（但方法内不校验，由调用方保证） | `Path(".sillyspec/changes/2026-06-08-foo")` |

### 输出

| 返回值 | 类型 | 可选值 |
|--------|------|--------|
| 推断的变更类型 | `str` | `"feature"` / `"quick"` / `"prototype"` |

### 异常

- 方法内部 **不抛出任何异常**。所有 `Path.is_file()` / `Path.is_dir()` / `Path.glob()` 调用在路径不存在时返回 `False` / 空迭代器，不会抛异常。
- 不需要 try/except 包裹。

## 边界处理

| 编号 | 边界场景 | 预期行为 | 原因 |
|------|----------|----------|------|
| B-01 | `change_dir` 指向不存在的路径 | 返回 `"feature"`（默认值） | `Path.is_file()` / `is_dir()` 返回 False，所有条件均不命中 |
| B-02 | 目录名为 `"2026-06-05-quick-fix-xxx"` | 返回 `"quick"` | `change_dir.name.lower()` 包含 "quick"，命中规则 2 |
| B-03 | 目录名大写 `"QUICK-foo"` | 返回 `"quick"` | `.lower()` 转小写后再判断 |
| B-04 | 有 `tasks/` 子目录但为空（无文件） | 返回 `"feature"`（如果有 plan.md/design.md） | 只检查 `is_dir()` 不检查目录内容，符合设计意图 |
| B-05 | 有 `prototype-columns.html` 和 `design.md` | 返回 `"prototype"` | prototype 规则优先级最高（规则 1） |
| B-06 | 有 `tasks/` 但没有 `plan.md` 也没有 `design.md` | 返回 `"feature"`（默认值） | 规则 3 不命中（缺少 plan/design），规则 4 不命中（有 tasks/），走到默认 |
| B-07 | 仅有 `MASTER.md` 和 `request.md` | 返回 `"quick"` | 命中规则 4：无 tasks/、无 design/plan、有 MASTER.md |
| B-08 | 仅有 `proposal.md`（无 MASTER.md） | 返回 `"feature"`（默认值） | 规则 4 要求有 MASTER.md 才命中，否则走默认 |

## 非目标

- 本任务 **不修改** `_parse_change()` 方法
- 本任务 **不修改** `ParsedChange` 数据类
- 本任务 **不在** `_parse_change()` 中调用 `_infer_change_type()`
- 本任务 **不处理** `change_type` 写入 DB 的逻辑
- 本任务 **不修改** `service.py`

## TDD 步骤

### Step 1: 创建测试文件

创建 `backend/tests/modules/change/test_parser.py`：

```python
"""Tests for ChangeParser._infer_change_type() — task-01."""

import pytest
from pathlib import Path

from app.modules.change.parser import ChangeParser
```

### Step 2: 编写测试用例（RED 阶段）

按以下测试用例逐一编写，每个测试对应一个推断规则或边界条件：

| 测试函数名 | 测试目的 | 目录结构（tmp_path 下） | 预期返回 |
|------------|----------|------------------------|----------|
| `test_infer_feature_with_tasks_and_plan` | 规则 3：标准 feature | `tasks/`, `plan.md`, `MASTER.md` | `"feature"` |
| `test_infer_feature_with_tasks_and_design` | 规则 3：有 design 无 plan | `tasks/`, `design.md`, `MASTER.md` | `"feature"` |
| `test_infer_prototype_with_html` | 规则 1：prototype 文件 | `prototype-columns.html`, `design.md`, `tasks/` | `"prototype"` |
| `test_infer_quick_from_dir_name` | 规则 2：目录名含 quick | 目录名 `quick-fix-xxx`，内容: `MASTER.md`, `plan.md`, `tasks/` | `"quick"` |
| `test_infer_quick_bare_master` | 规则 4：仅 MASTER.md | `MASTER.md` | `"quick"` |
| `test_infer_quick_master_and_request` | 规则 4：MASTER + request | `MASTER.md`, `request.md` | `"quick"` |
| `test_infer_feature_default` | 规则 5：兜底默认 | `proposal.md` 仅此一个文件 | `"feature"` |
| `test_infer_feature_nonexistent_dir` | B-01：路径不存在 | 不创建目录 | `"feature"` |
| `test_infer_quick_case_insensitive` | B-03：大写 QUICK | 目录名 `QUICK-foo` | `"quick"` |
| `test_infer_prototype_priority_over_feature` | B-05：prototype 优先 | `prototype-test.html`, `tasks/`, `plan.md` | `"prototype"` |
| `test_infer_feature_tasks_no_plan_no_design` | B-06：有 tasks 无 plan/design | `tasks/`, `MASTER.md` | `"feature"` |
| `test_infer_feature_proposal_only` | B-08：仅 proposal.md | `proposal.md` | `"feature"` |

### Step 3: 运行测试确认全部失败（RED）

```bash
cd backend && python -m pytest tests/modules/change/test_parser.py -v
```

所有测试应报 `AttributeError: type object 'ChangeParser' has no attribute '_infer_change_type'`。

### Step 4: 实现 `_infer_change_type()`（GREEN）

在 `parser.py` 的 `ChangeParser` 类中添加方法（见"代码实现参考"小节）。

### Step 5: 运行测试确认全部通过（GREEN）

```bash
cd backend && python -m pytest tests/modules/change/test_parser.py -v
```

全部 PASS。

### Step 6: 确认已有测试不受影响

```bash
cd backend && python -m pytest tests/modules/change/ -v
```

无回归。

## 验收标准

| 编号 | 验收项 | 检查方法 | 通过条件 |
|------|--------|----------|----------|
| A-01 | `_infer_change_type()` 方法存在于 `ChangeParser` 类中 | `grep "_infer_change_type" backend/app/modules/change/parser.py` | 找到方法定义 |
| A-02 | 方法签名正确：`@staticmethod`，参数为 `change_dir: Path`，返回 `str` | 阅读源码 | 签名与设计一致 |
| A-03 | 推断规则 1（prototype）正确 | `test_infer_prototype_with_html` + `test_infer_prototype_priority_over_feature` | PASS |
| A-04 | 推断规则 2（quick 目录名）正确 | `test_infer_quick_from_dir_name` + `test_infer_quick_case_insensitive` | PASS |
| A-05 | 推断规则 3（feature：tasks/ + plan/design）正确 | `test_infer_feature_with_tasks_and_plan` + `test_infer_feature_with_tasks_and_design` | PASS |
| A-06 | 推断规则 4（quick：仅 MASTER.md）正确 | `test_infer_quick_bare_master` + `test_infer_quick_master_and_request` | PASS |
| A-07 | 推断规则 5（默认 feature）正确 | `test_infer_feature_default` + `test_infer_feature_nonexistent_dir` + `test_infer_feature_proposal_only` | PASS |
| A-08 | 边界 B-06（有 tasks 无 plan/design → feature） | `test_infer_feature_tasks_no_plan_no_design` | PASS |
| A-09 | 方法不抛异常（路径不存在等） | `test_infer_feature_nonexistent_dir` 无 Exception | PASS |
| A-10 | 测试文件 `test_parser.py` 存在 | `ls backend/tests/modules/change/test_parser.py` | 文件存在 |
| A-11 | 所有测试通过 | `cd backend && python -m pytest tests/modules/change/test_parser.py -v` | 0 failed |
| A-12 | 已有测试无回归 | `cd backend && python -m pytest tests/modules/change/ -v` | 0 new failures |
| A-13 | 方法放在 `_extract_title()` 之后、`_parse_change()` 之前 | 阅读源码行号顺序 | 位置正确 |
| A-14 | 不修改 `_parse_change()` / `ParsedChange` / `service.py` | `git diff` 检查 | 这些文件无改动 |
