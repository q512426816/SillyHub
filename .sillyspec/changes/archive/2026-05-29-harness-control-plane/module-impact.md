---
author: qinyi
created_at: 2026-05-30 23:15:00
---

# 模块影响分析

## 变更：2026-05-29-harness-control-plane

> brainstorm-only 变更，代码已在 main 中实现。module-map.yaml 不存在，仅基于声明范围分析。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| workflow | 逻辑变更 / 接口变更 | backend/app/modules/workflow/fsm.py, service.py, router.py | Workflow 状态机收口，唯一状态流转入口 |
| workflow | 新增 | backend/app/modules/workflow/spec_guardian.py | Spec Guardian 执行前置门禁 |
| policy | 新增 | backend/app/modules/policy/ | Policy Engine 统一工具风险评估 |
| audit | 新增 | backend/app/modules/audit/ | AuditLog 平台级审计能力 |
| tool_gateway | 调用关系变更 | backend/app/modules/tool_gateway/service.py | 接入 Policy Engine + Audit |
| git_gateway | 调用关系变更 | backend/app/modules/git_gateway/service.py | 接入 Audit |
| main | 配置变更 | backend/app/main.py | 控制面 router 统一挂载 |
| agent | 逻辑变更 | backend/app/modules/agent/adapters/, context_builder.py | Agent 适配器与上下文构建器 |
| frontend | 接口变更 | frontend/src/lib/workflow.ts, approvals.ts, audit.ts | 控制面前端 client |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|
| backend/app/modules/runtime/router.py | Runtime router 挂载 |
| backend/app/modules/knowledge/router.py | Knowledge router 挂载 |

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| git_gateway.md | 追加变更索引 | ✅ 已更新 |
| workflow.md | 不存在，brainstorm-only 不新建 | ⏭ 跳过 |
| policy.md | 不存在，brainstorm-only 不新建 | ⏭ 跳过 |
| audit.md | 不存在，brainstorm-only 不新建 | ⏭ 跳过 |
| tool_gateway.md | 不存在 | ⏭ 跳过 |
| agent.md | 不存在 | ⏭ 跳过 |
| main.md | 不存在 | ⏭ 跳过 |
