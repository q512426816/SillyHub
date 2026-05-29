---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 管理员 | 配置策略和查看审计 |
| 开发者 | 推进 Change/Task 状态 |
| Reviewer | 审批高风险操作 |
| Agent | 请求工具调用和状态推进 |

## 功能需求

### FR-01: Router 统一挂载

Given 后端启动
When 查询 OpenAPI 或调用模块 API
Then workflow、agent、tool_gateway、git_gateway、runtime、knowledge 的入口可用

### FR-02: Workflow 状态流转

Given Task 处于 draft
When 请求进入 ready
Then Workflow service 校验必要条件后完成流转

### FR-03: Spec Guardian 门禁

Given Task 关联 Workspace 缺少有效 SpecWorkspace
When 请求执行
Then Spec Guardian 拒绝执行并返回诊断

### FR-04: Policy 校验

Given Agent 请求高风险 shell 操作
When Policy 评估结果为 require_approval
Then 操作进入审批，不直接执行

### FR-05: AuditLog

Given 用户批准一个操作
When 决策保存
Then AuditLog 记录操作者、对象、动作、结果和时间

## 非功能需求

- 安全性：默认拒绝未知高风险工具。
- 可测试：状态机、Policy、Audit、Router 挂载都有测试。
- 可观测：所有拒绝结果包含可读 reason。
