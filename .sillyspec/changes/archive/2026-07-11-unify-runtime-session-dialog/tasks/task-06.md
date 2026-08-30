---
id: task-06
title: 后端测试（软删断言 + list 软删过滤 + list title）
title_zh: 后端单测覆盖软删/过滤/title
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-003, D-006]
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_delete_active.py
  - backend/app/modules/daemon/tests/test_session_list.py
provides:
  - test: session_delete_soft_delete
  - test: list_filter_deleted_at
  - test: list_title
goal: >
  改 test_session_delete_active.py 断言为软删（行仍在 + deleted_at 非空 + agent_runs 外键未断），补 list 软删过滤用例与 list title 用例（首条 user_input 摘要）。
implementation:
  - backend/app/modules/daemon/tests/test_session_delete_active.py：原断言「会话行被删除 + agent_runs.agent_session_id 被断」改为「行仍在 + deleted_at 非空 + agent_runs.agent_session_id 未断」
  - 补 list 软删过滤用例：list_agent_sessions 与 list_change_sessions 不返回 deleted_at 非空的会话
  - 补 list title 用例：list_agent_sessions 返回首条 user_input 摘要前 30 字，无 user_input 时 title=null
  - 补 get 软删 404 用例：get_agent_session 对软删会话抛 DaemonSessionNotFound
acceptance:
  - test_session_delete_active.py 断言软删：行仍在 + deleted_at 非空 + agent_runs.agent_session_id 未断
  - list 软删过滤用例：list_agent_sessions / list_change_sessions 不返回软删项
  - list title 用例：list_agent_sessions 返回首条 user_input 摘要，无则 null
  - get 软删 404 用例通过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_delete_active.py -v
  - cd backend && uv run pytest app/modules/daemon/tests/ -k "session" -v
constraints:
  - 非测试逻辑本身有误时禁止改测试「通过」（CLAUDE.md 规则 8），本任务断言变化是因为被测行为确实改了（软删替代硬删）
  - 单测断言 agent_runs.agent_session_id 未断（验证 C-7 断外键代码确实被移除，对应 R-4）
  - 覆盖率 ≥60%（requirements 非功能需求）
---

## 验收标准
- test_session_delete_active.py 断言软删：行仍在 + deleted_at 非空 + agent_runs.agent_session_id 未断
- list 软删过滤用例：list_agent_sessions / list_change_sessions 不返回软删项
- list title 用例：list_agent_sessions 返回首条 user_input 摘要，无则 null
- get 软删 404 用例通过

## 验证步骤
- cd backend && uv run pytest app/modules/daemon/tests/test_session_delete_active.py -v
- cd backend && uv run pytest app/modules/daemon/tests/ -k "session" -v
