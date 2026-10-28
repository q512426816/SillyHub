---
author: flow-machine-draft
created_at: 2026-10-28T05:47:18.650Z
---
# 需求规格（Requirements）— 2026-10-28-change-usage-attribution-window

## 功能需求

### FR-01: linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入

- 变更执行用量的会话链接分支**必须**只认领 `run.started_at >= 该 (change, session) link 行 created_at` 的无锚 run；`started_at IS NULL` 的 run 必须放行计入（时间缺失不丢存量数）。

#### 场景：绑定前历史轮排除

- Given：会话 08:00 跑过历史无锚轮（input=900）、09:00 建立 link、10:00 又跑无锚轮（input=100）
- When：查询该变更执行用量
- Then：totals.input_tokens 必须等于 100（历史轮排除、绑定后轮计入）

### FR-02: linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入

- linked 分支**必须**排除 `run.started_at > change.archived_at`（归档时刻非空时）的无锚 run；变更未归档（archived_at NULL）时禁止设上界。

#### 场景：归档后无锚轮排除

- Given：变更 10:30 归档（archived_at 有值），会话 10:00 与 10:45 各跑一条无锚轮
- When：查询变更执行用量
- Then：只计 10:00 轮，10:45 轮必须排除

### FR-03: 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计

- 同会话存在其它变更的更新 link（晚于本 link 且不晚于轮开始）时，该轮**必须**排除出本变更的 linked 分支（归「轮时刻最近绑定的变更」）。

#### 场景：X 后切 Y 的无锚轮归属

- Given：会话 09:00 link 变更 X、10:30 link 变更 Y；无锚轮 r1=10:00、r2=11:00
- When：分别查询 X 与 Y 的执行用量
- Then：X 只得 r1、Y 只得 r2（X 即使未归档也禁止计入 r2）

### FR-04: 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计

- 多会话绑定同一变更时，linked 分支**必须**按每对 (change, session) 的 link.created_at 独立判定窗口，晚会话绑定的早期轮必须排除。

#### 场景：两会话错峰绑定

- Given：会话 A 09:00 绑定、会话 B 10:30 绑定；A 的 10:00 轮 input=100、B 的 10:00 轮 input=200、B 的 10:45 轮 input=50
- When：查询变更用量
- Then：input 总和必须等于 150（B 的 10:00 轮在其窗口外）

### FR-05: dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run

- dispatched 分支（run.change_id 直锚）**必须**排除归档时刻之后开始的 run；对 run 时间早于变更创建时刻的打锚 run（backfill 存量回填语义）禁止设下界排除。

#### 场景：归档后打锚轮排除 + backfill 保留

- Given：变更 10:30 归档；打锚轮 r1=10:00（input=100）、r2=10:45（input=500）
- When：查询变更用量
- Then：只计 r1；r2 必须排除

### FR-06: 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更

- 命令解析对 `sillyspec flow done --change X` 与 `sillyspec run archive --change X` **必须**产出 terminal=True 标记，submit 通道据此**必须**把会话 current_change_id 置 NULL（非终态绑定命令维持游走覆盖语义）；`bind_session_to_change` 新插 link 的 created_at **必须**取 effective_from（run_sync 通道传本轮 run.started_at）。

#### 场景：两族终态命令解析与清锚

- Given：会话 current_change_id 指向变更 X
- When：会话内执行 `sillyspec flow done --change X`（或 `sillyspec run archive --change X`）
- Then：解析产出 terminal=True，current_change_id 必须被清为 NULL，后续轮 run.change_id 为 NULL

### FR-07: 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值

- 时间窗全部在聚合 SQL 侧实现，**禁止**要求对 agent_runs / change_session_links 做任何数据修正；部署后存量变更的用量显示必须按窗口自动回落。

#### 场景：存量自愈

- Given：生产存量数据里新变更 link 到早前长会话（历史无锚轮早于 link 时刻）
- When：部署本变更后打开该变更详情
- Then：历史轮必须被窗口排除，显示回落至真实执行量，数据库必须零改动

### FR-08: 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破

- 新增 TestAttributionWindow 七用例与 spec_binding 解析/bind 用例**必须**全部通过；既有 usage_stats / enrich_projection / inject / backfill / platform_sync 归因测试**必须**回归通过（ruff 0 error）。

#### 场景：全量相关面回归

- Given：本变更全部改动落盘
- When：运行 change/daemon/platform_sync 相关测试面与 ruff
- Then：全部通过、0 lint error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_history_runs_before_link_excluded」
FR-02: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_archived_upper_bound_linked」
FR-03: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_recent_binding_wins_no_double_count」
FR-04: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_multi_session_independent_windows」
FR-05: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_archived_upper_bound_dispatched」
FR-06: test/backend/app/modules/change/tests/test_spec_binding.py「test_extract_spec_bindings_terminal_flag」+「test_bind_change_effective_from_sets_link_created_at」
FR-07: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow::test_summary_anchor_same_window_as_detail」（窗口纯 SQL 聚合侧、无数据修正路径的结构性验证；存量生产数据自愈为部署后观察项）
FR-08: test/backend/app/modules/change/tests/test_usage_stats.py「TestAttributionWindow（全类 7 用例）」+ 既有回归 191 passed / ruff 0 error
