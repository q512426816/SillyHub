---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Proposal

## 动机

知识库不能只是 `.md` 文件列表，也不能让 Agent 自动把运行中观察到的内容写成正式团队知识。平台需要把执行产物转成候选知识，再由 Reviewer 审核、验证、推广或废弃。

## 关键问题

### 1. 文件列表没有生命周期

纯 `.md` 文件难以表达来源任务、适用 Workspace、成熟度、审核人、过期状态。

### 2. AI 自动沉淀会污染知识资产

Agent 可以提取候选，但不能自动确权正式知识。

### 3. 向量索引不能成为知识本体

向量库适合检索加速，不适合承载审核、权限、来源和版本语义。

## 变更范围

- 新增 Knowledge metadata 模型。
- 建立 `candidate -> confirmed -> verified -> promoted -> deprecated` 生命周期。
- 从 Task / AgentRun / Review 中提取 candidate。
- Reviewer 审核后才能进入 confirmed。
- 向量索引作为后置检索索引。

## 不在范围内（显式清单）

- 不做 Local Runner 执行。
- 不做 Server Sandbox Runner。
- 不自动把 candidate 写成正式知识。
- 不把向量库作为唯一知识存储。

## 成功标准（可验证）

- Agent 只能创建 candidate。
- Reviewer 能确认或拒绝 candidate。
- confirmed / verified / promoted / deprecated 状态可追踪。
- 每条知识有来源 task/run/workspace。
- 查询知识时能按 workspace、类型、成熟度过滤。
