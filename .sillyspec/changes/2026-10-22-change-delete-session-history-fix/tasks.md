---
author: zcode-agent
created_at: 2026-10-22T08:41:49.000Z
---
# 任务注册表（Tasks）— 2026-10-22-change-delete-session-history-fix

- [x] task-01: `AgentRun.change_id` FK 改为 `SET NULL` 并补语义注释——验证：模型外键断言测试红转绿
- [x] task-02: 新增 Alembic 迁移改写生产 FK（drop/create）+ 保守回填虚高 `turn_count`——验证：迁移图谱/单头测试绿，本地 upgrade/downgrade 可执行
- [x] task-03: reparse 删除环删除前显式解绑锚定 run + `detached_runs` 日志——验证：定向测试断言 run 保留且 `change_id IS NULL`
- [x] task-04: 回归测试锁定「删 change 不删 run/日志/计数」——验证：`pytest backend/app/modules/change/tests/test_reparse_delete_preserves_runs.py` 绿
- [x] task-05: 实现 `restore_lost_session_turns.py`（turn_id 分组、格式映射、确定性 id、dry-run/apply、幂等）——验证：脚本单测绿 + 生产 JSONL dry-run 输出 13 轮/571 段
- [x] task-06: 实现 `turn_count` 保守对账（仅下调虚高）并接入脚本/迁移——验证：对账单测绿（59→46 / tool_report 0 不变）
- [ ] task-07: 生产执行：备份会话数据→迁移→回灌 dry-run→apply→校验 59 轮与时间线——验证：SQL 计数、outline/时间线 API、回执落 change 目录
- [ ] task-08: 同步 agent/change/migrations 模块文档——验证：文档变更与实现一致
