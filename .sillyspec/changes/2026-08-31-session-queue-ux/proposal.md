---
author: qinyi
created_at: 2026-08-31 03:40:00
change: 2026-08-31-session-queue-ux
---

# 提案（Proposal）— 会话消息排队体验修复与增强

## 一句话

修复会话消息排队的三个行为缺陷（队头滞留 / SSE 不消费 / 非 active 批量转失败），
新增排队三操作（立即发送=打断当前轮直发、拖拽排序、重新编辑），并为聊天记录
（用户气泡/AI 正文/思考正文）补 hover 复制按钮。

## 问题与价值

- 排队消息在特定时序下永久滞留"等待中"、daemon 短暂掉线即全队转失败、队列 UI
  靠 5s 轮询滞后——排队机制本身健全（单会话单活跃 run + 行锁 + 终态钩子），问题
  集中在触发点覆盖与顺序键，修复而非重做（方案选择 2026-08-31 用户确认方案一）。
- 用户在排队后无法调整次序/内容/优先级，只能删除重发；聊天内容无法一键复制。

## 方案概要

- backend：position 列（迁移+回填）；PATCH reorder / PATCH entry / POST
  dispatch-now 三端点；dispatch 循环化（连续失败≤2）+ 非 active 收敛 + recover
  补派发钩子；queue_changed 事件补发。
- frontend：SSE 订阅 queue_changed 即时刷新；MessageQueueBar 原生拖拽 + ⚡ + ✎；
  CopyButton 组件三处挂载。
- daemon：零改动。

## 范围

见 design.md §2 FR-01~07 / §3 NG-01~06。不做附件编辑、不引 DnD 库、不做后台
sweeper、不改排队上限与串行不变式。

## 验收

见 design.md §8 测试策略 + verify 阶段对照。

## 不在范围内（Non-Goals）

- 附件/供应商/档案的重新编辑（仅 prompt 文本）。
- 排队上限（5）与"单会话至多一个活跃 run"不变式的任何变化。
- daemon（sillyhub-daemon）改动与发版（interrupt/派发链路全复用）。
- 前端新增依赖（DnD 三方库）；工具行/文件卡片复制（已有或不适用）。
- 常驻后台派发 sweeper；历史排队数据语义迁移。
