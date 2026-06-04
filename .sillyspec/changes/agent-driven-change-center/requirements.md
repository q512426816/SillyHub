---
author: WhaleFall
created_at: 2026-06-04 10:40:22
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 创建变更、提交需求、确认文档/计划、测试验证 |
| Agent | 自动执行 SillySpec 阶段（intake/propose/plan/execute/verify/quick/archive） |
| Admin | 绕过所有 gate 检查、强制推进阶段 |

## 功能需求

### FR-01: 统一 current_stage 枚举

Given Change 模型的 current_stage 字段
When 系统初始化
Then current_stage 枚举为：draft, scan, brainstorm, propose, plan, execute, verify, quick, archive, archived, blocked
And rework_required 和 accepted 不再出现在枚举中

### FR-02: 新增 human_gate 字段

Given Change 模型
When 执行 DB 迁移
Then Change 表新增 human_gate 字段（VARCHAR(50), DEFAULT 'none'）
And human_gate 枚举为：none, need_requirement_input, need_proposal_review, need_plan_review, need_human_test, need_archive_confirm, blocked

### FR-03: 旧数据迁移

Given 已有 Change 记录的 current_stage 为 rework_required
When 迁移脚本执行
Then current_stage 更新为 'verify'，human_gate 更新为 'blocked'

Given 已有 Change 记录的 current_stage 为 accepted
When 迁移脚本执行
Then current_stage 更新为 'verify'，human_gate 更新为 'need_archive_confirm'

### FR-04: Agent 驱动流转规则

Given Change 的 current_stage 为 draft
When 创建完成
Then 自动 dispatch intake agent 分析需求

Given intake agent 判断需求明确
When AgentRun 完成
Then current_stage = propose，dispatch propose agent

Given intake agent 判断需求不明确
When AgentRun 完成
Then current_stage = brainstorm，human_gate = need_requirement_input

### FR-05: propose 文档确认 Gate

Given propose agent 完成四件套生成
When AgentRun 状态为 completed
Then current_stage = propose，human_gate = need_proposal_review
And 不会自动进入 plan

### FR-06: proposal-review API

Given current_stage = propose 且 human_gate = need_proposal_review
When POST /changes/{id}/proposal-review { decision: "approve" }
Then current_stage = plan，dispatch plan agent，human_gate = none

Given current_stage = propose 且 human_gate = need_proposal_review
When POST /changes/{id}/proposal-review { decision: "revise", comment: "..." }
Then dispatch propose agent 并携带 comment，human_gate = none

Given current_stage = propose 且 human_gate = need_proposal_review
When POST /changes/{id}/proposal-review { decision: "unclear" }
Then current_stage = brainstorm，human_gate = need_requirement_input

### FR-07: plan 文档确认 Gate

Given plan agent 完成计划生成
When AgentRun 状态为 completed
Then current_stage = plan，human_gate = need_plan_review
And 不会自动进入 execute

### FR-08: plan-review API

Given current_stage = plan 且 human_gate = need_plan_review
When POST /changes/{id}/plan-review { decision: "approve" }
Then current_stage = execute，dispatch execute agent，human_gate = none

Given current_stage = plan 且 human_gate = need_plan_review
When POST /changes/{id}/plan-review { decision: "replan", comment: "..." }
Then dispatch plan agent 并携带 comment

Given current_stage = plan 且 human_gate = need_plan_review
When POST /changes/{id}/plan-review { decision: "back_to_propose" }
Then current_stage = propose，dispatch propose agent

Given current_stage = plan 且 human_gate = need_plan_review
When POST /changes/{id}/plan-review { decision: "back_to_brainstorm" }
Then current_stage = brainstorm，human_gate = need_requirement_input

### FR-09: execute 完成自动 verify

Given execute agent 完成
When AgentRun 状态为 completed
Then 自动 dispatch verify agent，current_stage = verify，human_gate = none

### FR-10: verify 自动修复闭环

Given verify agent 完成
When AgentRun 状态为 completed 且验证通过
Then current_stage = verify，human_gate = need_human_test

Given verify agent 完成
When AgentRun 状态为 completed 且验证不通过
And 自动修复次数 < 3
Then dispatch quick agent 修复，修复后自动重新 dispatch verify

Given verify agent 完成
When AgentRun 状态为 completed 且验证不通过
And 自动修复次数 >= 3
Then current_stage = verify，human_gate = blocked

### FR-11: human-test API

Given current_stage = verify 且 human_gate = need_human_test
When POST /changes/{id}/human-test { result: "pass" }
Then current_stage = archive，human_gate = need_archive_confirm

Given current_stage = verify 且 human_gate = need_human_test
When POST /changes/{id}/human-test { result: "bug", comment: "..." }
Then dispatch quick agent

Given current_stage = verify 且 human_gate = need_human_test
When POST /changes/{id}/human-test { result: "doc_mismatch", comment: "..." }
Then current_stage = propose，dispatch propose agent

### FR-12: 前端按 gate 渲染交互

Given Change 详情页加载
When 读取 human_gate 值
Then 按 human_gate 值渲染对应的操作面板（非技术阶段名）
And 操作面板按钮为业务语义（确认通过/提出修改/退回等）

### FR-13: 简化新建变更

Given 用户点击新建变更
When 填写需求描述（必填）和模块（可选）
Then 创建 Change（current_stage=draft, human_gate=none）
And 自动 dispatch intake agent

### FR-14: 归档 Gate

Given current_stage = archive 且 human_gate = need_archive_confirm
When 所有检查项通过
Then 用户可确认归档
And 归档后 current_stage = archived，human_gate = none

## 非功能需求

- **兼容性**：旧数据通过迁移脚本映射，行为不变
- **可回退**：迁移脚本是 ADD COLUMN + UPDATE，回退为 DROP COLUMN
- **幂等性**：review API 重复调用不重复 dispatch（检查 active AgentRun）
- **可测试**：所有 gate 转换有单元测试覆盖
