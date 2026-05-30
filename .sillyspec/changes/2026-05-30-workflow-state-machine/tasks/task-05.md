---
id: task-05
title: "Spec Guardian G5 — 关联组件存在性检查"
priority: P1
estimated_hours: 1
depends_on: [task-01]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/workflow/spec_guardian.py
  - backend/app/modules/workflow/tests/test_spec_guardian.py
---

# task-05: Spec Guardian G5 — 关联组件存在性检查

## 修改文件（必填）
- `backend/app/modules/workflow/spec_guardian.py` — 新增 G5 检查
- `backend/app/modules/workflow/tests/test_spec_guardian.py` — 新增 G5 测试

## 实现要求

### G5 检查逻辑

在 `reviewed → approved` 转换中，如果 Change 的 `affected_components` 列表非空，验证每个 component 在 `Workspace` 表中存在对应的 `component_key`。

```python
async def _check_components_exist(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G5: reviewed → approved — all affected_components must exist as workspace component_keys."""
    violations: list[str] = []
    if not change.affected_components:
        return violations  # 空列表，无需检查

    from app.modules.workspace.model import Workspace
    for comp in change.affected_components:
        stmt = select(Workspace).where(
            col(Workspace.component_key) == comp,
            col(Workspace.deleted_at).is_(None),
        )
        ws = (await session.execute(stmt)).scalars().first()
        if ws is None:
            violations.append(
                f"Affected component '{comp}' does not exist as an active workspace."
            )
    return violations
```

### 集成方式

与 G4 相同，在 `check_change_ready_for_approved` 中追加：

```python
# G5: 组件存在性
violations.extend(await _check_components_exist(session, change))
```

## 接口定义（代码类任务必填）

```python
# spec_guardian.py — 新增函数签名
async def _check_components_exist(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G5: reviewed → approved — all affected_components must exist."""
```

需要在文件顶部新增 import：
```python
from app.modules.workspace.model import Workspace
```

## 边界处理（必填）
- `affected_components` 为空列表 `[]` 时，不执行检查，直接返回 `[]`（通过）
- `affected_components` 为 `None` 时（不应该，因为 model 定义了 `default_factory=list`），等同空列表处理
- 组件名大小写敏感（`component_key` 是精确匹配）
- 已删除的 workspace（`deleted_at IS NOT NULL`）不算存在
- 组件名包含特殊字符时正常比较（SQL 参数化，无注入风险）
- 多个组件不存在时，返回多条 violation

## 非目标（本任务不做的事）
- 不修改 Change model 的 `affected_components` 字段
- 不修改 Workspace model
- 不实现组件自动发现

## 参考
- Change model 的 `affected_components: list[str]` 定义在 `change/model.py:48`
- Workspace model 的 `component_key` 字段
- G5 定义在 design.md Guard Rules 表

## TDD 步骤
1. 编写 G5 测试：affected_components 含不存在的组件 → violation
2. 确认失败
3. 实现 `_check_components_exist` + 集成
4. 确认通过
5. 运行全量测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | affected_components 含不存在的组件 | 返回 violation |
| AC-02 | affected_components 全部存在 | 通过 |
| AC-03 | affected_components 为空列表 | 通过（不检查） |
| AC-04 | 部分组件不存在 | 返回对应条数的 violations |
| AC-05 | 已删除的 workspace 不算存在 | 返回 violation |
| AC-06 | 运行全量测试 | 通过 |
