---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Proposal

## 动机

Workspace Graph 和 SpecWorkspace 只提供数据与规范资产。平台要真正变成 SillyHub，需要有统一控制面：Workflow 管状态，Spec Guardian 管执行前置条件，Policy 管权限和风险，Tool/Git Gateway 管操作边界，Audit 管追责。

## 关键问题

### 1. 已实现模块未形成统一入口

workflow、agent、tool_gateway、git_gateway、runtime、knowledge 等能力需要在 `backend/app/main.py` 明确挂载和测试，否则前端和后续 Runner 无法稳定调用。

### 2. Change/Task 状态流转缺少硬约束

没有统一 Workflow gate 时，任务可能在规范缺失、审批未完成、权限不足时进入执行。

### 3. 工具调用缺少统一策略层

Shell、Git、文件修改、外部 API 的风险不同，不能只靠 Agent 自觉。

## 变更范围

- 统一挂载已有 control-plane router。
- 明确 Change/Task 状态机和执行前置 gate。
- 引入 Policy Engine 校验 user、workspace、task stage、agent role、tool risk。
- AuditLog 覆盖核心写操作、状态流转和工具调用。
- 为前端提供 approvals / audit / runtime / workflow 的稳定 client。

## 不在范围内（显式清单）

- 不实现 Local Runner daemon。
- 不实现 Knowledge 生命周期。
- 不实现 Server Sandbox Runner。
- 不修改 Workspace Graph 数据结构。

## 成功标准（可验证）

- `backend/app/main.py` 挂载控制面相关 router。
- Change/Task 状态流转只能通过 Workflow service。
- 执行前必须经过 Spec Guardian 和 Policy 校验。
- Tool/Git Gateway 操作写入审计日志。
- 前端工作区页面能访问 approvals、audit、runtime、workflow 入口。
