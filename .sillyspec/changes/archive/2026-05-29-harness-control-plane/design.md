---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Design

## 架构决策

### ADR-01: Workflow 是状态流转唯一入口

Change/Task 的状态修改应通过 Workflow service 完成，不由页面或 Agent 直接改字段。

### ADR-02: Spec Guardian 是执行前置门禁

执行前检查 SpecWorkspace、任务状态、审批状态、Workspace 关系和测试命令配置。

### ADR-03: Policy Engine 统一处理工具风险

Policy 输入包含 user、workspace、task、agent role、tool、operation、risk level。输出 allow / deny / require_approval。

### ADR-04: Audit 是平台级能力

Git Gateway、Tool Gateway、Workflow 状态变更、approval 操作都写审计记录。

## API 设计

- `POST /api/workspaces/{id}/workflow/transitions`
- `GET /api/workspaces/{id}/approvals`
- `POST /api/workspaces/{id}/approvals/{approval_id}/decision`
- `POST /api/tool-gateway/evaluate`
- `POST /api/git-gateway/operations`
- `GET /api/workspaces/{id}/audit`

## 文件变更清单

- `backend/app/main.py`
- `backend/app/modules/workflow/fsm.py`
- `backend/app/modules/workflow/spec_guardian.py`
- `backend/app/modules/workflow/service.py`
- `backend/app/modules/workflow/router.py`
- `backend/app/modules/tool_gateway/service.py`
- `backend/app/modules/git_gateway/service.py`
- `backend/app/modules/runtime/router.py`
- `backend/app/modules/knowledge/router.py`
- `backend/app/modules/policy/`（新增）
- `backend/app/modules/audit/`（新增或复用现有日志表）
- `frontend/src/lib/workflow.ts`
- `frontend/src/lib/approvals.ts`
- `frontend/src/lib/audit.ts`

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| Policy 太早复杂化 | 开发阻塞 | 先实现 allow/deny/approval 三态和少量内置规则 |
| Router 挂载后暴露未完成能力 | 前端调用失败 | 加契约测试和 feature flag |
| Audit 与 operation log 重叠 | 数据重复 | 明确 operation log 是细节，audit 是用户可读事件 |
