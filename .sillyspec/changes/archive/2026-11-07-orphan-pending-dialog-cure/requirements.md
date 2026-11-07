---
author: flow-machine-draft
created_at: 2026-11-07T13:34:32.067Z
---
# 需求规格（Requirements）— 2026-11-07-orphan-pending-dialog-cure

## 功能需求

### FR-01: backend 收 daemon run 终态上报收尾路径（failed/killed/completed 等任一终态）联动将挂起 pending SessionDialogRequest 置 cancelled（复用既有 cancel_pending_dialogs_for_run，不新造语义）

- backend 在 run 终态化的每一条路径上，必须于同一事务内将该 run 名下 status='pending' 的 SessionDialogRequest 联动置 cancelled（复用既有 `cancel_pending_dialogs_for_run`）；路径覆盖：daemon 上报收口 close_interactive_run（completed/failed/killed 任一终态）与 backend 主动 kill（cancel_lease、end_session、会话删除收口）。run 终态化后禁止遗留 pending 提问行（孤儿问号的写侧源头）。
- 清理必须幂等：无挂起提问的 run 收口零副作用；UPDATE 限定 status='pending'，禁止覆盖已 answered/cancelled 的行；迟到二次上报（already_terminal no-op 分支）不再清理也不报错。

#### 场景：daemon 上报失败（生产主复现路径）

- Given 某 run 名下有一条 status='pending' 的 AskUserQuestion 提问行（agent 正在等用户回答）
- When daemon 因 turn_activity_timeout 等原因上报该 run 失败（close_interactive_run is_error=true）
- Then 收口事务提交后该提问行 status='cancelled'（问号源头消除）

#### 场景：daemon 上报完成（生产已有孤儿实证）

- Given 某 run 名下有一条 pending 提问行
- When daemon 上报该 run 成功（completed）
- Then 该提问行同样翻 cancelled（run 已终态、引擎不再等待，completed 路径与 failed 同为孤儿）

#### 场景：backend 主动 kill（cancel_lease / end_session / 会话删除）

- Given 活跃 run 名下有一条 pending 提问行
- When 用户取消 lease 或结束/删除会话（run 翻 killed）
- Then 同一事务内该提问行翻 cancelled

#### 场景：幂等与不覆盖

- Given run 收口时提问行已是 answered
- When 收口路径执行联动清理
- Then answered 行保持不变；重复收口不报错

### FR-02: 会话列表 pending_dialog_kind 注入与详情读侧口径对齐：仅统计 run 处于活跃态（pending/running/pending_approval）的 pending 行，run 终态的孤儿行不再点亮问号

- GET /api/daemon/sessions 的 pending_dialog_kind 注入必须仅统计其所属 run 处于活跃态（ACTIVE_RUN_STATUSES = pending/running/pending_approval）的 pending 行——subquery join AgentRun 过滤，且过滤必须作用于窗口函数取「每会话最新一条」之前；与详情读侧 list_pending_dialogs 的 ql-20260815-003 兜底口径完全一致。run 已终态的 pending 行（存量或漏网孤儿）必须不点亮列表问号。

#### 场景：孤儿行不注入

- Given 某 pending 提问行挂在一个 failed/completed/killed 的 run 上
- When 拉取会话列表
- Then 该会话 pending_dialog_kind=None（列表不再显示问号，与详情页「无待答卡」一致）

#### 场景：同会话多 pending 取活跃 run 的最新

- Given 同一会话有旧 pending 行（run 已终态）与新 pending 行（run running）
- When 拉取会话列表
- Then 注入新行的 dialog_kind（窗口函数在活跃行集合内取最新，不被死 run 的旧行占位）

### FR-03: daemon 轮活动看门狗对挂起 dialog 等待用户回答豁免：fire 时发现该会话有未 settle 的 dialog 请求则不判死改为续防重新布防，dialog settle 后下一活动点恢复常规看门狗语义

- daemon 轮活动看门狗 fireTurnActivityWatchdog 在双守卫（status=running 且 currentRunId 未变）通过后，必须再检查该会话 PermissionResolver 中是否存在未 settle 的 dialog 请求（dialogKind 非空）；存在则禁止判死（不 interrupt、不复位会话态、不上报失败），必须改为续防（按同窗口重新布防看门狗）后返回；豁免必须自查式（每个窗口到期复查），dialog settle 后引擎若无后续活动，续防看门狗到期时不再命中豁免、照常判死——禁止豁免变成永久盲区。
- 依据：permission-resolver.ts 既有语义「dialog 请求不启 5min 兜底、必须无限等待用户决策」——等待用户回答不是引擎卡死，看门狗（2026-11-04）与该语义矛盾，本 FR 消除矛盾。

#### 场景：豁免续防（生产主复现路径）

- Given 会话 run running 且 PermissionResolver 挂着一个未 settle 的 AskUserQuestion 请求
- When 看门狗窗口到期 fire
- Then 不 interrupt、会话态保持 running、deps.onTurnActivityTimeout 不被调用、看门狗按同窗口重新布防（续防）

#### 场景：豁免解除后恢复判死

- Given 挂起 dialog 已 settle（用户已答/已拒）且此后无任何轮内活动
- When 续防的看门狗到期 fire
- Then 无挂起 dialog 命中豁免，照常判死（interrupt + 复位 + 上报失败）——引擎拿到答案后挂死仍会被杀

#### 场景：无挂起 dialog 零回归

- Given run running、无任何挂起 dialog
- When 看门狗到期 fire
- Then 既有判死行为逐项不变（2026-11-04-turn-activity-watchdog 用例矩阵零回归）

### FR-04: 三点各配回归测试并通过；既有相关测试（dialog/watchdog/sessions list 域）零回归

- FR-01/FR-02 必须各配 backend pytest 回归用例、FR-03 必须配 daemon vitest 回归用例，且必须全部通过；既有 dialog / watchdog / sessions list / permission-resolver 域测试必须零回归（禁止为通过而修改无关既有断言）。

#### 场景：主路径

- Given 三点实现完成
- When 运行上述新增用例与域内既有用例
- Then 全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py「daemon 上报失败收口联动取消挂起提问」
FR-01: backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py「daemon 上报完成收口联动取消挂起提问」
FR-01: backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py「cancel_lease 主动 kill 联动取消挂起提问」
FR-01: backend/app/modules/daemon/tests/test_run_close_cancels_pending_dialog.py「answered 行不被联动清理覆盖」
FR-02: backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py「孤儿 pending 行（run 已终态）不注入问号」
FR-02: backend/app/modules/daemon/tests/test_sessions_list_pending_dialog.py「同会话死活并存取活跃 run 最新 pending」
FR-03: sillyhub-daemon/tests/interactive/turn-activity-watchdog.test.ts「挂起 dialog 豁免判死改为续防」
FR-03: sillyhub-daemon/tests/interactive/turn-activity-watchdog.test.ts「dialog settle 后豁免解除照常判死」
FR-04: 不适用：过程性约束，由 FR-01/02/03 的测试绑定行及其运行结果承载（域内既有用例全绿即证）
