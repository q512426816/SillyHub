---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-15
title: 后端测试（gate 转换 + review API + verify 自动修复）
wave: W6
priority: P0
estimate: 4h
depends_on: [task-08, task-09, task-10, task-11]
---

# task-15: 后端测试（gate 转换 + review API + verify 自动修复）

## 目标

为所有新增逻辑编写单元测试，覆盖 gate 转换、3 个 review API、verify 自动修复和旧数据迁移。

## 不在范围

- 不测试前端（task-17 E2E 验证）

## 输入

- `backend/app/modules/change/tests/`（现有测试目录）
- `backend/app/modules/change/service.py`（task-04~11 产出）
- `backend/app/modules/change/router.py`（task-08~10 产出）

## 产出

- `backend/app/modules/change/tests/test_gate_transitions.py`（新增）
- `backend/app/modules/change/tests/test_review_apis.py`（新增）

## 实现步骤

1. 创建 `test_gate_transitions.py`：
   - transition 到各 stage 后 human_gate 正确设置
   - transition 到 draft/execute/quick 后 human_gate=none
   - transition 到 propose 后 human_gate=need_proposal_review
   - WorkflowService.transition_change() 同步设置 human_gate
2. 创建 `test_review_apis.py`：
   - proposal_review approve/revise/unclear
   - plan_review approve/replan/back_to_propose/back_to_brainstorm
   - human_test pass/bug/doc_mismatch
   - 非 correct stage+gate 调用返回错误
3. 验证旧数据迁移后的行为：
   - rework_required 记录 transition 行为正确
   - accepted 记录 transition 行为正确

## 验收标准

- [ ] 所有 gate 转换测试通过
- [ ] 3 个 review API 的所有 decision 分支测试通过
- [ ] verify 自动修复 3 轮限制测试通过
- [ ] 旧数据迁移后行为正确

## 风险

- 测试需要 mock dispatch 和 AgentRun——复用现有 mock 模式

## DoD

- [ ] 测试文件完成
- [ ] pytest 全部通过
