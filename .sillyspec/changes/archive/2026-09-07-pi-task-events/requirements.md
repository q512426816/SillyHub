---
author: qinyi
created_at: 2026-09-07 10:30:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 使用 pi 引擎会话的人，期望任务面板有数据 |
| PiEventNormalizer | pi 下行 JSONL → AgentEvent 归一化器（本变更改造点） |
| session-manager / backend / 前端 | 既有 agent_task_status 链路（零改动复用） |

## 功能需求

### FR-01: 轮任务派生
覆盖决策：D-001@v1
Given pi 会话产生一轮 turn（turn_start → ... → turn_end）
Then 归一化器产出一组任务事件：turn_start 时 running（task_id=pi-t<seq>），turn_end 时按 stopReason 映射终态（error→failed，其余→completed）
When 轮内出现 tool_execution_start
Then running 事件刷新（last_tool_name/tool_uses/summary='正在调用 X'）
And tool_execution_end 不产事件不终态

### FR-02: 上报链路复用
覆盖决策：D-002@v1
Given 归一化器产出 status/agent_task_status 事件
Then 经既有 envelope→_onMessage→_dispatchStatusEvent→cli onSessionEvent→notifyAgentTaskStatus 链路上报，session-manager/cli/backend 零特判

### FR-03: 异常流防御
Given 上一轮任务仍 running 时新 turn_start 到达（上轮 turn_end 丢失）
Then 先补发上轮 completed 再开新行，不产生悬挂 running
And 状态机任何异常不阻断原始事件流（try/catch 隔离）

### FR-04: 既有行为零回归
Given 全部既有 pi-events 用例与 claude/codex 会话
Then 映射表零改动；既有用例仅 expected 数组适配（追加派生事件）；claude/codex 零变化

## 非功能需求

- 兼容性：旧 backend 收上报 4xx 仅记日志（既有旁路）；daemon 重启悬挂 running 行接受（与 claude 同口径，R-03）。
- 可测试：now() 时钟注入可测走秒；状态机用例独立 describe。
- 风格：daemon ESM import 带 .js 扩展名；纯函数测试范式延续。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 一轮一任务聚合 |
| D-002@v1 | FR-02 | 归一化器内派生（⚠️ 自主待复核） |
| D-003@v1 | 全部 | 设计整体（⚠️ 自主待复核） |
| D-004@v1 | FR-01, FR-04 | grill 修正：stopReason 实证/测试路径/R-01 应对 |
