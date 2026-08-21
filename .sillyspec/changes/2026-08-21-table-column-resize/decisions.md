---
author: qinyi
created_at: 2026-08-21T10:05:00
---

# decisions.md — 2026-08-21-table-column-resize 决策台账

## D-501: 共享层实现
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 列宽拖拽在哪层实现?
- answer: DataTable 共享层（hook+接入），13 个消费页自动生效；16 页直用 Table 的收敛另立变更
- normalized_requirement: 消费页零改动获得能力；不引第三方库
- impacts: [design §2/§5]
- evidence: AskUserQuestion 用户确认"确认，按此方案"

## D-502: 无 width 列不可拖
- type: boundary
- status: accepted
- source: architect
- priority: P1
- question: 自适应列（无 width）是否可拖?
- answer: 不可拖——拖自适应列会挤压其它列破坏布局（antd 官方建议 width 列才可拖）
- normalized_requirement: 仅显式 width 列挂手柄；无 width 列表头行为不变
- impacts: [design §2/§5-1]
- evidence: antd 官方 resizable 文档惯例

## D-503: 记忆接口预留不实现
- type: boundary
- status: accepted
- source: architect
- priority: P2
- question: 拖后宽度是否持久化?
- answer: 本轮不做——留 onColumnsResize 受控回调，页面后续可自行存 localStorage
- normalized_requirement: 不传回调=纯本地拖拽；接口签名稳定
- impacts: [design §2/§5-2]
- evidence: YAGNI（用户未提记忆需求）
