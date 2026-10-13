---
author: flow-machine-draft
created_at: 2026-10-13T03:20:05.999Z
---
# 设计记录（Design Record）— 2026-10-13-session-taskwakeup-hide

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在数据生成侧（而非渲染侧）拦截：preamble 段全仓只有两个生成点——回放路径 `logsToTurns`（runtime-session-helpers.tsx）与实时 SSE 路径的 `upsertTurn` 闭包（session-panel-page.tsx），在两处对「[后台任务通知]」前缀注入跳过建段，进度视图的「上下文注入（N 字，已随消息发送）」卡随之消失（该文案对纯系统通知本就不符）；消息队列条则在展示侧剥前缀（chip 摘要与展开正文）。判定源收敛为 session-log-assembler.ts 新导出的 `isTaskWakeupInjection`——该模块本就持有该前缀的两处字面量特判（extract/stripPreambleText），message-queue-bar.tsx 的本地常量 `TASK_WAKEUP_PROMPT_PREFIX` 改为引用同一导出，消除三处字面量分叉。

选数据侧而非渲染侧的原因：段模型不再携带纯噪音段，时间线 / 右栏详情面板 / 未来消费者一次覆盖，无需在每个渲染分支重复谓词；开轮占位槽（2026-10-10-system-opened-turn-usermsg）依赖的「promptSource 剥空 → 占位空组」链路在 extract/strip 行为不变的前提下自然保持。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- session-log-assembler.ts 新增导出：`TASK_WAKEUP_PROMPT_PREFIX`（"[后台任务通知]"，与 backend/app/modules/daemon/session/service.py 同值约定不变）与 `isTaskWakeupInjection(content: string): boolean`（trim 后以前缀开头即 true）；`extractPreambleText` / `stripPreambleText` 对外行为不变（内部改用同一判定）。
- message-queue-bar.tsx 删除本地 `TASK_WAKEUP_PROMPT_PREFIX` 常量，改 import；TASK_WAKEUP 条目 chip 摘要与展开正文显示剥前缀后的通知正文（普通条目显示不变）。
- 无后端接口、协议、文件格式改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：判定只依赖单条 content 的前缀，与事件到达顺序无关；实时路径轮后对账/断线 resync 重放同前缀事件时，原建段逻辑有「已有 preamble 段不重复加」幂等守卫，本变更改为不建段，守卫自然无对象，迟到重放不产生任何段，行为安全。
2. 并发写：纯前端展示层改动，不新增共享写面；turn 状态仍走既有 setState 单线程更新队列，无并发写风险。
3. 切换/生命周期：不新增状态或副作用；刷新前（实时路径）与刷新后（回放路径）使用同一谓词，口径一致，不存在「刷新后卡片又出现」的形态差。
4. 作用域：前缀字面量与后端 service.py 同值的既有约定不变（本变更不改前缀本身，仅收敛前端持有处为单一导出）；无跨仓/跨工作区数据面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险是误伤用户手打的同前缀文本——该前缀由后端 TASK_WAKEUP 注入专属，用户消息不会以此开头，且既有 extract/strip 已按前缀特判多轮（2026-09-03 刷屏修复），风险口径与改前一致，不扩大。次要风险是共享文件混提交：session-log-assembler.ts / session-panel-page.tsx 工作区带有另一活跃变更（2026-10-13-subagent-stub-reconcile）的未提交 hunk，本次提交必须选择性暂存（仅暂存本变更 hunk），禁止整文件 add 裹挟。

试过但放弃的方案：①渲染侧过滤（turn-timeline / segment-view 对该前缀 return null）——需在每个渲染分支重复谓词、右栏详情面板易漏，且段数组仍被通知撑大，放弃；②后端不回传 TASK_WAKEUP user_input 日志——动协议面且丢失会话审计信息，超出小修复范围，放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | frontend/src/components/daemon/session-log-assembler.ts | 新增 `TASK_WAKEUP_PROMPT_PREFIX` / `isTaskWakeupInjection` 导出；extract/strip 内部复用同一判定 |
| M | frontend/src/components/daemon/runtime-session-helpers.tsx | 回放路径 preamble 建段跳过唤醒注入（开轮占位槽逻辑不动） |
| M | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 实时路径 preamble 建段跳过唤醒注入（prompt 补写逻辑不动） |
| M | frontend/src/components/daemon/message-queue-bar.tsx | 删本地前缀常量改 import；chip 摘要与展开正文剥前缀 |
| M | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 新增「不产出 preamble 段」用例（FR-01），既有占位槽/前导用例作回归守卫 |
| M | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | 新增去前缀显示用例（FR-03） |
| M | frontend/src/components/daemon/__tests__/session-log-assembler.test.ts | 新增 isTaskWakeupInjection 谓词用例 |
