---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-13
title: 详情页按 gate 渲染操作面板
wave: W5
priority: P0
estimate: 4h
depends_on: [task-12, task-08]
---

# task-13: 详情页按 gate 渲染操作面板

## 目标

替换现有的 WORKFLOW_TRANSITIONS 按钮为基于 `human_gate` 的操作面板。用户看到的是业务语义操作（确认文档、确认计划、测试通过），不是技术阶段名。

## 不在范围

- 不实现新建变更表单（task-14）
- 不实现后端逻辑（已在 Wave 1-3 完成）

## 输入

- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- `frontend/src/lib/change.ts`（task-12 产出）
- `.sillyspec/changes/agent-driven-change-center/prototype-change-detail.html`（交互原型）

## 产出

- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（改）

## 实现步骤

1. 定义 `GATE_PANELS` 映射，key 为 human_gate 值，value 为面板配置：
   - `need_requirement_input`: 标题「请补充需求」，按钮「重新分析」
   - `need_proposal_review`: 标题「四件套已生成，请确认」，按钮「确认通过」「提出修改意见」「需求不明确」+ comment textarea
   - `need_plan_review`: 标题「执行计划已生成，请确认」，按钮「确认计划」「重新计划」「退回文档」「退回澄清」+ comment textarea
   - `need_human_test`: 标题「自动验证通过，请人工测试」，按钮「测试通过」「发现 BUG」「文档不符」+ comment textarea
   - `need_archive_confirm`: 标题「归档确认」，按钮「确认归档」+ 归档检查项
   - `blocked`: 标题「需要人工介入」，按钮「重试修复」「退回执行」
   - `none`: 显示 Agent 运行状态（正在执行/空闲）
2. 替换现有的 `WORKFLOW_TRANSITIONS` 按钮渲染逻辑
3. 每个按钮调用对应的 review API（task-12 定义的函数）
4. 操作完成后刷新 change 状态

## 验收标准

- [ ] human_gate=need_proposal_review 时显示确认面板
- [ ] human_gate=none 时显示 Agent 运行状态
- [ ] 操作后 change 状态刷新
- [ ] 不再显示技术阶段名（propose/plan/execute 等）
- [ ] 保留 stage pipeline 进度条

## 风险

- 页面组件复杂度高——建议拆出 `GateActionPanel` 子组件

## DoD

- [ ] 代码修改完成
- [ ] pnpm typecheck 通过
