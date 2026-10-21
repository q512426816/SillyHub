---
author: flow-machine-draft
created_at: 2026-10-21T02:49:06.356Z
---
# 需求规格（Requirements）— 2026-10-21-task-wakeup-restore

## 功能需求

### FR-01: 终态唤醒主路径（completed/failed → debounce 合并注入）

- task_notification 到达且 status 为 completed 或 failed 时，daemon 必须把该任务汇入同会话的唤醒 debounce 窗口，并在 2s 窗口到期后把一条合并汇总 prompt（含任务名、用时 mm:ss、≤300 字摘要、task_id 与 TaskOutput 自取指引、防漏报逐条核对指引）经 deps.onTaskWakeupInject 注入同会话；多条终态在同一窗口内到达时必须合并为一条注入（头部明示总数、尾部强制逐条核对）；onTaskWakeupInject 未注入（缺省）时必须静默跳过唤醒且不影响终态 emit/落行/注销等既有侧信道。

#### 场景：空闲会话单任务完成

- Given 会话内一个已注册后台任务（elapsed_ms=386176）经 task_notification(completed) 终态
- When handleTaskNotificationEvent 消费该事件且 onTaskWakeupInject 已接线
- Then 2s debounce 到期后 onTaskWakeupInject 被调用恰一次，prompt 以「[后台任务通知]」开头、含任务名/用时/摘要/逐条核对指引

#### 场景：多任务并发终态合并

- Given 同会话两个后台任务在 2s 窗口内先后 task_notification(completed)
- When 两条事件均被消费
- Then 仅注入一条 prompt，头部为「以下 2 个后台子代理任务已全部结束」，两条任务行齐备

### FR-02: 不注入面（短任务/stopped/非法终态；双缺失 fail-open）

- 实际运行时长（elapsed_ms 优先、注册条目 startedAt 差值兜底）小于静默阈值的 completed/failed 终态禁止触发唤醒注入；status 为 stopped 的终态禁止触发唤醒（用户/系统主动停止无需汇报）；elapsed_ms 与 startedAt 双缺失时必须 fail-open 照常进入唤醒判定（重启窗口孤儿终态不因缺数据而静默）；别名补发必须先于唤醒判定执行，短任务门槛的提前 return 禁止跳过别名补发。

#### 场景：短任务不唤醒

- Given 静默阈值 60000 且任务终态 elapsed_ms=5000
- When handleTaskNotificationEvent 消费
- Then onTaskWakeupInject 不被调用，终态 emit/[TASK_NOTIFICATION] 落行/注销照常

#### 场景：stopped 不唤醒

- Given 任务经 stopTask 主动停止产生 task_notification(stopped)
- When 消费该事件
- Then 不进入唤醒判定（不调用 onTaskWakeupInject）

#### 场景：双缺失 fail-open

- Given 终态帧无 elapsed_ms 且注册条目已不存在（无 startedAt）
- When status=completed
- Then 照常进入唤醒判定（不因时长未知而拦截）

### FR-03: 阈值进程级可配（env，缺省 60000，0=关闭）

- 静默阈值必须经环境变量 SILLYHUB_TASK_WAKEUP_QUIET_MS 进程级可配：缺省/非法值回落 60000；配置 0 时 completed/failed 一律不注入（总开关关闭阀）；负数按非法回落缺省；取值逐次读取（便于测试覆写），沿 SILLYHUB_INJECT_WAIT_SESSION_MS 同款 getter 形态。

#### 场景：阈值配置生效

- Given SILLYHUB_TASK_WAKEUP_QUIET_MS=120000 且任务终态 elapsed_ms=90000
- When 消费终态
- Then 不注入（90s < 120s 阈值）

#### 场景：0 关闭阀

- Given SILLYHUB_TASK_WAKEUP_QUIET_MS=0 且任务终态 elapsed_ms=386176
- When 消费终态
- Then 一律不注入

### FR-04: 影子任务路由隔离（pi 轮次聚合不触发唤醒）

- kind=agent_task_status 路由的事件（含 pi 每轮聚合的影子任务 running/completed）禁止进入唤醒判定；唤醒触发必须仅存在于 task_notification 事件处理器内，保证无后台任务概念的引擎（pi/codex/cursor）不存在「轮结束→注入→新轮」反馈环。

#### 场景：pi 轮次聚合零注入

- Given pi 会话一轮正常结束，驱动派生 agent_task_status(completed) 影子任务事件
- When 事件经 dispatchStatusEvent 路由
- Then 走 handleAgentTaskStatusEvent（仅 emit），onTaskWakeupInject 不被调用

### FR-05: 回归与类型门

- 恢复后 sillyhub-daemon 全量 vitest 必须绿（task-lifecycle 整组含翻回的唤醒断言）且 pnpm typecheck 零错误；既有「终态不注入唤醒」断言组必须翻回为唤醒注入断言并全部通过。

#### 场景：全量回归

- When pnpm test 与 pnpm typecheck 在 sillyhub-daemon 执行
- Then 全部用例通过且 tsc 零错

### FR-06: 唤醒轮前端留痕（「收到任务消息」折叠行，执行期用户追加——dsh 同款形态）

- 唤醒注入开轮的 user_input 在会话时间线必须留痕为 task_wakeup 段（「收到任务消息」折叠行：默认收起、点击展开通知全文、标题带任务数计数），对话视图与进度（全部）视图都必须渲染；2026-10-13-session-taskwakeup-hide 的整体隐藏口径必须废止（隐藏导致唤醒轮「无人说话 agent 凭空接话」不可溯源）；普通轮与非开轮的系统行禁止产出 task_wakeup 段（中途系统行仍静默跳过）。

#### 场景：回放路径

- Given 历史日志中「[后台任务通知]」user_input 开轮 + 后续 agent 输出
- When logsToTurns 装配
- Then 轮 prompt 为空、段序列首部为 task_wakeup 段（text 含通知全文）、无 preamble 段

#### 场景：渲染形态

- When SegmentView 分发 task_wakeup 段
- Then 默认收起显示「收到任务消息（N 个后台任务已结束）」，点击展开显示通知全文

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task 终态注入唤醒——单任务汇总 prompt」
FR-02: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「短任务低于阈值不注入」「stopped 终态不注入」「双缺失 fail-open 放行唤醒」
FR-03: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「阈值 env 可配与 0 关闭阀」
FR-04: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「影子任务 agent_task_status 路由不触发唤醒」
FR-05: sillyhub-daemon 全量 vitest + pnpm typecheck（套件级门，无单用例）
FR-06: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「唤醒注入开轮 → task_wakeup 段置于段序列首部」+ frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「默认收起：显示「收到任务消息」」
