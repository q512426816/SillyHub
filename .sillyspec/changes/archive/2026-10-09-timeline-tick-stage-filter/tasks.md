---
author: flow-machine-draft
created_at: 2026-10-09T04:06:40.936Z
---
# 任务注册表（Tasks）— 2026-10-09-timeline-tick-stage-filter

- [x] task-01: _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）
- [x] task-02: 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染
- [x] task-03: 既有 backend change timeline 测试面（test_timeline.py）全绿
