---
author: flow-machine-draft
created_at: 2026-10-13T01:07:19.831Z
---
# 设计记录（Design Record）— 2026-10-13-agent-task-stuck-running

## 做法概述

「子代理已完成但 UI 永久运行中」有三个叠加根因（排查实证，见 FR 正文）：① daemon `claude-events.ts` `_toolUseSessionSignals` 的 Task/Agent tool_use 派生 running 事件以 call id 冒充 task_id 且不带 `tool_use_id`，导致 backend 2026-10-12-session-defects task-03 已落地的幽灵成对行写侧收口（依赖事件携带 tool_use_id）对冒名行永不生效——生产会话 47e2ff1a 实证 21 组成对行；② daemon `background-tasks.ts` `handleTaskNotificationEvent` 对注册表别名条目（tool_use 派生懒注册的 call id 条目）从不补发终态，别名条目永卡 running；③ 前端装配器 task 行在 parent_tool_use_id 未命中时整行丢弃（session-log-assembler.ts:1306-1328），[TASK_NOTIFICATION] 终态信号丢失则派发段永转圈（turn-state.ts:145-165 注释实证）。

修法（三端各一小刀，不动 backend——其写侧收口与读侧去重 2026-10-12 已落地，本变更让 daemon 数据流满足其触发前提）：daemon 侧派生事件补 `tool_use_id` + 终态时别名条目注销/补发 + 三无场景 WARN 日志；前端装配器提取并持久 task_id、parent 未命中时按 task_id 轮内 DFS 兜底吸收。backend 清扫只写 stopped 的保守语义维持不动（无结果证据时不得标 completed）。

## 接口契约

- daemon `AgentEvent` metadata（`_toolUseSessionSignals` Task/Agent 分支）：新增可选键 `tool_use_id: string`（值=block call id）。既有消费方 `handleAgentTaskStatusEvent` 已读该键（line 68），零兼容问题。
- daemon `handleTaskNotificationEvent`：函数签名不变；行为新增——终态处理尾部对注册表做一次 toolUseId 相同的别名扫描（注销；主条目缺失时补发终态 emit + 落行）。三无分支新增 `console.warn`。
- frontend `SessionLogSegment`（task kind）新增可选字段 `taskTaskId?: string`；tool 段元数据新增可选字段 `taskTaskId?: string`（`applyTaskMeta` 合并，PROGRESS/NOTIFICATION 均可携带——latest-wins 同字段覆盖语义）。`TaskLineMeta` 的 Pick 集合同步扩展。装配器新增模块级 `findToolByTaskId`（全树 DFS，仅装配器内部消费，不导出）。
- 无 HTTP API / DB schema / OpenAPI 变化；`pnpm gen:types` 不需要跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：终态行覆盖 running 行是既有「到达顺序即权威」语义（applyTaskMeta 注释），task_id 兜底吸收沿用同语义，乱序无新增风险。别名补发终态只发生在「主条目从未注册」时（task_started 帧丢失），若 task_started 迟到补注册，后续该条目的 progress 事件走懒注册正常挂靠，终态已发则由「终态吸收」（backend 语义② + 前端 agent-task-store 终态忽略迟到 running）双端兜住。
2. 并发写：daemon 单进程事件循环内顺序处理 task_notification，别名扫描与注销在同一 await 链内完成，无并发窗口；backend 写侧收口自身的并发由既有唯一约束 + 后写者撞约束进旁路 except 兜底（agent_task_store.py docstring），本变更不触碰。
3. 切换/生命周期：daemon 重启后注册表清空、SDK 子进程消亡——不会再有 task_notification 到达，别名扫描不会在重启后误触发；三无 WARN 是该窗口唯一可观测面（符合 FR-01）。会话 end 走 clearBackgroundTasks 全量清理，先于任何迟到的扫描分支，无泄漏。
4. 作用域：task_id 在 backend 表以 (session_id, task_id) 唯一约束隔离；前端 taskTaskId 反查只在**单轮 segments 树内** DFS，不跨轮、不跨会话——不会把别的会话/别的轮的段误吸收。别名扫描以 toolUseId 相等 + 注册表（会话级 Map）为界，天然会话隔离。

## 风险与死路

最大风险：前端 task_id 兜底把行吸收到**非派发段**（taskTaskId 撞车）。task_id 由 SDK harness 全局唯一生成（call id 亦然），且反查域限于单轮树，实际撞车概率趋零；即便撞车，后果仅是段元数据被终态覆盖（展示层），无数据损坏。

试过但放弃的方案：① backend 读侧把同名组 running 行也参与终态收敛——被 D-009@v1 裁决否决（同名多 running 是合法重试在途实例，会误杀），不动；② daemon 三无场景强行落行/emit——无 runId 载体（`onTurnMessage`/`_emitSessionEvent` 均必填 runId），强行造 run id 会产生脏轮，降级为 WARN 日志；③ 前端 upsertTurn 层按 task_id 跨轮路由——需在轮路由层解析行 content JSON（越层），且 2026-09-15 已有 parent_tool_use_id 跨轮路由覆盖「行落错轮」主场景，收益边际小、风险面大，不做；④ 修存量脏数据（迁移/清洗脚本）——项目未正式上线允许重置数据，且存量行经既有清扫（run 收口 60s / 启动清扫）→ stopped → 读侧去重收敛闭环，无需脚本。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/interactive/claude-events.ts | `_toolUseSessionSignals` Task/Agent 分支 metadata 补 `tool_use_id` |
| 修改 | sillyhub-daemon/src/interactive/session-manager/background-tasks.ts | `handleTaskNotificationEvent` 别名条目注销/补发 + 三无 WARN 日志 |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | task 行提取 task_id、段元数据持久、parent 未命中按 task_id 兜底吸收 |
| 新增 | sillyhub-daemon/tests/interactive/background-tasks.test.ts 内新增用例 | 别名补发/静默注销/三无 WARN 回归 |
| 修改 | frontend/src/components/daemon/__tests__/task-line-assembler.test.ts | task_id 兜底吸收/无命中丢弃回归 |
