---
author: flow-machine-draft
created_at: 2026-10-09T04:06:40.935Z
---
# 提案书（Proposal）— 2026-10-09-timeline-tick-stage-filter

## 动机

任务原话转写：变更详情「真实留痕时间线」任务勾选时刻全列表同秒且早于 tasks.md 诞生（2026-10-09-workspace-init-skill-gate 实证：五任务全部 ≈10:00:48，而 tasks.md 10:05:46 才出现）。根因：watcher 对任何文件的 - [x] 计数增加都发 task-done 事件（detail 带文件所属 stage 前缀），design.md 自审清单 6 勾产生「design · checked 0→6」；CLI 侧 inferFlipTimes（sillyspec 仓 timeline.js）有 stage 白名单跳过非 tasks 事件，平台 Python 移植 backend timeline.py _infer_task_times 丢了该过滤——误吃 design 事件把 10:00:48 赋给全部任务，且游标跳到 6 致后续真实「tasks · checked 0→5」断裂。

成功标准：
- _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）
- 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染
- 既有 backend change timeline 测试面（test_timeline.py）全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）
2. 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染
3. 既有 backend change timeline 测试面（test_timeline.py）全绿

## 成功标准（可验证）

1. _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）
2. 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染
3. 既有 backend change timeline 测试面（test_timeline.py）全绿
