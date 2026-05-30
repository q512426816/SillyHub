---
author: qinyi
created_at: 2026-05-30 16:45:00
id: task-01
title: "增强 markdown_builder — 新增 build_tasks_md、build_verification_md，增强 build_master_md"
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03, task-07]
allowed_paths:
  - backend/app/modules/change_writer/markdown_builder.py
  - backend/app/modules/change_writer/tests/test_markdown_builder.py
---

# Task-01: 增强 markdown_builder

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/markdown_builder.py` | 修改 | 新增 2 个 builder 函数，增强 build_master_md，更新 DOCUMENT_BUILDERS |
| `backend/app/modules/change_writer/tests/test_markdown_builder.py` | 修改 | 新增对应测试用例，更新已有断言 |

## 实现要求

### 1. 新增 build_tasks_md

函数签名：

```python
def build_tasks_md(*, title: str) -> str:
```

输出格式：

```markdown
# Tasks: {title}

## Wave 1

- [ ] task-01: ...
```

具体规则：
- 标题行 `# Tasks: {title}`
- 空行
- `## Wave 1` 小节标题
- 空行
- `- [ ] task-01: ...` 一个占位 checkbox 项
- 末尾空行

### 2. 新增 build_verification_md

函数签名：

```python
def build_verification_md(*, title: str) -> str:
```

输出格式：

```markdown
# Verification: {title}

## Acceptance Criteria

- [ ] criterion-1: ...
```

具体规则：
- 标题行 `# Verification: {title}`
- 空行
- `## Acceptance Criteria` 小节标题
- 空行
- `- [ ] criterion-1: ...` 一个占位 checkbox 项
- 末尾空行

### 3. 增强 build_master_md

在现有参数基础上新增两个 keyword-only 参数：

```python
def build_master_md(
    *,
    title: str,
    change_type: str | None = None,
    affected_components: list[str] | None = None,
    status: str = "draft",
    author: str | None = None,          # 新增
    change_key: str | None = None,      # 新增
) -> str:
```

新增输出位置（在 `# {title}` 和 `- **Status**:` 之间插入）：

```markdown
# {title}

- **Author**: {author}
- **Change Key**: {change_key}
- **Status**: {status}
...
```

具体规则：
- `author` 不为 None 时输出 `- **Author**: {author}`
- `change_key` 不为 None 时输出 `- **Change Key**: {change_key}`
- 两者均为 None 时不输出对应行（与现有 change_type/affected_components 的条件输出逻辑一致）
- 两行的位置在标题和 `- **Status**:` 之间（即 Status 之前）
- 已有参数行为不变，向后兼容

### 4. 更新 DOCUMENT_BUILDERS

在现有 dict 中注册两个新 key：

```python
DOCUMENT_BUILDERS: dict[str, callable] = {
    "proposal": build_proposal_md,
    "requirements": build_requirements_md,
    "design": build_design_md,
    "plan": build_plan_md,
    "tasks": build_tasks_md,              # 新增
    "verification": build_verification_md, # 新增
}
```

## 接口定义

### build_tasks_md

```python
def build_tasks_md(*, title: str) -> str:
    """生成 tasks.md 模板内容。

    Args:
        title: change 标题，直接拼入 "# Tasks: {title}" 行。

    Returns:
        完整 markdown 字符串，以换行符结尾。
    """
```

### build_verification_md

```python
def build_verification_md(*, title: str) -> str:
    """生成 verification.md 模板内容。

    Args:
        title: change 标题，直接拼入 "# Verification: {title}" 行。

    Returns:
        完整 markdown 字符串，以换行符结尾。
    """
```

### build_master_md（增强后完整签名）

```python
def build_master_md(
    *,
    title: str,
    change_type: str | None = None,
    affected_components: list[str] | None = None,
    status: str = "draft",
    author: str | None = None,
    change_key: str | None = None,
) -> str:
    """生成 master.md 模板内容。

    Args:
        title: change 标题。
        change_type: 可选，变更类型（如 refactor/feature/bugfix）。
        affected_components: 可选，受影响组件列表。
        status: 状态，默认 "draft"。
        author: 可选，作者名。不为 None 时输出 "- **Author**: {author}"。
        change_key: 可选，变更标识 key。不为 None 时输出 "- **Change Key**: {change_key}"。

    Returns:
        完整 markdown 字符串，以换行符结尾。
    """
```

## 边界处理

1. **title 为空字符串**：各函数不校验 title 内容，直接拼入。空字符串产出 `# Tasks: ` 这样的标题。这是合理行为，由调用方负责传入有效 title。
2. **author 和 change_key 均为 None**：build_master_md 输出与当前版本完全一致，不额外输出任何行。确保向后兼容。
3. **author 为空字符串**（`author=""`）：会输出 `- **Author**: `，因为 `"" is not None` 为 True。这是预期行为，空字符串也视为"有意提供"。
4. **DOCUMENT_BUILDERS dict 注册顺序**：新增的 "tasks" 和 "verification" 追加在 dict 末尾，不改变已有 key 的位置。
5. **已有测试不被破坏**：build_master_md 的所有已有调用签名（title + 可选 change_type/affected_components/status）保持不变。已有测试必须继续通过。
6. **字符串拼接安全**：title 直接用于 f-string，不做转义。所有 builder 均采用此策略，与现有实现一致。

## 非目标

- 不修改其他 builder 函数（build_proposal_md / build_requirements_md / build_design_md / build_plan_md）
- 不修改 schema.py、router.py、service.py
- 不涉及数据库操作
- 不处理 markdown 特殊字符转义（与现有实现保持一致）
- 不修改 DOCUMENT_BUILDERS 的类型签名（仍然是 `dict[str, callable]`）

## 参考

- design.md 文件变更清单第 1 行：`change_writer/markdown_builder.py` 修改
- plan.md Wave 1 task-01 描述
- 现有 `build_proposal_md` / `build_plan_md` 的实现模式作为新增函数的参照
- 现有 `build_master_md` 中 `change_type` / `affected_components` 的条件输出模式作为新参数的参照

## TDD 步骤

### Step 1: 写测试 — build_tasks_md

在 `test_markdown_builder.py` 新增：

```python
def test_tasks_md() -> None:
    result = build_tasks_md(title="Add auth")
    assert "# Tasks: Add auth" in result
    assert "## Wave 1" in result
    assert "- [ ] task-01: ..." in result
```

运行测试 → 失败（`ImportError: cannot import name 'build_tasks_md'`）

### Step 2: 实现 build_tasks_md

在 `markdown_builder.py` 新增函数，更新 `__all__`（如果有）或 import 列表。

运行测试 → 通过

### Step 3: 写测试 — build_verification_md

```python
def test_verification_md() -> None:
    result = build_verification_md(title="Add auth")
    assert "# Verification: Add auth" in result
    assert "## Acceptance Criteria" in result
    assert "- [ ] criterion-1: ..." in result
```

运行测试 → 失败

### Step 4: 实现 build_verification_md

运行测试 → 通过

### Step 5: 写测试 — build_master_md 增强

```python
def test_master_md_with_author_and_change_key() -> None:
    result = build_master_md(
        title="Add auth",
        author="qinyi",
        change_key="2026-05-30-add-auth",
    )
    assert "**Author**: qinyi" in result
    assert "**Change Key**: 2026-05-30-add-auth" in result
    # author/change_key 行出现在 Status 行之前
    status_pos = result.index("**Status**")
    author_pos = result.index("**Author**")
    assert author_pos < status_pos


def test_master_md_without_author_and_change_key() -> None:
    """不传 author/change_key 时，输出与旧版一致。"""
    result = build_master_md(title="Add auth")
    assert "**Author**" not in result
    assert "**Change Key**" not in result
```

运行测试 → 失败（build_master_md 不接受新参数）

### Step 6: 增强 build_master_md

在函数签名新增 author / change_key 参数，在 lines 构建逻辑中条件插入。

运行测试 → 通过

### Step 7: 写测试 — DOCUMENT_BUILDERS 注册

```python
def test_all_doc_types_have_builders() -> None:
    for dt in ("proposal", "requirements", "design", "plan", "tasks", "verification"):
        assert dt in DOCUMENT_BUILDERS
```

注意：此测试已存在，需更新期望集合，新增 "tasks" 和 "verification"。

运行测试 → 失败（dict 中还没有新 key）

### Step 8: 更新 DOCUMENT_BUILDERS

运行测试 → 通过

### Step 9: 全量回归

运行 `pytest backend/app/modules/change_writer/tests/test_markdown_builder.py -v`

确认所有测试通过（原有 + 新增）。

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过条件 |
|---|---|---|---|
| AC-1 | build_tasks_md 函数存在 | `from ... import build_tasks_md` | 不抛 ImportError |
| AC-2 | build_tasks_md 输出正确格式 | 调用 `build_tasks_md(title="X")` | 包含 `# Tasks: X`、`## Wave 1`、`- [ ] task-01: ...` |
| AC-3 | build_verification_md 函数存在 | `from ... import build_verification_md` | 不抛 ImportError |
| AC-4 | build_verification_md 输出正确格式 | 调用 `build_verification_md(title="X")` | 包含 `# Verification: X`、`## Acceptance Criteria`、`- [ ] criterion-1: ...` |
| AC-5 | build_master_md 接受 author 参数 | `build_master_md(title="X", author="qinyi")` | 不抛 TypeError |
| AC-6 | build_master_md 输出 author 行 | 传入 `author="qinyi"` | 输出包含 `- **Author**: qinyi` |
| AC-7 | build_master_md 输出 change_key 行 | 传入 `change_key="2026-05-30-x"` | 输出包含 `- **Change Key**: 2026-05-30-x` |
| AC-8 | author/change_key 为 None 时不输出 | 不传 author 和 change_key | 输出不含 `**Author**` 和 `**Change Key**` |
| AC-9 | author 行在 Status 行之前 | 传入 author + 检查位置 | author_pos < status_pos |
| AC-10 | DOCUMENT_BUILDERS 包含 tasks | `"tasks" in DOCUMENT_BUILDERS` | 为 True |
| AC-11 | DOCUMENT_BUILDERS 包含 verification | `"verification" in DOCUMENT_BUILDERS` | 为 True |
| AC-12 | 已有测试全部通过 | `pytest test_markdown_builder.py` | 0 failed |
| AC-13 | build_master_md 向后兼容 | `build_master_md(title="X")` 不传新参数 | 输出与旧版一致，无 author/change_key 行 |
