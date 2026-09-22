---
author: qinyi
created_at: 2026-09-07 10:30:00
---

# 提案书（Proposal）

## 动机

会话任务执行面板（已归档变更 2026-09-04-session-task-execution-panel）对 pi 引擎会话恒为空——pi 原始事件流无任务级事件，上轮按降级边界（D-003）跳过。用户实测确认体验缺失，要求补齐。

## 关键问题

1. pi 会话任务清单/运行中页签恒空态，用户无法看到 pi 会话的执行进度（claude 会话同页有数据，对比明显）。
2. pi 的原始流有足够的派生素材（turn_start/turn_end 生命周期 + tool_execution_start/end 工具流），只是从未被映射成任务语义。

## 变更范围

- sillyhub-daemon：PiEventNormalizer 增实例级 turnTask 聚合状态机，产出 status/agent_task_status 事件（派生规则见 design）；既有映射零改动。
- 测试：pi-events 单测扩展 + session-manager 分派集成用例 + 既有用例 expected 适配。
- 模块卡 daemon 补 pi 派生说明。
- 后端/前端/上报链路：零改动（复用既有 agent_task_status 全链路）。

## 不在范围内（显式清单）

- pi 子代理派生（无对应概念）
- 计划总纲（pi 无 plan 事件）
- 批量适配器 pi-json.ts
- claude/codex 行为任何变化
- 前端面板组件改动

## 成功标准（可验证）

- pi 会话任务执行面板每轮一行：running（随工具调用实时刷新工具名/次数）→ 终态（成功/失败+耗时）。
- 刷新/切会话回来任务行仍在（复用既有持久化）。
- pi-events 既有用例全部绿（含 expected 适配）；新状态机用例覆盖完整轮生命周期/异常流/时钟注入。
- claude/codex 会话行为零变化。
