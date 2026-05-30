---
id: task-06
title: "Spec Guardian G7 — 未解决 reject review 检查"
priority: P1
estimated_hours: 1.5
depends_on: [task-01]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/workflow/spec_guardian.py
  - backend/app/modules/workflow/tests/test_spec_guardian.py
---

# task-06: Spec Guardian G7 — 未解决 reject review 检查

## 修改文件（必填）
- `backend/app/modules/workflow/spec_guardian.py` — 新增 G7 检查
- `backend/app/modules/workflow/tests/test_spec_guardian.py` — 新增 G7 测试

## 实现要求

### G7 检查逻辑

在 `approved → in_progress` 转换中，检查该 Change 是否有未解决的 `reject` review。判断标准：
- 查询所有 `ChangeReview` 中 `verdict="reject"` 且 `change_id=change.id` 的记录
- 如果存在 reject review，需要检查后续是否有 approve review（即已被 rework 解决）
- 如果最后一条 review 是 reject，则阻止转换

```python
async def _check_no_unresolved_reject(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G7: approved → in_progress — no unresolved reject reviews."""
    violations: list[str] = []
    stmt = (
        select(ChangeReview)
        .where(col(ChangeReview.change_id) == change.id)
        .order_by(col(ChangeReview.created_at).desc())
    )
    reviews = list((await session.execute(stmt)).scalars().all())

    if not reviews:
        return violations  # 无 review，通过

    # 检查是否有未解决的 reject
    last_review = reviews[0]
    if last_review.verdict == "reject":
        violations.append(
            "Change has an unresolved reject review. Submit an approve review after rework."
        )
        return violations

    return violations
```

### 集成方式

修改 `check_change_ready_for_in_progress`，在检查 plan 存在之后追加 G7：

```python
async def check_change_ready_for_in_progress(
    session: AsyncSession, change: Change,
) -> list[str]:
    violations: list[str] = []
    stmt = select(ChangeDocument).where(...)
    doc = ...
    if doc is None:
        violations.append("Plan document is missing.")
    # G7: 未解决 reject review
    violations.extend(await _check_no_unresolved_reject(session, change))
    return violations
```

## 接口定义（代码类任务必填）

```python
# spec_guardian.py — 新增函数签名
async def _check_no_unresolved_reject(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G7: approved → in_progress — no unresolved reject reviews."""
```

需要在文件顶部新增 import：
```python
from app.modules.workflow.model import ChangeReview
```

## 边界处理（必填）
- 无任何 review 时，不阻止（G7 通过）
- 有 reject 但后续有 approve 时，通过（最后一条是 approve）
- 最后一条是 reject 时，阻止
- review 列表按 `created_at DESC` 排序，取第一条（最新的）
- `created_at` 可能为 None（不太可能，但 guard：None 排序在 SQLite 中行为不定，使用 `coalesce`）
- 同一用户多次 review：只看最后一条的 verdict
- Change 从未经过 review（直接从 reviewed → approved，无 ChangeReview 记录）时通过

## 非目标（本任务不做的事）
- 不修改 ChangeReview model
- 不修改 review 提交逻辑
- 不实现 "rework" 状态跟踪
- 不使用 AuditLog 判断 rework（直接看 ChangeReview 表）

## 参考
- ChangeReview model 定义在 `workflow/model.py:14`
- 审计日志查询是备选方案，但直接查 ChangeReview 更简单
- G7 定义在 design.md Guard Rules 表

## TDD 步骤
1. 编写 G7 测试：有未解决 reject → violation
2. 确认失败
3. 实现 `_check_no_unresolved_reject` + 集成
4. 编写边界测试：无 review → 通过、reject 后 approve → 通过
5. 运行全量测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 最后一条 review 是 reject | 返回 violation |
| AC-02 | 最后一条 review 是 approve | 通过 |
| AC-03 | 无任何 review | 通过 |
| AC-04 | reject 后 approve | 通过 |
| AC-05 | 多次 reject 后 approve | 通过 |
| AC-06 | 运行全量测试 | 通过 |
