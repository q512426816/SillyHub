---
id: task-02
title: "datetime.utcnow → datetime.now(timezone.utc) 清理"
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-07]
allowed_paths:
  - backend/app/modules/workflow/service.py
  - backend/app/modules/workflow/model.py
  - backend/app/modules/change/model.py
  - backend/app/modules/task/model.py
---

# task-02: datetime.utcnow → datetime.now(timezone.utc) 清理

## 修改文件（必填）
- `backend/app/modules/workflow/service.py` — 3 处 `datetime.utcnow()`
- `backend/app/modules/workflow/model.py` — 2 处（ChangeReview.created_at, AuditLog.timestamp）
- `backend/app/modules/change/model.py` — 3 处（Change.created_at, Change.updated_at, Change.archived_at）
- `backend/app/modules/task/model.py` — 至少 2 处

## 实现要求

1. 在每个修改文件中添加 `from datetime import datetime, timezone`（如果还没有 `timezone`）
2. 全局替换 `datetime.utcnow()` → `datetime.now(timezone.utc)`
3. 对于 `default_factory=lambda: datetime.utcnow()` 模式，改为 `default_factory=lambda: datetime.now(timezone.utc)`
4. 对于直接调用 `datetime.utcnow()` 的模式，改为 `datetime.now(timezone.utc)`
5. 确保 import 语句中包含 `timezone`

## 接口定义（代码类任务必填）

**替换模式 A — model.py default_factory:**
```python
# Before:
from datetime import datetime
created_at: datetime = Field(
    default_factory=lambda: datetime.utcnow(),
    ...
)

# After:
from datetime import datetime, timezone
created_at: datetime = Field(
    default_factory=lambda: datetime.now(timezone.utc),
    ...
)
```

**替换模式 B — service.py 直接调用:**
```python
# Before:
change.updated_at = datetime.utcnow()

# After:
change.updated_at = datetime.now(timezone.utc)
```

## 边界处理（必填）
- `datetime.utcnow()` 返回 naive datetime，`datetime.now(timezone.utc)` 返回 aware datetime，对于 `DateTime(timezone=True)` 列类型是兼容的
- 不修改测试文件中的 `datetime.utcnow()` 调用（测试中 mock 或手动构造不需要时区感知）
- 不修改 migration 文件（已有 migration 中的时间戳格式不变）
- 替换只限于本变更的 `allowed_paths` 范围内的文件
- 确认所有修改文件的 `from datetime import` 行正确更新

## 非目标（本任务不做的事）
- 不修改其他模块（auth、workspace、git_identity 等）中的 `datetime.utcnow`
- 不修改迁移文件
- 不修改测试文件
- 不添加新功能

## 参考
- Python 3.12+ `datetime.utcnow()` 已标记为 deprecation warning
- `datetime.now(timezone.utc)` 是推荐替代方案

## TDD 步骤
1. `grep -rn "datetime.utcnow()" backend/app/modules/workflow/ backend/app/modules/change/model.py backend/app/modules/task/model.py` 统计替换点
2. 执行替换
3. 运行 `pytest backend/app/modules/workflow/tests/` 确认通过
4. 运行 `pytest backend/app/modules/change/tests/` 确认通过
5. 运行 `pytest backend/app/modules/task/tests/` 确认通过

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 在 allowed_paths 文件中 grep datetime.utcnow | 0 结果 |
| AC-02 | 在 allowed_paths 文件中 grep datetime.now(timezone.utc) | 所有原位置已替换 |
| AC-03 | 运行 workflow 测试 | 全部通过 |
| AC-04 | 运行 change 测试 | 全部通过 |
| AC-05 | 运行 task 测试 | 全部通过 |
| AC-06 | 运行全量测试 | 通过率不低于修改前 |
