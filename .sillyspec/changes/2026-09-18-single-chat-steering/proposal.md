---
author: qinyi
created_at: 2026-09-19 00:22:43
---
# 提案书（Proposal）— 单聊引导（Steering）忙轮直注入

## 动机

agent 在长任务运行中（忙轮），用户想说「顺便也改下 XX」只能等本轮完全结束（现有排队）或打断重来（⚡ 打断式）——与 pi / Claude Code / Codex 原生终端体验（运行中打字回车即引导注入，不打断当前轮）不一致。群聊 @ 忙轮成员已有 steering 直注入链路，单聊没有对等能力。

## 关键问题

1. **单聊忙轮发送=排队等待**：`queue_when_busy=True`（router/session_crud.py:605）落排队表，本轮完全结束才派发——长任务期间无法即时补充指示，时延=整轮时长。
2. **⚡「立即发送」代价是打断**：dispatch_now 现逻辑 commit 后 interrupt 活跃轮再接力派发（queue.py:600-665）——用户想要「不打断、马上让 agent 知道」没有途径，打断会丢掉本轮已进行到一半的工作上下文。
3. **codex 引擎忙轮注入被降级到轮边界**：daemon codex 驱动轮级串行（输入循环 :1231-1239，turn/completed 后才消费下一条），而 codex 0.147 app-server 协议实有 `turn/steer` 方法未接入——平台白白放弃引擎原生 steering 能力。

## 变更范围

- 后端：单聊忙轮分支改 `busy_strategy=inject`（复用群聊 `_inject_mid_turn_into_run`，留痕挂活跃 run，mid_turn 字段端到端复用）；dispatch_now 改引导式（支持引导的 provider 不再 interrupt）；provider 能力门控（PROVIDER_CAPS steering 第 14 键，三端生成单源）。
- daemon：codex 驱动接 `turn/steer` 分支（被拒回落轮边界消费）；claude SDK 队列吸收实测（spike，预期零代码改动）；PROVIDER_CAPS 单源加键。
- 前端：忙轮发送即引导（引导中→已引导气泡状态）；⚡ 文案与行为改引导语义；降级 chip 标注；api-types/手写镜像同步。

## 不在范围内（显式清单）

- 不统一各引擎 abort 时未投递引导消息的语义（NG-1，如实暴露引擎原生行为）
- 不给 cursor 驱动接 steering（NG-2，无证据支持，轮边界消费=自然降级）
- 不做引导消息撤回/编辑（NG-3）
- 不做移动端 parity（NG-4，另开变更）
- 定时消息忙轮策略不变（NG-5）
- 群聊 @ steering 行为零改动（同一入口复用，仅回归保障）

## 成功标准（可验证）

- pi/claude/codex 单聊会话忙轮发送普通消息：不打断当前轮，响应 `steered=true`，消息留痕挂活跃 run（mid_turn），前端「引导中」→「已引导」状态流转正确
- cursor（及未知 provider）单聊忙轮发送：行为与现状逐字节一致（排队条目+派发，不报错）
- 队列条 ⚡ 立即发送：支持引导的 provider 不再 interrupt（dispatch_mode=steered）；不支持的维持现状（interrupted）
- 停止按钮 interrupt 语义、带切换维度消息排队/409 语义、群聊 @ steering、服务身份 409——全部零回归（既有测试通过）
- PROVIDER_CAPS 三端 alignment 测试通过（steering 键一致）
- codex `turn/steer` 实机探测结论落盘（成功接入或 caps 置 false 降级收尾，二选一闭环）
