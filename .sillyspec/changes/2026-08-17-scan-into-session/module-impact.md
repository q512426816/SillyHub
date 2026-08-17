---
author: qinyi
created_at: 2026-08-17 14:10:00
---

# 模块影响分析（Module Impact）— 扫描统一到会话

> 依据：design.md「文件变更清单」+ plan.md 任务列表；模块映射来自 `.sillyspec/docs/backend/modules/_module-map.yaml` 与 `.sillyspec/docs/frontend/modules/_module-map.yaml`（根 monorepo 映射仅到子项目粒度，本表采用子项目细粒度模块）。本表为首版，execute/verify 阶段按实际代码变更更新，archive 阶段终审。

## 影响矩阵

| 模块 | 影响类型 | 文件 | 说明 |
|---|---|---|---|
| backend/agent | 修改 | `backend/app/modules/agent/service.py` | start_scan_dispatch 的 AgentSession 补绑 workspace_id（task-01） |
| backend/agent | 修改 | `backend/app/modules/agent/router.py` | _assemble_workspace_session_items 组装点补 mode（task-03） |
| backend/workspace | 修改 | `backend/app/modules/workspace/service.py` | scan_generate 返回三元组含 session_id（task-02） |
| backend/workspace | 修改 | `backend/app/modules/workspace/schema.py` | ScanGenerateResponse 补 session_id（task-02） |
| backend/workspace | 修改 | `backend/app/modules/workspace/router.py` | scan_generate 端点响应回填 session_id（task-02） |
| backend/daemon | 修改 | `backend/app/modules/daemon/schema.py` | AgentSessionListItem 补 mode（task-03） |
| backend/change | 修改 | `backend/app/modules/change/router.py` | list_change_sessions 组装点补 mode（task-03） |
| backend/build | 修改 | `backend/openapi.json` | gen:types 产物（task-04） |
| backend/agent | 修改 | `backend/app/modules/agent/tests/*` | workspace_id / mode 断言适配（task-09） |
| backend/workspace | 修改 | `backend/app/modules/workspace/tests/*` | session_id 三元组解包断言（task-09） |
| backend/change | 修改 | `backend/app/modules/change/tests/*` | 变更级列表 mode 断言（task-09） |
| frontend/app-workspace-pages | 删除 | `frontend/src/app/(dashboard)/workspaces/[id]/agent/` | 智能体控制台页（task-08） |
| frontend/app-workspace-pages | 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 快捷导航删「智能体」（task-08） |
| frontend/app-workspace-pages | 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx` | NAV_ITEMS 删「智能体」（task-08） |
| frontend/components-workspace-config | 修改 | `frontend/src/components/workspace-config-card.tsx` | 扫描成功后跳转会话页、移除内嵌面板（task-05） |
| frontend/components-daemon | 修改 | `frontend/src/components/daemon/session-list-layout.tsx` | SessionListEntry 补 kind + 徽标渲染（task-07） |
| frontend/lib-api | 修改 | `frontend/src/lib/api-types.ts` | gen:types 产物 session_id/mode（task-04） |
| frontend/lib-daemon | 修改 | `frontend/src/lib/daemon.ts` | AgentSessionListItem 手写类型补 mode（task-04） |
| frontend/lib-menu-permissions | 修改 | `frontend/src/lib/menu-permissions.ts` | 删除「智能体控制台」菜单组（task-08） |
| frontend/lib-menu-permissions | 修改 | `frontend/src/lib/__tests__/menu-permissions.test.ts`、`__tests__/permission.test.ts` | agent 菜单断言清理（task-09） |
| unmapped（frontend） | 修改 | `frontend/src/components/workspace-session-section.tsx` + `__tests__/workspace-session-section.test.tsx` | 深链 attach + 徽标传递（task-06/07）——映射文件未收录，建议后续 scan 刷新 |
| unmapped（frontend） | 删除 | `frontend/src/lib/use-agent-runs.ts` + `lib/__tests__/use-agent-runs.test.tsx` | 仅 agent 页使用（task-08）——映射文件未收录 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend/agent.md` | 更新 agent 模块卡（scan 会话绑定 workspace_id、mode 组装点） | pending |
| `modules/backend/workspace.md` | 更新 workspace 模块卡（scan_generate 返回 session_id） | pending |
| `modules/backend/daemon.md` | 更新 daemon 模块卡（AgentSessionListItem.mode） | pending |
| `modules/backend/change.md` | 更新 change 模块卡（变更级会话 mode） | pending |
| `modules/frontend/app-workspace-pages.md` | 更新模块卡（删除智能体控制台页、导航变更） | pending |
| `modules/frontend/components-daemon.md` | 更新模块卡（session-list-layout kind 徽标） | pending |
| `modules/frontend/components-workspace-config.md` | 更新模块卡（扫描跳转会话页） | pending |
| `modules/frontend/lib-daemon.md` | 更新模块卡（AgentSessionListItem.mode 手写类型） | pending |
| `modules/frontend/lib-menu-permissions.md` | 更新模块卡（删除智能体控制台菜单组） | pending |
| `_module-map.yaml` | 无变化（未增删模块；unmapped 文件待 scan 刷新收录） | skipped |
