---
author: WhaleFall
created_at: 2026-06-08T11:10:17
---
---
id: task-04
title: "`_apply_parsed()` 添加 change_type 和 affected_components 的 reparse 覆盖逻辑"
priority: P0
estimated_hours: 0.5
depends_on: [task-01, task-02, task-03]
blocks: [task-05]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/tests/modules/change/test_service.py
---

# task-04: `_apply_parsed()` 添加 change_type 和 affected_components 的 reparse 覆盖逻辑

## 目标

修改 `ChangeService._apply_parsed()` 方法，在 reparse 时允许 Parser 推断的 `change_type` 和 `affected_components` 覆盖 DB 值。当前代码注释声称"DB 是唯一真实数据源，不要从文件系统覆盖"——这个策略需要反转，以让 Wave 1（task-01/02/03）产生的推断值生效。

## 修改文件

- `backend/app/modules/change/service.py` — 修改 `_apply_parsed()` 方法（第 934-950 行）
- `backend/tests/modules/change/test_service.py` — 新增 `_apply_parsed()` 的单元测试

## 当前代码

文件：`backend/app/modules/change/service.py`，第 934-950 行：

```python
@staticmethod
def _apply_parsed(
    row: Change,
    parsed: ParsedChange,
    *,
    workspace_id: uuid.UUID,
) -> None:
    row.title = parsed.title
    # DB is the source of truth for status, change_type, and
    # affected_components — never overwrite them from the filesystem.
    # change_type/owner come from the change-creation form; affected_components
    # is written from module-impact.md during archive. The parser no longer
    # reads frontmatter, so parsed values for these are empty placeholders.
    # Workflow transitions update DB directly; reparse must not reset them.
    row.change_key = parsed.change_key
    row.location = parsed.location
    row.path = parsed.path
```

## 覆盖策略

两个字段采用不同的覆盖策略：

| 字段 | DB 类型 | ParsedChange 类型 | 覆盖策略 | 原因 |
|---|---|---|---|---|
| `change_type` | `String(50), nullable=True` | `str \| None` | **仅在 DB 值为 `None` 时覆盖** | 保护用户通过创建表单手动设置的值（design.md R-02） |
| `affected_components` | `JSON, nullable=False, default=list` | `list[str]` | **始终覆盖** | 推断值（从 tasks.md 提取的模块名）比旧值更准确；旧值仅归档时写入，未归档变更全是空列表 |

## 精确修改指令

### 步骤 1：修改 `_apply_parsed()` 方法体

将第 934-950 行替换为：

```python
@staticmethod
def _apply_parsed(
    row: Change,
    parsed: ParsedChange,
    *,
    workspace_id: uuid.UUID,
) -> None:
    row.title = parsed.title
    # change_type: only overwrite when DB value is None (protect user-set values)
    if row.change_type is None and parsed.change_type is not None:
        row.change_type = parsed.change_type
    # affected_components: always overwrite (inferred value is more accurate)
    if parsed.affected_components:
        row.affected_components = parsed.affected_components
    row.change_key = parsed.change_key
    row.location = parsed.location
    row.path = parsed.path
```

### 步骤 2：确认无需其他修改

- **不需要** import 新模块（`Change` 和 `ParsedChange` 已在文件中导入）
- **不需要** 修改方法签名
- **不需要** 修改 `_from_parsed()` 方法（第 920-932 行），该方法仅在首次创建时调用，已经正确写入 `change_type` 和 `affected_components`
- **不需要** 修改 `_apply_parsed()` 的调用方（第 693 行），调用方式不变

## 接口定义

### 方法签名（不变）

```python
@staticmethod
def _apply_parsed(
    row: Change,          # SQLAlchemy Change model instance（已持久化到 DB 的记录）
    parsed: ParsedChange, # Parser 解析结果（包含 task-01/02 推断的值）
    *,
    workspace_id: uuid.UUID,
) -> None:
    """将 ParsedChange 的字段合并到已有的 Change DB 记录上。

    覆盖策略：
    - title: 始终覆盖（文件系统是 title 的数据源）
    - change_type: 仅 DB 值为 None 时覆盖（保护用户手动设置）
    - affected_components: 始终覆盖（推断值比旧值更准确）
    - change_key / location / path: 始终覆盖（文件系统元数据）
    """
```

### Change 模型字段定义（参考，不可修改）

```python
# backend/app/modules/change/model.py
class Change(SQLModel, table=True):
    affected_components: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False, default=list),
    )
    change_type: str | None = Field(
        default=None,
        sa_column=Column(String(50), nullable=True),
    )
```

### ParsedChange 字段定义（参考，不可修改）

```python
# backend/app/modules/change/parser.py
@dataclass
class ParsedChange:
    change_type: str | None = None
    affected_components: list[str] = field(default_factory=list)
```

## 边界处理（7 条）

| 编号 | 场景 | 预期行为 | 处理方式 |
|---|---|---|---|
| B-01 | `row.change_type` 为 `None`，`parsed.change_type` 为 `"feature"` | `row.change_type` 被设为 `"feature"` | `if row.change_type is None and parsed.change_type is not None` 条件满足，执行赋值 |
| B-02 | `row.change_type` 为 `"quick"`（用户手动设置），`parsed.change_type` 为 `"feature"`（推断值） | `row.change_type` 保持 `"quick"`，不被覆盖 | `if row.change_type is None` 条件不满足，跳过赋值 |
| B-03 | `row.change_type` 为 `None`，`parsed.change_type` 也为 `None` | `row.change_type` 保持 `None` | `parsed.change_type is not None` 条件不满足，跳过赋值 |
| B-04 | `parsed.affected_components` 为 `["change", "frontend"]`，`row.affected_components` 为 `[]` | `row.affected_components` 被设为 `["change", "frontend"]` | `if parsed.affected_components` 条件满足（非空列表为 truthy），执行赋值 |
| B-05 | `parsed.affected_components` 为 `[]`（推断无结果），`row.affected_components` 为 `["change"]`（归档时写入的值） | `row.affected_components` 保持 `["change"]`，不被空列表覆盖 | `if parsed.affected_components` 条件不满足（空列表为 falsy），跳过赋值。这保护了归档时写入的精确值 |
| B-06 | `parsed.affected_components` 为 `[]`，`row.affected_components` 也为 `[]` | 不执行任何操作，值不变 | 空列表不覆盖空列表，结果相同 |
| B-07 | `parsed.affected_components` 为 `["change"]`，`row.affected_components` 为 `["change", "agent"]`（DB 中已有旧值） | `row.affected_components` 被覆盖为 `["change"]` | `if parsed.affected_components` 条件满足，始终覆盖。推断值被认为比旧值更准确 |

## 非目标

- **不修改** `Change` 模型定义
- **不修改** `ParsedChange` dataclass 定义
- **不修改** `_from_parsed()` 方法（首次创建逻辑）
- **不修改** `_apply_parsed()` 的调用方（`reparse` 方法）
- **不修改** `status` 字段的覆盖策略（status 仍然不覆盖，由 workflow 直接管理）
- **不修改** `owner_id` 字段（仍然不在 `_apply_parsed` 中处理）

## TDD 步骤

### 步骤 1：编写测试

在 `backend/tests/modules/change/test_service.py` 中新增测试类。如果该文件不存在则创建。

```python
import uuid
import pytest
from unittest.mock import MagicMock

from app.modules.change.model import Change
from app.modules.change.parser import ParsedChange
from app.modules.change.service import ChangeService


class TestApplyParsed:
    """Unit tests for ChangeService._apply_parsed()."""

    def _make_row(self, **overrides) -> Change:
        """创建一个模拟的 Change DB row。"""
        defaults = {
            "id": uuid.uuid4(),
            "workspace_id": uuid.uuid4(),
            "change_key": "2026-01-01-test-change",
            "title": "Test Change",
            "status": "draft",
            "location": "active",
            "path": ".sillyspec/changes/2026-01-01-test-change",
            "affected_components": [],
            "change_type": None,
            "owner_id": None,
        }
        defaults.update(overrides)
        row = Change(**defaults)
        return row

    def _make_parsed(self, **overrides) -> ParsedChange:
        """创建一个模拟的 ParsedChange。"""
        defaults = {
            "change_key": "2026-01-01-test-change",
            "title": "Updated Title",
            "status": "draft",
            "location": "active",
            "path": ".sillyspec/changes/2026-01-01-test-change",
            "affected_components": [],
            "change_type": None,
        }
        defaults.update(overrides)
        return ParsedChange(**defaults)

    # --- change_type 覆盖测试 ---

    def test_change_type_overwritten_when_db_is_none(self):
        """B-01: DB 值为 None 时，parsed 值覆盖。"""
        row = self._make_row(change_type=None)
        parsed = self._make_parsed(change_type="feature")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.change_type == "feature"

    def test_change_type_preserved_when_db_has_value(self):
        """B-02: DB 值非 None 时，parsed 值不覆盖（保护用户手动设置）。"""
        row = self._make_row(change_type="quick")
        parsed = self._make_parsed(change_type="feature")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.change_type == "quick"

    def test_change_type_unchanged_when_both_none(self):
        """B-03: 两者都为 None 时，保持 None。"""
        row = self._make_row(change_type=None)
        parsed = self._make_parsed(change_type=None)
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.change_type is None

    def test_change_type_preserved_for_all_non_none_db_values(self):
        """change_type: DB 值为 feature/quick/prototype 时均不被覆盖。"""
        for existing in ["feature", "quick", "prototype"]:
            row = self._make_row(change_type=existing)
            parsed = self._make_parsed(change_type="quick")
            ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
            assert row.change_type == existing, f"DB value '{existing}' should not be overwritten"

    # --- affected_components 覆盖测试 ---

    def test_affected_components_overwritten_when_parsed_has_value(self):
        """B-04: parsed 有值时，始终覆盖 DB 的空列表。"""
        row = self._make_row(affected_components=[])
        parsed = self._make_parsed(affected_components=["change", "frontend"])
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.affected_components == ["change", "frontend"]

    def test_affected_components_preserved_when_parsed_empty(self):
        """B-05: parsed 为空列表时，不覆盖 DB 中已有的归档值。"""
        row = self._make_row(affected_components=["change"])
        parsed = self._make_parsed(affected_components=[])
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.affected_components == ["change"]

    def test_affected_components_unchanged_when_both_empty(self):
        """B-06: 两者都为空列表时，值不变。"""
        row = self._make_row(affected_components=[])
        parsed = self._make_parsed(affected_components=[])
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.affected_components == []

    def test_affected_components_always_overwritten_when_parsed_has_value(self):
        """B-07: parsed 有值时，即使 DB 已有旧值也覆盖。"""
        row = self._make_row(affected_components=["change", "agent"])
        parsed = self._make_parsed(affected_components=["change"])
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.affected_components == ["change"]

    # --- 其他字段不受影响 ---

    def test_title_always_overwritten(self):
        """title 始终从 parsed 覆盖。"""
        row = self._make_row(title="Old Title")
        parsed = self._make_parsed(title="New Title")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.title == "New Title"

    def test_change_key_always_overwritten(self):
        """change_key 始终从 parsed 覆盖。"""
        row = self._make_row(change_key="old-key")
        parsed = self._make_parsed(change_key="new-key")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.change_key == "new-key"

    def test_location_always_overwritten(self):
        """location 始终从 parsed 覆盖。"""
        row = self._make_row(location="active")
        parsed = self._make_parsed(location="archive")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.location == "archive"

    def test_path_always_overwritten(self):
        """path 始终从 parsed 覆盖。"""
        row = self._make_row(path="old/path")
        parsed = self._make_parsed(path="new/path")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.path == "new/path"

    # --- status 不被覆盖 ---

    def test_status_not_overwritten(self):
        """status 不在 _apply_parsed 中处理，不受影响。"""
        row = self._make_row(status="active")
        parsed = self._make_parsed(status="draft")
        ChangeService._apply_parsed(row, parsed, workspace_id=row.workspace_id)
        assert row.status == "active"
```

### 步骤 2：运行测试确认失败

```bash
cd F:/WorkNew/SillyHub && python -m pytest backend/tests/modules/change/test_service.py::TestApplyParsed -x -v
```

预期：与覆盖策略相关的断言失败（`test_change_type_overwritten_when_db_is_none`、`test_affected_components_overwritten_when_parsed_has_value` 等），因为当前代码不写入 `change_type` 和 `affected_components`。

### 步骤 3：实现修改

按照"精确修改指令"中的步骤 1 修改 `_apply_parsed()` 方法。

### 步骤 4：运行测试确认通过

```bash
cd F:/WorkNew/SillyHub && python -m pytest backend/tests/modules/change/test_service.py::TestApplyParsed -x -v
```

预期：所有测试 PASS。

### 步骤 5：运行回归测试

```bash
cd F:/WorkNew/SillyHub && python -m pytest backend/tests/modules/change/ -x -v
```

预期：所有现有测试 PASS，不破坏已有功能。

## 参考

- **design.md 1.3 reparse 传播**："修改 `ChangeService._apply_parsed()`：允许 reparse 覆盖 `change_type` 和 `affected_components`"
- **design.md 兼容策略**："`_apply_parsed()` 保留已有 DB 值的逻辑：如果 parsed 值为 None/[]，不覆盖 DB 中已有的非空值"
- **design.md R-02**："reparse 覆盖 change_type 可能覆盖用户手动设置的值 → 只在 DB 值为 null 时覆盖，已有值不覆盖"
- **service.py:934-950**：`_apply_parsed()` 当前实现
- **service.py:693**：`_apply_parsed()` 的调用点（在 `reparse` 方法内）
- **parser.py:45-55**：`ParsedChange` dataclass 定义
- **model.py:168-172**：`Change` 模型的 `affected_components` 和 `change_type` 字段定义
