---
id: task-01
title: 修复 test_change_transition_draft_to_proposed 失败
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03, task-05, task-06]
allowed_paths:
  - backend/app/modules/workflow/tests/test_router.py
  - backend/conftest.py
---

# task-01: 修复 test_change_transition_draft_to_proposed 失败

## 修改文件（必填）
- `backend/app/modules/workflow/tests/test_router.py` — 修复测试 setup

## 问题分析

测试 `test_change_transition_draft_to_proposed` 在 CI 中失败。根因是 SQLite 外键约束：`_setup()` 创建 Workspace 和 Change 时，Change 的 `workspace_id` 外键引用 Workspace，但在内存 SQLite 中外键默认未启用或 commit 时序不对。

查看 `_setup()` 方法：先 `session.add(ws)` + `session.add(change)` + `session.add(user)`，然后 `await db_session.commit()`。问题可能在于：
1. SQLite 内存库外键约束默认关闭
2. Workspace 的 `root_path="/tmp/test"` 可不满足 Workspace model 的其他约束

## 实现要求

1. 检查 `conftest.py` 中 SQLite engine 创建时是否启用了外键（`PRAGMA foreign_keys=ON`）
2. 在 `conftest.py` 的 `db_engine` fixture 中，在 `create_all` 后执行 `PRAGMA foreign_keys=ON`
3. 验证 `_setup()` 中所有外键引用的对象在 commit 前已正确添加到 session
4. 如果问题在 `_setup()` 的 commit 时序，确保所有依赖对象一起 commit

## 接口定义（代码类任务必填）

```python
# backend/conftest.py — db_engine fixture 修改
engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
async with engine.begin() as conn:
    await conn.execute(text("PRAGMA foreign_keys=ON"))  # 新增
    await conn.run_sync(BaseModel.metadata.create_all)
```

注意：需要 `from sqlalchemy import text`。

## 边界处理（必填）
- SQLite 内存库不支持所有 PostgreSQL 特性，外键需显式启用
- `PRAGMA foreign_keys=ON` 必须在每个连接上执行，不能只执行一次
- 测试中所有外键引用的对象必须存在于同一事务中
- 修复不能影响其他已有测试（特别是不使用外键的测试）
- 修复后确认 `test_change_transition_draft_to_proposed` 单独运行和全量运行都通过

## 非目标（本任务不做的事）
- 不修改生产数据库配置
- 不修改 model 定义
- 不添加新测试

## 参考
- SQLAlchemy SQLite 外键文档：`Connectable events` 或 `PRAGMA foreign_keys`
- 现有 conftest.py 使用 `sqlite+aiosqlite:///:memory:`

## TDD 步骤
1. 运行 `pytest backend/app/modules/workflow/tests/test_router.py::test_change_transition_draft_to_proposed -x` 确认失败
2. 修改 conftest.py 添加 PRAGMA foreign_keys
3. 如需修改 test_router.py 的 `_setup()` 方法
4. 再次运行确认通过
5. 运行全量 workflow 测试确认回归通过

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 单独运行 test_change_transition_draft_to_proposed | 通过 |
| AC-02 | 运行 test_router.py 全部测试 | 全部通过 |
| AC-03 | 运行 workflow/tests/ 全部测试 | 全部通过 |
| AC-04 | 运行全量 pytest（不超时） | 通过率不低于修改前 |
