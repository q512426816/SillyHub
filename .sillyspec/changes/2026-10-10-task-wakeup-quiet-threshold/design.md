---
author: flow-machine-draft
created_at: 2026-10-10T07:45:13.004Z
---
# 设计记录（Design Record）— 2026-10-10-task-wakeup-quiet-threshold

## 做法概述

问题根因（生产实证，阿里云会话 0d6b2ba9）：Claude Code 引擎的后台子代理终态每个都触发
daemon 唤醒注入（`scheduleTaskWakeup`），13 分钟灌 18 条「后台任务通知」——其中 17 条是
后台调研子代理内部派的秒级搜索步骤（孙任务），唯一的真长任务（12:50）才是唤醒机制原本
服务的对象；忙轮时这些通知还进排队栏与用户消息混排、挤占 5 条额度，队满时被静默丢弃。

方案（两点，都最小侵入）：

1. **daemon 唤醒门槛**：`handleTaskNotificationEvent` 在 completed/failed 唤醒分支前加
   时长判定——`elapsed_ms`（服务端权威）优先，缺失用注册表条目 `startedAt` 差值兜底，
   实际运行 < `TASK_WAKEUP_MIN_DURATION_MS`（60_000ms）直接 return 跳过
   `scheduleTaskWakeup`。60 秒的取值依据：实证噪音全部 ≤15s，真任务 770s，中间留一个
   数量级的安全带。门槛只拦「唤醒注入」，emit/落行/注销/清锚点全不动（终态簿记完整，
   主代理随时可 TaskOutput 自取短任务结果）。
2. **backend 队满豁免**：`queue.py` 满员检查把 `[后台任务通知]` 前缀条目从计数中剔除
   （用户额度只数用户自己的），且通知类注入自身豁免满员拒绝——它走既有
   ql-20260827-015 同条合并恒 ≤1 条 pending，无撑爆风险。

不做（FR-04 非目标）：孙任务判别（SDK task 事件无 depth/父 tool_use 稳定信号，需先
spike；门槛已把实证噪音全灭）、排队栏前端分开展示（门槛落地后频率骤降，纯展示优化
留待后续）。

## 接口契约

- daemon `interactive/session-manager/background-tasks.ts`：新增模块常量
  `TASK_WAKEUP_MIN_DURATION_MS = 60_000`（不导出，仅本模块消费）；
  `handleTaskNotificationEvent` 的 completed/failed 分支行为变化——不足 60s 不再调用
  `onTaskWakeupInject` 注入唤醒。对 SDK 事件形状、`[TASK_*]` 行格式、emit 事件、
  `scheduleTaskWakeup`/`registerAsyncReceiptTask`/`writeTaskLine` 签名均无变化。
- backend `daemon/session/service/queue.py`：`DaemonSessionQueueFull` 抛出条件变化——
  用户消息按「非通知类 pending 计数 ≥ 5」判定（原来数全部 pending）；`[后台任务通知]`
  前缀注入永不因满员被拒。对 router/API 形状、排队行 schema、合并逻辑无变化。
- 前端、CLI、MCP：零变更。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：时长判定只用当条 notification 自带的 elapsed_ms 或该任务注册条目的
   startedAt（task_started 恒先于 task_notification 到达，注册表在通知消费时才注销），
   不依赖跨事件排序；迟到很久的短任务通知（如 debounce 前的旧回执）按其真实时长判，
   短则静默——正是本变更要消灭的形态。重复 task_notification（SDK 重放）第一次已注销
   注册表，第二次 info 缺失、若无 elapsed_ms 则走双缺失分支照常唤醒——与旧行为一致
   （重复唤醒本就存在，不新增风险）。
2. 并发写：daemon 侧判定在 `handleTaskNotificationEvent` 单协程内，注册表
   `tasks.delete(taskId)` 已先于判定执行但局部变量 `info` 仍持有引用（startedAt 可读），
   无竞态；backend 满员检查与写行同锁内事务（既有结构不动，仅改计数谓词），豁免分支
   不写新行时走既有 merge 的行锁内更新，并发双通知仍收敛为一条。
3. 切换/生命周期：会话终态 `clearBackgroundTasks` 清注册表的既有语义不变——门槛不持有
   任何新状态；daemon 重启后孤儿终态（无注册条目）沿用「runId 缺失早退 / 双缺失
   fail-open」既有路径。interrupt 不清后台任务（既有语义），被 interrupt 的会话里短任务
   通知照旧静默、长任务照旧唤醒。
4. 作用域：门槛是 daemon 进程内模块常量，按会话独立判定，无跨会话/跨工作区共享状态；
   backend 豁免按 agent_session_id 维度的 pending 行过滤，不涉全局。多 daemon 实例对
   同一 backend 各自独立注入，merge 逻辑既有行锁保证不重复。

## 风险与死路

最大风险：60 秒门槛把「中等时长但有汇报价值」的后台任务（如 30-50s 的检查类任务）也
静默了。接受理由：主代理仍可 TaskOutput 主动取结果，终态行/emit 都在，信息不丢，只是
不再强迫打断；常量单点可调，后续按体验收紧/放宽是一行改动。次要风险：既有唤醒用例
夹具 20-21s 低于新门槛，需同步上调（行为规格变更的正常适配，已在 FR-03 声明，非躲败）。

试过但放弃的方案：①按 subagent_type/depth 判孙任务不冒泡——SDK task 事件
metadata 无层级信号（孙任务与主代理亲派任务同形），只能靠 `_agentToolUseMeta` 猜测，
误判面大，放弃（转 FR-04 留待 spike）；②把 debounce 2s 拉长到 15s+——只合并同时窗
口内的风暴，实证通知间隔 15-100s，合并不到一起，治标不治本；③前端把排队栏系统通知
折叠展示——不动噪音源头，纯遮羞，且门槛落地后队列里几乎不会再出现通知，收益消失。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | 新增 TASK_WAKEUP_MIN_DURATION_MS 常量 + handleTaskNotificationEvent 唤醒分支时长门槛 |
| 修改 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts | 新增 4 条门槛用例；既有合并用例 durationMs 夹具 20/21s→61/62s（00:20→01:01 断言同步） |
| 修改 | backend/app/modules/daemon/session/service/queue.py | 满员计数剔除 [后台任务通知] 前缀条目 + 通知类注入豁免满员拒绝 |
| 修改 | backend/app/modules/daemon/tests/test_session_queue.py | 新增 3 条豁免用例（不占额度/队满不丢/用户满员零回归） |
| 修改 | .sillyspec/docs/SillyHub/modules/daemon.md | 模块文档补唤醒门槛行为（同步文档义务） |
