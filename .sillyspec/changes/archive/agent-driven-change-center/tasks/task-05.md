---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-05
title: 后端 create_change 适配 + request.md
wave: W2
priority: P0
estimate: 2h
depends_on: [task-01]
---

# task-05: 后端 create_change 适配 + request.md

## 目标

创建 Change 时设置 `current_stage=draft, human_gate=none`，并写入 `request.md` 保存用户原始需求。

## 不在范围

- 不修改前端表单（task-14）
- 不修改 dispatch 逻辑（task-06）

## 输入

- `backend/app/modules/change/service.py`（create 方法）
- `backend/app/modules/change/router.py`（create 路由）
- `backend/app/modules/change/schema.py`（CreateChange DTO）

## 产出

- `backend/app/modules/change/service.py`（改）

## 实现步骤

1. 在 `service.py` 中找到 create 方法（或 `_create_change_internal` 等内部方法）
2. 确保 `current_stage` 初始化为 `"draft"`
3. 确保 `human_gate` 初始化为 `"none"`（model 默认值已处理，确认即可）
4. 新增 `request.md` 写入逻辑：创建 Change 后，在 `.sillyspec/changes/{change_key}/` 下写入 `request.md`，内容为用户原始需求描述
5. request.md 需包含 frontmatter（author, created_at）

## 验收标准

- [ ] 新建 Change 的 current_stage 为 draft
- [ ] 新建 Change 的 human_gate 为 none
- [ ] .sillyspec/changes/{change_key}/request.md 被创建
- [ ] request.md 包含用户原始需求

## 风险

- 如果 create 方法有多个入口（router、change_writer），确保都覆盖

## DoD

- [ ] 代码修改完成
- [ ] 手工创建 Change 验证 request.md 生成
