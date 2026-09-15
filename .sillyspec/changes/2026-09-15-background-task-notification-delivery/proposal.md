---
author: qinyi
created_at: '2026-09-15 16:20:00'
source: 会话 6e213eb3-781e-414a-89c8-905c79c79d89 agent 故障报告（P1-1/P1-2）
status: 需求已登记待完整流程（brainstorm Step 2 停驻）
---

# 提案（Proposal）— 2026-09-15-background-task-notification-delivery

> 本变更由线上会话 6e213eb3（奖惩功能开发，2026-09-15）的 agent 故障报告驱动，
> 需求原文照录如下（P1-1/P1-2）；与 `2026-09-15-background-task-permission-lockout`
> （P0 权限锁死修复）正交，不混变更。**尚未做根因核实**——恢复流程时先核实
> （通知截断长度阈值在哪、TaskOutput 输出文件为何 0 字节、通知批投与滞后回执
> 的产生机制），再走 brainstorm → plan → execute。

## 背景

后台 Task 子代理的完成通知与结果取回通道在该会话中大面积失效，迫使主流程走
「子代理文本返回代码 → 主会话代写盘」的降级路径，并连续多轮浪费在关闭早已完成
的历史任务上。

## 需求原文（agent 故障报告照录）

### P1-1 后台子代理完成通知截断 + 结果取回通道失效

现象（task_id: a6907cd01bdbb88f3，task-06 小程序端）：
- 完成通知里的结果摘要被截断，9 个文件源码只收到后半段
- 按通知提示用 TaskOutput(block=false) 取完整输出：输出文件为 0 字节空壳，转录未落盘
- 最终只能唤醒子代理分三段重发，纯耗 4 个轮次

期望：
1. 通知摘要截断时明确标注（如"已截断，全文见输出文件"），且保证输出文件真实落盘、内容完整
2. 建议为子代理提供"产物文件"主通道（大体积交付物写文件而非塞进结果文本）

### P1-2 后台任务通知风暴与滞后回执

现象：
- 单批 18 项任务结束通知一次性到达（另有 8 项 / 4 项 / 3 项批次）
- 大量为滞后回执：工作早已被消费，通知隔了若干轮才到——本会话有连续 3 轮
  在逐条关闭早已完成的历史任务，纯上下文与轮次开销

期望：
1. 通知与任务结束准实时对齐
2. 过期批量通知做合并/去重，或提供"已消费任务静默"机制

## 关联证据（主代理排查补充）

- 该会话 [TASK_NOTIFICATION]/[后台任务通知] 日志（agent_run_logs，run 归属
  d63a658c/4039b84e/932d62ee 等）可复现截断与批次到达形态。
- daemon 侧通知链路：`sillyhub-daemon/src/interactive/session-manager/background-tasks.ts`
  （task_notification 注销+落行）、backend 排队通知合并（daemon.md 模块文档
  ql-20260827-015：`_merge_task_wakeup_prompt` 同会话 pending 合并——P1-2 的
  合并机制已有地基，滞后回执源头待查）。
- TaskOutput 输出文件落盘路径在 claude SDK/driver 侧，0 字节空壳根因待核实。

## 非目标

- 权限锁死修复（P0-1，属另一变更）。
