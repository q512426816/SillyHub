---
author: qinyi
created_at: 2026-10-28T00:40:00
---
# 提案书（Proposal）— 2026-10-28-bg-task-status-report

## 动机

用户实测（截图实证）平台会话页后台任务状态两头不准：后台任务运行期间会话显示如空闲（无任何运行中提示）；任务完成后条目永挂「运行中」。根因：CLI 后台任务的完成信号（rollout 日志中 task-notification 结构）被 daemon 日志解析器忽略，终态事件从未到达平台。

## 变更范围

方案 A（D-001@v1，事件级上报）三条线：

1. **daemon**：解析 task-notification（task-id/tool-use-id/status/output-file 四字段）→ 产 `bg_task_final` 事件 → 经 onTurnMessage 桥+HubClient 新方法 notifyBgTaskFinal 上报新端点 POST /api/daemon/sessions/{id}/bg-task-final（turn-phase 同款模式，幂等双层）。
2. **backend**：事件类型词表与负载校验扩展（JSON 列零 migration）+ SSE 透传。
3. **frontend**：活动流按 tool_use_id 配对翻转条目终态；会话空闲态显示「后台任务 N 个运行中」（事件配对推导）。

## 不在范围内（Non-Goals）

- 后台任务实时输出流转发（另立变更）。
- 改 CLI 自身。
- 跨会话后台任务聚合视图。
- 心跳计数兜底（D-002）/ 平台超时猜测（D-003）——防复潮。

## 成功标准

- 启动后台任务（如打包）→ 会话空闲期平台显示「后台任务 1 个运行中」。
- 任务完成 → 条目在日志轮询节奏内翻转为终态（不再永挂运行中）。
- 旧版 daemon 不上报终态时平台维持现状零报错。
- 三侧测试全绿，gen:types 双端义务核查（如触发）。

## 决策覆盖

- D-001@v1（方案 A 事件级上报）→ 覆盖「变更范围」全部三条线。
- D-002@v1（落选：心跳计数）→ 覆盖 Non-Goals 第 4 条。
- D-003@v1（落选：超时猜测）→ 覆盖 Non-Goals 第 4 条。

## 规模

scale=large：daemon/backend/frontend 三段联动、Wave 并行编排（证据见 design.md 拆分判断节）。
