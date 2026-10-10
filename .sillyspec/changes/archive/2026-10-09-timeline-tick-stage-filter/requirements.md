---
author: flow-machine-draft
created_at: 2026-10-09T04:06:40.935Z
---
# 需求规格（Requirements）— 2026-10-09-timeline-tick-stage-filter

## 功能需求

### FR-01: _infer_task_times 跳过 detail 带非 tasks stage 前缀的 task-done 事件（对齐 CLI e.stage && e.stage !== 'tasks' 语义；无前缀裸形态仍参与推断）

- `_infer_task_times` 对 detail 为「非 tasks stage 前缀 · checked N→M」的 task-done 事件**必须**跳过（对齐 CLI `inferFlipTimes` 的 `e.stage && e.stage !== 'tasks'` 白名单语义）；detail 无 stage 前缀的裸「checked N→M」形态（stage 缺省）**必须**仍参与推断。

#### 场景：design 自审清单事件被跳过

- Given 事件流含「design · checked 0→6」（design.md 自审清单勾选，非任务勾选）与后续「tasks · checked 0→5」
- When 聚合变更时间线
- Then 任务勾选时刻只由 tasks 域事件推断，design 事件既不赋值也不推进游标

#### 场景：裸形态仍参与推断

- Given 事件流含无前缀「checked 0→2」（旧推送形态）
- When 聚合变更时间线
- Then 该事件照常参与游标衔接推断（既有金样本用例锁定的行为不变）

### FR-02: 回归用例钉住实证形态：design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2…，断言任务时刻不被 design 事件污染

- `test_timeline.py` **必须**新增回归用例，按 2026-10-09-workspace-init-skill-gate 实证事件序列（design · checked 0→6 → tasks · checked 0→5 → tasks · checked 1→2）构造事件流，断言任务时刻不出现 design 事件时刻；未修复代码上该用例**必须**失败（design 时刻被赋给全部任务）。

#### 场景：实证序列回归被拦

- Given 未修复代码（无非 tasks 过滤）
- When 运行该回归用例
- Then 断言失败（全部任务时刻 = design 事件时刻 02:00:48，且早于真实勾选时刻）

### FR-03: 既有 backend change timeline 测试面（test_timeline.py）全绿

- 改动落盘后，`backend/app/modules/change/tests/test_timeline.py` 全部既有用例**必须**保持全绿（金样本聚合/空事件容错/锚窗口收窄/git 降级/ChangeNotFound/token 边界/stage 前缀与游标断裂）。

#### 场景：主路径

- Given 改动已落盘
- When 只跑 `test_timeline.py`（规则 0：禁全量）
- Then 全部用例 pass

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_timeline.py「test_timeline_task_time_skips_non_tasks_stage」
FR-02: backend/app/modules/change/tests/test_timeline.py「test_timeline_task_time_skips_non_tasks_stage」+「test_timeline_task_time_stage_prefix_and_cursor_break」（裸形态/前缀形态既有锁定）
FR-03: backend/app/modules/change/tests/test_timeline.py 全文件既有用例
