---
author: qinyi
created_at: 2026-10-28 00:20:00
---

# 决策记录 — 2026-10-28-bg-task-status-report

## D-001@v1 后台任务状态上报技术路线：方案 A（事件级上报）

- **status**: accepted
- **type**: architecture
- **source**: user
- **日期**: 2026-10-28
- **question**: CLI 后台任务（run_in_background Bash 等）状态在平台会话页的实时准确性如何实现？
- **answer**: 方案 A——daemon 解析 CLI 会话日志（rollout jsonl）中后台任务的完成信号（task-notification 系统消息 / 后台 tool_result），产「后台任务终态」活动事件上报平台；平台将对应「后台任务 · 运行中」条目翻转为终态，并在会话空闲时状态区显示「后台任务 N 个运行中」（由事件流推导运行中集合）。理由：状态实时且条目级准确，一次治好「该显示的不显示」与「完成了还挂运行中」两头；现有链路基础好——daemon 已解析 tool_use 的 run_in_background 声明（events.ts:578）、平台已能显示后台任务启动条目（tool_use 事件已通）、daemon→平台活动事件通道已有（agent log 事件/turn_phase 先例）。
- **evidence**: brainstorm 方案对比（AskUserQuestion，2026-10-28），用户选项「方案 A：事件级上报（推荐）」；现象实证：用户截图显示 Bash 后台任务条目「运行中 02:14」而实际早已完成（seq48 部署命令）。
- **问题定义（用户原话）**: 「为什么我在平台会话页面看不到正在运行的信息？…在平台会话里应该也要展示到后台标签里呀，可是我没看到有任何的提示，就像结束了一样」+「为什么现在又能看到这个信息了？刚刚都还没有呢」（两头不准实证）。

## D-002@v1 落选方案 B（心跳计数）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 B——daemon 心跳（15s）携带各会话后台任务运行中计数。
- **否决理由**: 只有计数无条目——平台「后台任务 · 运行中」条目仍无终态翻转（已启动条目永远挂着运行中）；计数与条目两套口径易漂移。
- **复潮条件**: 若事件通道（rollout 解析→上报）被证实不可行（如 CLI 日志无终态信号），再评估计数兜底。

## D-003@v1 落选方案 C（平台超时猜测）— rejected

- **status**: rejected
- **type**: architecture
- **source**: user
- **question**: 同 D-001 问句
- **理由**: 方案 C——平台侧对后台任务条目按超时标灰。
- **否决理由**: 猜测非事实——镜像打包 20 分钟、长测试更久，超时阈值必误判；治标不治本（「该显示时不显示」的活跃期盲区完全不解决）。
- **复潮条件**: 不复潮（除非 daemon 侧彻底失去信号源）。
