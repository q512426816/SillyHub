---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-17
title: 前端 E2E 手工验证
wave: W6
priority: P0
estimate: 2h
depends_on: [task-13]
---

# task-17: 前端 E2E 手工验证

## 目标

手工跑完整链路验证所有 gate 交互和状态流转正确。

## 不在范围

- 不写自动化 E2E 测试

## 输入

- Docker 部署的完整服务栈
- 前端变更详情页

## 产出

- 验证记录（验证人签名 + 结果）

## 实现步骤

### 链路 1：明确需求全流程

1. 新建变更：只填需求描述 → 创建成功 → 自动 dispatch brainstorm agent
2. brainstorm 完成 → current_stage=propose, human_gate=need_proposal_review
3. 确认四件套（approve）→ plan agent 自动 dispatch
4. plan 完成 → human_gate=need_plan_review
5. 确认计划（approve）→ execute agent 自动 dispatch
6. execute 完成 → verify agent 自动 dispatch
7. verify 通过 → human_gate=need_human_test
8. 测试通过（pass）→ human_gate=need_archive_confirm
9. 确认归档 → current_stage=archived

### 链路 2：模糊需求

1. 新建模糊需求 → brainstorm → human_gate=need_requirement_input
2. 补充需求 → 重新 dispatch brainstorm
3. 后续同链路 1

### 链路 3：BUG 修复

1. 在 verify 通过后，human_test 选择「发现 BUG」
2. quick agent 自动 dispatch
3. quick 完成 → verify 自动 dispatch
4. verify 通过 → human_gate=need_human_test

## 验收标准

- [ ] 链路 1 全流程跑通
- [ ] 链路 2 模糊需求跑通
- [ ] 链路 3 BUG 修复跑通
- [ ] 前端状态与后端状态一致
- [ ] Agent 运行状态正确显示

## 风险

- Agent 执行可能需要较长时间——使用真实 Claude Code CLI

## DoD

- [ ] 三条链路全部验证通过
