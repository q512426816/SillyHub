---
author: WhaleFall
created_at: 2026-06-08T11:10:17
---
---
id: task-03
title: "Parser `_parse_change()` 末尾调用推断方法写入 ParsedChange"
priority: P0
estimated_hours: 0.5
depends_on: [task-01, task-02]
blocks: [task-04]
allowed_paths:
  - backend/app/modules/change/parser.py
  - backend/tests/modules/change/test_parser.py
---

# task-03: Parser `_parse_change()` 末尾调用推断方法写入 ParsedChange

## 目标

在 `ChangeParser._parse_change()` 方法的 `return parsed` 之前，调用 task-01 和 task-02 新增的两个推断方法，将推断结果写入 `ParsedChange` 的 `change_type` 和 `affected_components` 字段。

## 修改文件

仅修改 `backend/app/modules/change/parser.py`，在 `_parse_change()` 方法内部添加 2 行调用代码。

测试文件 `backend/tests/modules/change/test_parser.py` 需要新增或更新测试用例。

## 当前代码位置

文件：`backend/app/modules/change/parser.py`

`_parse_change()` 方法位于第 182-295 行。当前第 295 行是 `return parsed`。

需要修改的位置：**第 294 行（`return parsed` 之前）**，在扫描 references 的循环之后、`return parsed` 之前插入代码。

当前代码上下文（第 280-295 行）：

```python
        # Scan references
        ref_dir = change_dir / "references"
        if ref_dir.is_dir():
            for ref in sorted(ref_dir.iterdir()):
                if ref.is_file() and not ref.name.startswith("."):
                    parsed.docs.append(
                        ParsedDoc(
                            doc_type="reference",
                            path=f"{rel_prefix}/references/{ref.name}",
                            exists=True,
                            filename=ref.name,
                            last_modified_at=datetime.utcfromtimestamp(ref.stat().st_mtime),
                        )
                    )

        return parsed
```

## 精确修改指令

### 步骤 1：在 `return parsed` 之前插入推断调用

在第 294 行（空行）和第 295 行（`return parsed`）之间，插入以下代码：

```python
        # --- Infer change_type and affected_components ---
        parsed.change_type = self._infer_change_type(change_dir)
        parsed.affected_components = self._infer_affected_components(change_dir, sillyspec_root)

        return parsed
```

**修改后完整的 `_parse_change()` 尾部应为：**

```python
        # Scan references
        ref_dir = change_dir / "references"
        if ref_dir.is_dir():
            for ref in sorted(ref_dir.iterdir()):
                if ref.is_file() and not ref.name.startswith("."):
                    parsed.docs.append(
                        ParsedDoc(
                            doc_type="reference",
                            path=f"{rel_prefix}/references/{ref.name}",
                            exists=True,
                            filename=ref.name,
                            last_modified_at=datetime.utcfromtimestamp(ref.stat().st_mtime),
                        )
                    )

        # --- Infer change_type and affected_components ---
        parsed.change_type = self._infer_change_type(change_dir)
        parsed.affected_components = self._infer_affected_components(change_dir, sillyspec_root)

        return parsed
```

### 步骤 2：无需其他修改

- **不需要** import 任何新模块（`Path` 已导入）
- **不需要** 修改方法签名（`sillyspec_root` 参数已存在于方法签名中）
- **不需要** 修改 `ParsedChange` dataclass（`change_type: str | None = None` 和 `affected_components: list[str] = field(default_factory=list)` 已存在，见第 45-55 行）
- `_parse_change()` 是实例方法（`self`），可以直接调用 `self._infer_change_type()` 和 `self._infer_affected_components()`，即使它们被定义为 `@staticmethod`（Python 实例可以调用 staticmethod）

## 调用约定（来自 task-01 / task-02）

两个方法的签名定义如下（由 task-01、task-02 实现）：

```python
@staticmethod
def _infer_change_type(change_dir: Path) -> str:
    """从目录结构推断变更类型。返回 'feature' | 'quick' | 'prototype'。"""

@staticmethod
def _infer_affected_components(change_dir: Path, sillyspec_root: Path) -> list[str]:
    """从 tasks.md 文件路径提取影响的模块名。返回模块名列表，无匹配返回空列表。"""
```

关键参数说明：
- `change_dir`：变更目录的绝对路径，例如 `Path("/path/to/.sillyspec/changes/2026-06-08-change-center-columns/")`
- `sillyspec_root`：工作区根路径，例如 `Path("/path/to/workspace/")`。该参数已存在于 `_parse_change()` 的签名中

## 边界处理

| 编号 | 场景 | 预期行为 |
|---|---|---|
| B-01 | `_infer_change_type()` 返回 `None` 或抛异常 | `parsed.change_type` 被设为 `None`。`ParsedChange.change_type` 类型为 `str \| None`，允许 None。`_apply_parsed()` 在 task-04 中会处理 None 值不覆盖 DB 已有值 |
| B-02 | `_infer_affected_components()` 返回 `None` 或抛异常 | **必须防御**：如果方法实现有 bug 返回 None 而非 []，会导致 `parsed.affected_components = None`，违反 `list[str]` 类型。但本任务只负责调用，防御逻辑由 task-01/02 保证返回值正确 |
| B-03 | 变更目录下无 tasks/、无 prototype-*.html、无 design.md | `_infer_change_type()` 按 task-01 设计返回 `"feature"`（默认值）。`_infer_affected_components()` 按 task-02 设计返回 `[]` |
| B-04 | `_infer_affected_components()` 中读取 tasks.md 失败（权限/编码） | 由 task-02 内部 try/except 处理，返回 `[]`，不影响 `_parse_change()` 主流程 |
| B-05 | legacy 变更（`is_legacy=True`） | 推断方法只依赖 `change_dir` 和 `sillyspec_root`，不关心 legacy 标记，正常执行推断 |
| B-06 | archive 变更（`location="archive"`） | 推断方法不关心 location，正常执行。`_infer_affected_components()` 可能读取到 `module-impact.md`（归档后存在的文件） |

## 测试要求

### 测试文件

`backend/tests/modules/change/test_parser.py`

### 测试用例

以下测试用例需新增或确认已有（如果该文件不存在则需创建）：

```python
import pytest
from pathlib import Path
from app.modules.change.parser import ChangeParser, ParsedChange


class TestParseChangeIntegration:
    """Integration tests for _parse_change() with inference methods."""

    def _make_parser(self) -> ChangeParser:
        return ChangeParser()

    def test_parse_change_sets_change_type_feature(self, tmp_path):
        """有 tasks/ 子目录 + design.md → change_type='feature'。"""
        # Setup: 创建变更目录结构
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-my-feature"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")
        (change_dir / "proposal.md").write_text("# My Feature")
        (change_dir / "design.md").write_text("# Design")
        tasks_dir = change_dir / "tasks"
        tasks_dir.mkdir()

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert parsed.change_type == "feature"
        assert isinstance(parsed.affected_components, list)

    def test_parse_change_sets_change_type_quick(self, tmp_path):
        """目录名含 'quick' → change_type='quick'。"""
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-quick-fix"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")
        (change_dir / "proposal.md").write_text("# Quick Fix")

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert parsed.change_type == "quick"

    def test_parse_change_sets_change_type_prototype(self, tmp_path):
        """有 prototype-*.html → change_type='prototype'。"""
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-prototype-demo"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")
        (change_dir / "proposal.md").write_text("# Prototype Demo")
        (change_dir / "prototype-demo.html").write_text("<html></html>")

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert parsed.change_type == "prototype"

    def test_parse_change_affected_components_populated(self, tmp_path):
        """有 tasks.md 包含文件路径 → affected_components 非空。"""
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-feature"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")
        (change_dir / "proposal.md").write_text("# Feature")
        (change_dir / "tasks.md").write_text(
            "- `backend/app/modules/change/parser.py`\n"
            "- `frontend/src/app/page.tsx`\n"
        )

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert isinstance(parsed.affected_components, list)
        # 具体模块名取决于 _module-map.yaml 匹配规则，至少不应报错

    def test_parse_change_affected_components_empty_when_no_tasks(self, tmp_path):
        """无 tasks.md → affected_components 为空列表。"""
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-simple"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")
        (change_dir / "proposal.md").write_text("# Simple")

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert parsed.affected_components == []

    def test_parse_change_returns_parsed_change_instance(self, tmp_path):
        """返回类型始终是 ParsedChange。"""
        sillyspec_root = tmp_path
        change_dir = sillyspec_root / ".sillyspec" / "changes" / "2026-01-01-test"
        change_dir.mkdir(parents=True)
        (change_dir / "MASTER.md").write_text("---\n---\n# test")

        parser = self._make_parser()
        parsed = parser._parse_change(
            sillyspec_root,
            change_dir,
            location="active",
            rel_prefix=f".sillyspec/changes/{change_dir.name}",
        )

        assert isinstance(parsed, ParsedChange)
        assert parsed.change_key == "2026-01-01-test"
        assert parsed.change_type is not None  # 至少有默认值 "feature"
```

**注意**：以上测试用例中 `assert parsed.change_type == "feature"` 等断言的具体值依赖于 task-01/02 的实现。如果 task-01 的推断规则有变化，测试断言需相应调整。核心要验证的是 `_parse_change()` 确实调用了推断方法并将结果写入了 `parsed` 对象。

## 验收标准

| 编号 | 验收项 | 验证方式 | PASS 条件 |
|---|---|---|---|
| A-01 | `_parse_change()` 末尾调用 `self._infer_change_type(change_dir)` | 读代码，在 `return parsed` 之前找到调用行 | 调用存在，参数正确 |
| A-02 | `_parse_change()` 末尾调用 `self._infer_affected_components(change_dir, sillyspec_root)` | 读代码，在 `return parsed` 之前找到调用行 | 调用存在，两个参数顺序正确 |
| A-03 | 推断结果写入 `parsed.change_type` | 读代码，确认赋值语句 `parsed.change_type = ...` | 赋值语句存在 |
| A-04 | 推断结果写入 `parsed.affected_components` | 读代码，确认赋值语句 `parsed.affected_components = ...` | 赋值语句存在 |
| A-05 | 不破坏已有 `_parse_change()` 功能 | 运行已有测试 + 新测试 | 所有测试 PASS |
| A-06 | `parse_workspace()` 调用链不受影响 | `parse_workspace()` 内部调用 `_parse_change()`，reparse 后 `change_type` 不再全是 `None` | 集成测试验证 |
| A-07 | 插入位置在 references 扫描之后、`return parsed` 之前 | 读代码确认位置 | 位置正确，不改变原有扫描逻辑顺序 |
| A-08 | 无新增 import | 检查文件顶部 | 无新增 import 行（推断方法定义在同类中） |
