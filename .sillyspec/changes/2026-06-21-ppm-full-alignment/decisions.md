---
author: qinyi
created_at: 2026-06-21T02:30:40+0800
change: 2026-06-21-ppm-full-alignment
---

# 决策台账

## D-011@v1: 看板评论/子任务新建表
- type: architecture
- status: accepted
- source: code(自主)
- question: 看板任务评论/子任务(源 TaskDetailDrawer)如何实现?
- answer: 新建 ppm_kanban_comment + ppm_kanban_subtask 表(源无独立表,为对齐源看板工作站新建)
- impacts: [W1, design §8]
- evidence: Explore 调研源看板 TaskDetailDrawer 完整评论/子任务/附件
- priority: P0

## D-012@v1: 通知延续审计日志
- type: boundary
- status: accepted
- source: code(自主)
- question: 审批流通知?
- answer: 延续 D-006(审计日志+前端轮询,不建站内信)
- impacts: [W2]
- evidence: D-006@v1
- priority: P1

## D-013@v1: 图表 echarts-for-react
- type: architecture
- status: accepted
- source: code(自主)
- question: 图表库?
- answer: echarts-for-react(对齐源意图 echarts,React 生态)
- impacts: [W5, design §7]
- evidence: Explore 调研源装 echarts(未落地)
- priority: P1

## D-014@v1: 成本字段派生计算
- type: architecture
- status: accepted
- source: code(自主)
- question: projectplan 成本17字段?
- answer: 后端 model 已有字段,补计算派生(remaining=budget-actual)+ 前端17字段表单
- impacts: [W3]
- evidence: Explore 调研源成本核算逻辑
- priority: P1
