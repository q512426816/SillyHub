---
author: flow-machine-draft
created_at: 2026-10-22T02:18:51.962Z
---
# 需求规格（Requirements）— 2026-10-21-task-wakeup-event-queue

## 功能需求

### FR-01: 唤醒条目移出「排队消息」用户消息列表

- MessageQueueBar 必须以结构化标记 `entry.origin === "task_wakeup"` 判定唤醒通知条目（不看 prompt 内容前缀——对齐 2026-10-11-queue-wakeup-origin-guard 的结构化标记唯一真相口径），并将其移出「排队消息」用户消息 chip 列表：「排队消息（N）」的 N 必须只统计用户消息条目、满员判定（N/max）必须只统计用户消息条目（对齐后端 SESSION_QUEUE_MAX_PENDING 的唤醒豁免）、拖拽排序必须只作用于用户消息条目；用户消息条目的渲染与操作（拖拽/⚡/✎/✕）行为必须零变化。

#### 场景：混列分流

- Given 队列含 2 条用户消息与 1 条 origin='task_wakeup' 唤醒条目
- When MessageQueueBar 渲染
- Then 计数为「排队消息（2）」、chip 列表仅 2 条用户消息、唤醒条目不出现在 chip 列表

#### 场景：用户伪造前缀不误判

- Given 用户消息 prompt 以「[后台任务通知]」开头但 origin 为 null
- When 渲染
- Then 该条目仍按用户消息计数与渲染（既有 taskwakeup-hide 前缀剥离行为不变）

### FR-02: 唤醒条目事件行呈现（dsh turn-trigger 同款）

- 唤醒通知条目必须渲染为独立事件行：「✈ 收到任务消息（N 个后台任务已结束 · 本轮结束后自动继续）」，默认折叠、点击展开通知全文（剥「[后台任务通知]」前缀）；事件行禁止渲染任何操作按钮（✎ 编辑/⚡ 立即发送/✕ 删除）与拖拽手柄（通知不可操作，派发由本轮结束自动触发）；任务数 N 必须从通知正文按「- 任务「」行计数（解析失败兜底 1）；队列仅有唤醒条目而无用户消息时，「排队消息（N）」标签与 chip 行必须不渲染（事件行独立成行，不出现「排队消息」字样）。

#### 场景：事件行折叠与展开

- Given 唤醒通知正文含 4 个「- 任务「」行
- When 渲染事件行
- Then 折叠态显示「收到任务消息（4 个后台任务已结束 · 本轮结束后自动继续）」，点击后展开通知全文

#### 场景：纯唤醒队列

- Given 队列仅 1 条唤醒条目、无用户消息
- When 渲染
- Then 无「排队消息（」标签、无满员提示，仅事件行

### FR-03: 回归与类型门

- 变更后前端 tsc --noEmit 必须零错误；message-queue-bar 与 use-message-queue 既有测试套件必须全绿（既有用户消息断言零回归）+ 新增分流断言全绿。

#### 场景：回归

- When pnpm typecheck 与目标 vitest 套件执行
- Then tsc 零错、目标套件全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「唤醒条目移出排队列表——计数与 chip 分流」
FR-02: frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「事件行折叠展开与无操作按钮」「纯唤醒队列不渲染排队消息标签」
FR-03: frontend tsc --noEmit + message-queue-bar/use-message-queue 目标 vitest 套件（套件级门，无单用例）
