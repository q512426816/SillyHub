---
author: WhaleFall
created_at: 2026-08-19T14:40:00
---

# 模块影响分析（Module Impact）— /sessions 新建会话工作区选择器

## 变更模块

| 模块 | 影响类型 | 文件 |
|---|---|---|
| frontend_components | 新增组件 | `frontend/src/components/sessions/workspace-session-picker.tsx`（新）、`frontend/src/components/sessions/new-session-form.tsx`（改） |
| frontend_components | 新增测试 | `frontend/src/components/sessions/__tests__/workspace-session-picker.test.tsx`（新）、`frontend/src/components/sessions/__tests__/new-session-form.test.tsx`（新） |
| daemon | 校验逻辑 | `backend/app/modules/daemon/session/service.py`（改，create_session 补 workspace 归属校验） |
| daemon | 测试补充 | `backend/app/modules/daemon/tests/test_session_service.py`（改，归属校验用例） |

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新摘要 | needs_review |
|---|---|---|---|---|
| frontend_components | 新增组件+测试 | components/sessions/workspace-session-picker.tsx（新）、new-session-form.tsx（改）、__tests__/workspace-session-picker.test.tsx（新）、__tests__/new-session-form.test.tsx（新） | 新会话表单顶部新增工作区选择器；选中工作区联动带出绑定 daemon 机器；提交体带 workspace_id；卡片契约摘要 sessions/ 域更新（四选择器→五选择器） | false |
| daemon | 校验逻辑+测试 | modules/daemon/session/service.py、tests/test_session_service.py | create_session 补 workspace 归属校验：workspace_id 非空时经 allowed_workspace_ids（WORKSPACE_READ）校验，不可见抛 404 HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND；卡片 session 契约补校验说明 | false |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| meta.json | 平台同步元数据（auto-sync-from-repo），非业务模块改动 |

## 范围界定（git diff 三重核对结论）

- 本变更代码范围 = 提交 ca99b100（ql-20260819-001），与 tasks.md task-01~06 一一对应。
- 同期提交 3c1243ee（会话列表/面板头部工作区信息显示，ql-20260819-001-b742）、4d040800（移除「结束会话」按钮，ql-20260819-002）为 quick 条目，a61810ea（会话流结构化重构）属变更 2026-08-19-session-stream-ux——均不记入本变更影响面。

## 未影响模块（设计明确排除）

- `workspace`：无新 API，复用现有 `listWorkspaces`、`fetchMyBindings` 端点
- `agent/placement`：lease 创建链路不受影响，workspace_id 已有透传路径
- `sillyhub-daemon/src/daemon.ts`：会话执行链路不受影响，workspace_id 已有消费逻辑

## 依赖关系

- 前端新增组件依赖 `lib/workspaces.ts`（listWorkspaces）和 `lib/workspace-binding.ts`（fetchMyBindings）——两个既有模块，接口稳定
- 后端校验依赖 `workspace/rbac.py`（allowed_workspace_ids）——权限模块，接口稳定
- 无新增跨模块依赖

## 更新结果

| 目标 | 更新内容 | 结果 |
|---|---|---|
| `_module-map.yaml: frontend_components` | main_symbols 补 components/sessions/workspace-session-picker；generated_at 刷新 2026-08-20 | 已同步 |
| `modules/frontend_components.md` | 契约摘要 sessions/ 域：新增 workspace-session-picker 条目、new-session-form 四选择器→五选择器；变更索引补条目 | 已同步 |
| `modules/daemon.md` | 契约摘要（backend 侧）session 域：补 create_session workspace 归属校验说明 | 已同步 |
