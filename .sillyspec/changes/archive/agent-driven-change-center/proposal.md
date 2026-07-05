---
author: WhaleFall
created_at: 2026-06-04 10:40:22
---

# Proposal

## 动机

SillyHub 是 SillySpec 的平台化系统，核心价值是让 Agent 自动推进变更全生命周期。当前变更中心是「人工手动点击每个阶段按钮」的审批流，不符合「Agent 驱动、人只确认」的产品定位。

## 关键问题

### 痛点 1：阶段按钮是技术概念，不是业务操作

用户看到「propose」「plan」「execute」「verify」等按钮，需要理解 SillySpec 流程才能操作。应该改为「确认文档」「确认计划」「测试通过」等业务语义操作。

### 痛点 2：Agent 和人没有明确分工

当前 `current_stage` 混用了「Agent 在做什么」和「等人在做什么」两种语义。例如 `propose` 阶段可能正在等 Agent 生成文档，也可能在等人确认文档——无法区分。

### 痛点 3：创建变更后流程断裂

用户创建变更后需要手动选择阶段并触发 Agent。没有「创建后自动分析需求并路由」的能力。

### 痛点 4：verify 没有自动修复闭环

verify 失败后直接交给人工，没有自动修复机制。应该是 Agent 自动修复并重新验证，达到上限后才阻塞。

## 变更范围

1. 统一 `current_stage` 为 SillySpec 技能阶段 + 新增 `human_gate` 字段
2. 移除 `rework_required` 和 `accepted` 旧阶段
3. 新增 3 个 Review Gate API（proposal-review、plan-review、human-test）
4. 创建变更后自动 dispatch intake agent
5. verify 自动修复闭环（最多 3 轮）
6. 前端按 `human_gate` 渲染业务语义操作按钮
7. 清理旧状态和旧逻辑

## 不在范围内

- 多人协同评审（多人同时 review 同一文档）
- 文档版本 diff（多版本文档对比）
- 附件上传
- 复杂权限矩阵（RBAC 不变，只调整角色在 transition 中的权限）
- AgentRun 取消（kill 已有，但取消后状态回滚不做）
- verify 自动修复多轮的详细策略（先做基础闭环，复杂场景后续迭代）

## 成功标准（可验证）

1. 新建变更只填需求描述即可创建，Agent 自动分析并路由
2. propose 完成后暂停等待人工确认，不会自动进入 plan
3. plan 确认通过后自动触发 execute，不需人工点击
4. verify 不通过自动修复并重新验证，超过 3 次才阻塞
5. 人工测试发现 BUG 触发 quick，文档不符回 propose
6. 前端不再暴露技术阶段名，所有操作都是业务语义
7. 旧数据迁移后状态语义不变（rework_required → verify + blocked）
