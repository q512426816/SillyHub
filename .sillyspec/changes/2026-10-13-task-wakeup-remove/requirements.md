---
author: flow-machine-draft
created_at: 2026-10-13T04:04:16.999Z
---
# 需求规格（Requirements）— 2026-10-13-task-wakeup-remove

## 功能需求

### FR-01: daemon（sillyhub-daemon）任务终态 completed/failed/stopped 一律不再注入唤醒——onTaskWakeupInject 永不被调用，不再产生任何「[后台任务通知]」user_input

- 后台任务终态必须不触发任何唤醒注入：`handleTaskNotificationEvent` 的 completed/failed 唤醒分支（含 60s 安静阈值判定）必须整体移除；禁止再有任何代码路径产生「[后台任务通知]」前缀的 user 消息。产品裁定（用户 2026-10-13）：终态自动汇报轮没必要——任务结果留在会话日志与任务面板，主代理靠用户下一条消息继续（prompt 已注明可用 TaskOutput block=false 自取，2026-10-10 安静阈值已在生产验证该口径）。

#### 场景：长任务终态

- Given：已注册后台任务收到 task_notification（completed/failed，elapsed_ms 61s）；
- When：daemon 消费该事件（含 2s debounce 窗口推进）；
- Then：onTaskWakeupInject 不被调用，无任何新 turn 注入。

#### 场景：孤儿终态（原 fail-open 唤醒路径）

- Given：daemon 重启窗口形态——task_started 丢失、注册表无条目、无 elapsed_ms；
- When：task_notification（completed）到达；
- Then：同样不唤醒（原 fail-open 放行口径随机制一并移除），emit/落行按既有兜底链照常。

### FR-02: 终态侧信道不受影响：agent_task_status 终态 emit、[TASK_NOTIFICATION] 落行、任务表注销（含 tool_use 别名收口）、注册表清空清后台锚点均照常

- 移除必须只动唤醒链：终态 agent_task_status 事件 emit、[TASK_NOTIFICATION] transcript 落行（不节流）、任务表注销、tool_use 别名条目注销/补发（2026-10-13-agent-task-stuck-running FR-01）、注册表清空清 state.currentRunId 后台锚点（2026-09-15-background-task-permission-lockout FR-01）——以上行为必须与改前一致。

#### 场景：终态侧信道回归

- Given：注册任务收到 completed 通知（elapsed_ms 2s）；
- When：daemon 消费；
- Then：终态 emit 到达、[TASK_NOTIFICATION] 行含 task_id/status、注册表条目注销——与改前一致，仅无唤醒。

### FR-03: 唤醒机制代码彻底移除：scheduleTaskWakeup/_taskWakeupPending/TASK_WAKEUP_MIN_DURATION_MS/onTaskWakeupInject dep 及 cli.ts wiring、lifecycle.ts 清理、SessionManagerCore 接口面

- 唤醒机制的代码必须彻底删除（非注释停用）：background-tasks.ts 的 scheduleTaskWakeup 函数与 TASK_WAKEUP_MIN_DURATION_MS 常量、session-manager.ts 的 _scheduleTaskWakeup 私有方法与 _taskWakeupPending 字段、session-manager/types.ts 的接口声明、interactive/types.ts 的 onTaskWakeupInject dep、cli.ts 的 wiring、lifecycle.ts 的 pending 清理块；关联注释（模块头/函数头）必须同步修正（规则 18）。

#### 场景：接口面清零

- Given：本变更合入后；
- When：全仓 grep scheduleTaskWakeup/_taskWakeupPending/onTaskWakeupInject/TASK_WAKEUP_MIN_DURATION_MS；
- Then：sillyhub-daemon/src 与 tests 仅剩新口径测试的历史注释引用（或零命中），无存活实现/类型/接线。

### FR-04: backend inject 端点与排队合并/豁免机制保留不动（无生产者后为休眠代码）；前端历史会话回放的隐藏逻辑（2026-10-13-session-taskwakeup-hide）保留

- 本变更必须只动 daemon 生产者侧：backend 的 inject 端点（origin='task_wakeup' 门控）、排队合并/豁免机制（helpers.py/queue.py）必须保留不动（休眠防御代码，历史会话回放亦可能含旧通知）；前端对历史日志中「[后台任务通知]」的显示隐藏逻辑必须保留（老会话回放仍干净）。前端/backend 禁止出现仅因本变更而生的联动改动。

#### 场景：休眠机制不动

- Given：本变更 diff；
- When：检查 backend/app 与 frontend/src；
- Then：零文件改动。

### FR-05: sillyhub-daemon 相关单测改写为新口径并通过 + pnpm typecheck 绿

- task-lifecycle.test.ts 的「task wakeup inject」describe（7 用例：合并注入/短任务不唤醒/长任务唤醒/startedAt 兜底/fail-open/stopped 不唤醒/未注入回调不抛错）必须改写为新口径（终态一律不注入唤醒；侧信道断言保留），禁止留旧口径用例；sillyhub-daemon 全测试目录与 pnpm typecheck 必须通过（daemon 子项目全量即可——其测试面即本变更触达面，主仓/前端零改动不跑）。

#### 场景：验收

- Given：代码与测试改写完成；
- When：cd sillyhub-daemon && pnpm test && pnpm typecheck；
- Then：全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「终态一律不注入唤醒——completed/failed/stopped 全形态 onTaskWakeupInject 零调用（含 2s debounce 推进与孤儿终态）」
FR-02: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「终态侧信道照常——emit/[TASK_NOTIFICATION] 落行/注销不因移除唤醒而变」
FR-03: 不适用：代码移除面由 FR-01/FR-05 的测试与 typecheck 承载（接口/字段删除的编译面由 pnpm typecheck 全量覆盖，grep 清零属评审检查面）。
FR-04: 不适用：零改动面（diff 即证明，backend/frontend 无测试需跑）。
FR-05: test/sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task wakeup inject（终态自动唤醒主代理）」改写后的整组 + sillyhub-daemon 全测试目录回归
