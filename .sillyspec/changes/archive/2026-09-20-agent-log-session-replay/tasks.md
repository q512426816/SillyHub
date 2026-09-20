---
author: qinyi
created_at: 2026-09-20 09:36:39
---
# 任务清单（Tasks）

- [x] task-01: zcode 解析器字段扩展（usage/turn_id/model/is_meta/turn_end + totalUsage，内层 snake_case 直通）(depends_on: —)
- [x] task-02: claude-code-jsonl 解析器（行过滤/段映射/usage 全量口径归一/isMeta/真人切轮）(depends_on: —)
- [x] task-03: cursor-agent-transcript 解析器（{role,message} 行 + turn_ended 切轮，usage 恒缺省）(depends_on: —)
- [x] task-04: db.sqlite token 可得性实证 + read-zcode-sqlite 透传（可得→透传/不可得→缺省，双分支测试）(depends_on: task-01)
- [x] task-05: registry 注册两新格式 + host-fs-handler 透传确认 + read-agent-log-messages 测试(depends_on: task-01, task-02, task-03)
- [x] task-06: backend schema（AgentLogUsage/totals/五新字段）+ router 外层 totalUsage→totals + 测试 + gen:types（worktree PYTHONPATH 坑）(depends_on: task-05)
- [x] task-07: 前端适配层 agent-log-replay.ts（系统事件→stderr 首项/双保险切轮/轮 token 求和/主子日志判定）+ 单测(depends_on: task-06)
- [x] task-08: 回放主体组件 agent-log-replay-body.tsx + 挂载点（page:3520 + dialog:1913）+ AgentLogSessionBody 移除 + 注释同步 + agent-log-card.test.tsx 用例组迁移/删除 + 组件 smoke 两分支(depends_on: task-07)
- [x] task-09: scoped 收口（daemon 5 文件 + backend 1 + 前端 3 组 + tsc 全绿，worktree git status 干净）(depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08)
