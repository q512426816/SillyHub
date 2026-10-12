---
author: flow-machine-draft
created_at: 2026-10-12T06:43:13.857Z
---
# 任务注册表（Tasks）— 2026-10-12-run-level-change-attribution

- [x] task-01: agent_sessions 新列 current_change_id（model.py + alembic 迁移 down_revision=c515ffd62859）；验证：迁移文件可被 alembic 加载、pytest 收集无错
- [ ] task-02: bind_session_to_change 返回变更 id + submit_commit 绑定循环后回写 session.current_change_id；验证：test_spec_binding.py 新用例绿
- [ ] task-03: inject 建轮 change_id=session.current_change_id；验证：test_inject_change_context.py 新用例绿
- [ ] task-04: usage_service 会话链接分支加 IS NULL 谓词 + docstring 口径更新；验证：test_usage_stats.py 新增拆分/独占/回归护栏用例绿
- [ ] task-05: 跑本变更全部相关测试（usage_stats + spec_binding + inject 新用例）全绿并按 pathspec 提交；验证：pytest 三处退出码 0
