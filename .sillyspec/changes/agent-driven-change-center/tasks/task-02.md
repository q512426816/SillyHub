---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-02
title: Schema/Response 返回 human_gate
wave: W1
priority: P0
estimate: 1h
depends_on: [task-01]
---

# task-02: Schema/Response 返回 human_gate

## 目标

在 ChangeRead、ChangeSummary 等 DTO 中增加 `human_gate` 字段，使前端能读取当前人工等待状态。

## 不在范围

- 不修改 Change model（task-01 已处理）
- 不修改路由逻辑

## 输入

- `backend/app/modules/change/schema.py`
- `backend/app/modules/change/model.py`（task-01 产出）

## 产出

- `backend/app/modules/change/schema.py`（改）

## 实现步骤

1. 读取 `schema.py`，找到 `ChangeRead` 和 `ChangeSummary` 类
2. 在 `ChangeRead` 中增加 `human_gate: str | None = "none"`
3. 在 `ChangeSummary` 中增加 `human_gate: str | None = "none"`
4. 确认 `ChangeCreate` 不需要 human_gate（创建时默认 none）

## 验收标准

- [ ] ChangeRead 返回 human_gate 字段
- [ ] ChangeSummary 返回 human_gate 字段
- [ ] GET /changes/{id} 响应中包含 human_gate

## 风险

- 如果 model 的 Change 对象没有 human_gate 属性，model_validate 会忽略——确保 task-01 的 model 改动先合并

## DoD

- [ ] 代码修改完成
- [ ] 无 type 错误
