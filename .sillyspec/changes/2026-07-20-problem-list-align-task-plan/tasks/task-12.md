---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-12
title: ppm-status-actions 3 态中文 + shared 复用
wave: 2
blockedBy: [task-02]
allowed_paths: [frontend/src/components/ppm-status-actions.tsx, frontend/src/app/(dashboard)/ppm/shared.tsx]
acceptance: [FR-1]
---

## 目标
问题清单状态展示映射改 3 态中文，复用 `taskStatusTag`。

## 实现步骤
1. `components/ppm-status-actions.tsx:69` `PROBLEM_STATUS_TEXT` 收敛为 `{ "新建": "新建", "进行中": "进行中", "已完成": "已完成" }`；`:79` `PROBLEM_STATUS_COLOR` 对齐 task 的 default/processing/success（参照 `shared.tsx:58 taskStatusTag`）。
2. 删老数字 key（"1"/"2"/"3"/"4"/"5"/"6"/"7"）的映射项（status 已中文化）。
3. `shared.tsx` 的 `taskStatusTag` 确认支持「新建/进行中/已完成」（任务计划是「未开始/进行中/已完成」）；若 problem 用「新建」与 task「未开始」不同字面值，`taskStatusTag` 已是按字面查表的 default 兜底，无需改；problem 也可直接用 `PROBLEM_STATUS_TEXT`。
4. 核实 problem-list 列表状态渲染（`page.tsx:367-380`）改读 `effective_status`（=status 中文）。

## 测试点
- status="新建"/"进行中"/"已完成" → Tag 正确颜色；老数字值不再出现（后端已迁移）。

## 验收
- 状态展示 3 态中文；lint/typecheck 绿。
