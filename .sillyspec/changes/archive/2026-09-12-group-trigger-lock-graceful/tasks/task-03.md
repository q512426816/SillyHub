---
id: task-03
task_id: task-03
title: "新增 test_group_trigger_lock.py 三用例"
title_zh: "新增锁降级三用例"
status: pending
author: qinyi
created_at: 2026-09-12 22:20:00
goal: "超时→复用 / 超时→报忙+部分失败收集 / 任务行触发失败后存活性——monkeypatch 注入锁超时（SQLite 无真锁），覆盖修复两分支"
implementation: "monkeypatch 段2 FOR UPDATE 抛 DBAPIError（orig.sqlstate=55P03 模拟）；用例1 重读返回已回填指针→断言复用；用例2 指针空→断言 GroupChatInvalid 4xx+send_group_message 部分失败收集（200+成员 error+消息落库）；用例3 use_consensus+触发抛非 AppError→独立 session 重读任务行存在（G-4 rollback+refresh 手法）。"
target_files:
  - NEW:backend/app/modules/daemon/tests/test_group_trigger_lock.py
allowed_paths:
  - backend/app/modules/daemon/tests/test_group_trigger_lock.py
acceptance:
  - 三用例全绿（uv run pytest 通过）
  - mock 只注入锁超时事实，状态推进断言归真函数
verify: "uv run pytest -q --no-cov app/modules/daemon/tests/test_group_trigger_lock.py"
constraints: "测试结构照 test_group_consensus.py fixture 模式；不 mock 状态推进"
---
title_zh: "新增 test_group_trigger_lock.py 三用例"
goal: "超时→复用 / 超时→报忙+部分失败收集 / 任务行触发失败后存活性——monkeypatch 注入锁超时（SQLite 无真锁），覆盖修复两分支"
acceptance:
  - test_group_trigger_lock.py 三用例全绿（uv run pytest 通过）
  - mock 只注入锁超时事实，状态推进断言归真函数

# task-03: 新增 test_group_trigger_lock.py 三用例

## 要求

按 design §3：

1. **超时→复用**：monkeypatch `_ensure_shadow_session` 内段2 FOR UPDATE 语句抛 `sqlalchemy.exc.DBAPIError`（orig 带 sqlstate='55P03' 模拟），段3 无锁重读返回已回填指针的成员行 → 断言复用既有影子（返回 existing、不新建、不抛）。
2. **超时→报忙**：同上注入 + 指针仍空 → 断言 `GroupChatInvalid` 4xx；经 send_group_message 层断言部分失败收集（响应 200、该成员 triggered 项带 error、消息行落库）。
3. **任务行存活性**：use_consensus 消息 + 触发协程抛非 AppError → 独立 session 重读断言 `agent_group_consensus_tasks` 行存在（G-4 同款 rollback+refresh 手法）。

实现注意：
- SQLite 无真锁语义——锁超时异常用 monkeypatch/伪造异常注入，不依赖 PG。
- 用例结构照 test_group_consensus.py 既有 fixture 模式（群/成员/影子造数 helper）。
- mock 职责边界：注入点只覆盖「等锁超时」这一事实，不 mock 状态推进（推进断言归真函数路径）。

## 验收

- 三用例全绿；`uv run pytest -q --no-cov app/modules/daemon/tests/test_group_trigger_lock.py` 通过。
