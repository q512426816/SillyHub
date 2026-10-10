---
author: flow-machine-draft
created_at: 2026-10-10T07:45:13.004Z
---
# 需求规格（Requirements）— 2026-10-10-task-wakeup-quiet-threshold

## 功能需求

### FR-01: daemon 唤醒加最短时长门槛：任务实际运行不足 60 秒不注入唤醒（emit/落行/注销语义不变），elapsed_ms 缺失时用注册表 startedAt 兜底计算，两者都缺时保持原唤醒行为

daemon 必须在任务终态唤醒（`scheduleTaskWakeup`）前判定任务实际运行时长：时长来源优先取
task_notification 事件 metadata 的 `elapsed_ms`（服务端权威值），缺失时用后台任务注册表
条目的 `startedAt` 差值兜底；实际运行不足 `TASK_WAKEUP_MIN_DURATION_MS`（60 秒）的
completed/failed 任务必须跳过唤醒注入。时长判定只作用于唤醒注入——终态 emit、
`[TASK_NOTIFICATION]` 落行、任务表注销、末任务清后台锚点等既有语义必须保持不变。
elapsed_ms 与注册表条目两者都缺失（时长无从判定）时必须保持原行为（照常唤醒）。

#### 场景：短任务静默

- Given：会话注册了后台任务 A（task_started），主代理空闲等待
- When：A 的 task_notification 到达，metadata 带 `elapsed_ms: 2000`（或缺失但注册表
  startedAt 距今 2 秒）
- Then：终态 emit 与 `[TASK_NOTIFICATION]` 行照常发生、任务表注销照常，但 2s debounce
  窗口后 `onTaskWakeupInject` 不被调用（无「后台任务通知」注入）

#### 场景：长任务照常唤醒

- Given：会话注册了后台任务 B（task_started）
- When：B 的 task_notification 到达，metadata 带 `elapsed_ms: 61000`
- Then：既有唤醒链路完整发生（debounce 合并 → prompt 注入，prompt 含任务名/用时/摘要）

#### 场景：时长无从判定保持原行为

- Given：会话有活跃轮（currentRunId 在），但任务表无该 task_id 条目（如 daemon 重启窗口）
- When：该任务的 task_notification 到达（无 elapsed_ms、无 startedAt 可用）
- Then：不因时长门槛吞掉唤醒——照旧走 scheduleTaskWakeup（fail-open 保留原语义）

### FR-02: backend 排队满员检查不再把 [后台任务通知] 系统通知计入用户 5 条额度：队满时用户消息照常入队判断不受通知挤占，系统通知队满也不被丢弃（仍走既有同条合并）

backend 排队满员检查（`SESSION_QUEUE_MAX_PENDING`）必须把 prompt 以
`[后台任务通知]` 开头的系统通知条目排除在用户额度计数之外：用户消息的满员判断只统计
非通知类 pending 条目；系统通知自身的入队/合并必须豁免满员拒绝（它走既有
ql-20260827-015 同条合并，恒 ≤1 条 pending，不会撑爆队列）。普通用户消息满员时仍必须
照旧抛 `DaemonSessionQueueFull`（用户侧语义零变化）。

#### 场景：通知不占用户额度

- Given：忙轮会话，队列里已有 1 条 pending 的 [后台任务通知] + 4 条用户消息（合计 5 行）
- When：用户再发第 5 条用户消息（queue_when_busy=True）
- Then：不抛 DaemonSessionQueueFull——用户额度只数自己的 4 条，第 5 条正常入队

#### 场景：队满时通知不被丢弃

- Given：忙轮会话，队列已有 5 条 pending 用户消息（旧口径下满员）
- When：daemon 注入一条 [后台任务通知]（queue_when_busy=True）
- Then：不抛 DaemonSessionQueueFull——系统通知正常入队（无既有通知条目时新建行，
  有则并入既有条目改写计数），不再出现「task wakeup inject failed」静默丢通知

#### 场景：用户满员语义零回归

- Given：忙轮会话，队列已有 5 条 pending 用户消息（不含通知）
- When：用户再发第 6 条用户消息
- Then：照旧抛 DaemonSessionQueueFull（本变更不放宽用户侧上限）

### FR-03: daemon 与 backend 各有针对性测试覆盖新行为，仅跑修改相关测试，全量留给 CI

本变更必须为 FR-01/FR-02 各补针对性测试（daemon vitest + backend pytest），覆盖：短任务
不唤醒、长任务唤醒、startedAt 兜底、双缺失保持唤醒、通知不占额度、队满通知不丢、用户
满员零回归。已有一个既有唤醒用例的 durationMs 夹具（20-21 秒）必须同步上调至门槛之上
（行为规格变更的正常适配，非改测试躲败）。执行时仅跑修改相关的测试文件，禁止跑全量
（全量留给 CI）。

#### 场景：测试绑定可追溯

- Given：FR-01/FR-02 行为已实现
- When：跑下方「测试绑定」列出的用例
- Then：全部通过，且其中含针对新门槛/豁免的正反两向断言

### FR-04: 孙任务不冒泡（缺可靠 SDK 信号需 spike）与排队栏前端分开展示（纯展示优化）本变更不做，留待后续

本变更禁止扩大范围到以下两项（显式非目标）：①孙任务（后台子代理内部再派的后台任务）不
向主会话冒泡——task 事件流缺可靠的层级信号（无 depth/父 tool_use 可稳定判别孙任务），
需先 spike SDK 事件形状，本变更不做；②排队栏前端把系统通知与用户消息分开展示——FR-01
门槛落地后通知频率大幅下降，纯展示优化收益有限，留待后续按实际体验决定。

#### 场景：非目标边界

- Given：本变更合入
- When：检查 daemon/backend/frontend diff
- Then：不含孙任务判别逻辑、不含排队栏 UI 改动（frontend 零文件变更）

## 测试绑定

- FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「短任务不唤醒（elapsed_ms 2s）」
- FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「长任务照常唤醒（elapsed_ms 61s）」
- FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「elapsed_ms 缺失用 startedAt 兜底判时长」
- FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「时长无从判定（无 elapsed 无注册条目）保持唤醒」
- FR-02: backend/app/modules/daemon/tests/test_session_queue.py「通知不占用户 5 条额度」
- FR-02: backend/app/modules/daemon/tests/test_session_queue.py「队满时系统通知不丢（入队成功）」
- FR-02: backend/app/modules/daemon/tests/test_session_queue.py「用户满员语义零回归」
- FR-03: 上述七条用例的集合即为本变更测试面（跑修改相关文件，不跑全量）
- FR-04: 无测试绑定（非目标条目，由 diff 范围审查守护——frontend 零变更）
