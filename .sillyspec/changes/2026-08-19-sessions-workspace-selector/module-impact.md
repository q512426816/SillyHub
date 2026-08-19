---
author: WhaleFall
created_at: 2026-08-19T14:40:00
---

# 模块影响分析 — sessions-workspace-selector

## 变更模块

| 模块 | 影响类型 | 文件 |
|---|---|---|
| daemon（frontend client） | 新增组件 | `frontend/src/components/sessions/workspace-session-picker.tsx`（新）、`new-session-form.tsx`（改） |
| daemon（session service） | 校验逻辑 | `backend/app/modules/daemon/session/service.py`（改） |

## 未影响模块（设计明确排除）

- `workspace`：无新 API，复用现有 `listWorkspaces`、`fetchMyBindings` 端点
- `agent/placement`：lease 创建链路不受影响，workspace_id 已有透传路径
- `sillyhub-daemon/src/daemon.ts`：会话执行链路不受影响，workspace_id 已有消费逻辑

## 依赖关系

- 前端新增组件依赖 `lib/workspaces.ts`（listWorkspaces）和 `lib/workspace-binding.ts`（fetchMyBindings）——两个既有模块，接口稳定
- 后端校验依赖 `workspace/rbac.py`（allowed_workspace_ids）——权限模块，接口稳定
- 无新增跨模块依赖
