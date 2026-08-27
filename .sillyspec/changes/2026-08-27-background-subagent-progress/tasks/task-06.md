---
id: task-06
author: qinyi
created_at: 2026-08-27 09:36:00
priority: P1
title: submit_messages 跨轮归位（LRU + 冷启动反查 + run_id 改写）
title_zh: submit_messages 跨轮归位（LRU + 冷启动反查 + run_id 改写）
depends_on: [task-05]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: attribution_behavior
    fields: [parent 行 run_id 归写派发 run, LRU 缓存, tool_call 行冷启动反查, 未命中保持现状]
expects_from: []
goal: |
  带 parent_tool_use_id 的日志行落库时归回派发 run，消除前端孤儿 stub（FR-05 / D-003@v1）。
implementation: |
  1. 进程级 LRU（functools.lru_cache 或手写 dict+容量，容量 1024）：key=(session_id, tool_use_id) → value=派发 run_id。写入路径：assistant tool_use flat 行落库时登记。
  2. submit_messages 落库循环内：行有 parent_tool_use_id 时查映射，未命中则查 agent_run_logs（channel=tool_call、同 session、content JSON 的 tool_use_id 匹配）取 run_id 回填缓存；仍命中失败 → 保持当前 run_id（兜底，log.debug）。
  3. [TASK_*] 行同样带 parent_tool_use_id，自动同路径归位。
  4. 不改 AgentRun/AgentSession 状态机；历史行不迁移（N4）。
acceptance: |
  同 session 第二个 run 期间到达的 parent 行落库 run_id=第一个 run（派发 run）；未命中路径不抛错；无 parent 行行为不变。
verify: |
  单测在 task-08；本任务跑 uv run pytest app/modules/daemon/tests/ -k submit（既有回归）。
constraints: |
  查询走既有索引（agent_run_logs tool_call 查询加 session 过滤避免全表）；LRU 容量防长会话膨胀；归位只改写入归因不改既有行。
---
