---
author: sillyspec-fr-index
created_at: 2026-09-22T16:38:58.642Z
---

# FR 索引 — auto-sillyhub-daemon

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyhub-daemon-001 轮任务派生
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given pi 会话产生一轮 turn（turn_start → ... → turn_end）；When 轮内出现 tool_execution_start；Then 归一化器产出一组任务事件：turn_start 时 running（task_id=pi-t<seq>），turn_end 时按 stopReason 映射终态
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-01
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-002 上报链路复用
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 归一化器产出 status/agent_task_status 事件；Then 经既有 envelope→_onMessage→_dispatchStatusEvent→cli onSessionEvent→notifyAgentTaskS
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-02
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-003 异常流防御
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 上一轮任务仍 running 时新 turn_start 到达（上轮 turn_end 丢失）；Then 先补发上轮 completed 再开新行，不产生悬挂 running
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-03
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-004 既有行为零回归
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 全部既有 pi-events 用例与 claude/codex 会话；Then 映射表零改动；既有用例仅 expected 数组适配（追加派生事件）；claude/codex 零变化
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-04
最近确认：35f3d6528
