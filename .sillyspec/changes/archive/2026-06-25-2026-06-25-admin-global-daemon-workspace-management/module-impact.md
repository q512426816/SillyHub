---
author: qinyi
created_at: 2026-06-25 23:22:00
change: 2026-06-25-admin-global-daemon-workspace-management
analyzer: impact-analyzer
---

# 模块影响分析 — 平台管理员全局守护进程与工作区管理

## 分析依据

- **声明范围**：proposal.md 变更范围 + design.md §6 文件变更清单（18 项）
- **任务范围**：plan.md task-01~11 allowed_paths
- **真实变更**：`git diff --name-only b3e1b181^1 b3e1b181`（merge commit 相对 main 侧 parent 63c7f44b），共 20 个源码文件
- **以 git diff 为准**（真实 > 声明）：声明清单用通配（`tests/*`），真实落地为具体测试文件，范围一致无遗漏、无越界

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend/daemon | 数据结构变更 + 接口变更 + 逻辑变更 | `model.py`, `schema.py`, `router.py`, `service.py`, `runtime/service.py`, `tests/test_runtime_admin_management.py` | model 新增 `display_alias`；schema 新增 OwnerRead/DaemonRuntimeRead(display_alias+owner)/DaemonRuntimeUpdate/DaemonRuntimeListResponse；router 新增 `GET /runtimes/page`(先于 `/{runtime_id}`)+`PATCH /runtimes/{id}`，get/disable/enable/delete 透传 `is_platform_admin`；runtime/service 新增 `list_runtimes_page`(owner JOIN+ilike 筛选)、`update_runtime`(display_alias_set 三态)、跨 owner 管理；facade service 透传 | false |
| backend/workspace | 数据结构变更 + 接口变更 + 逻辑变更 | `model.py`, `schema.py`, `router.py`, `service.py`, `tests/test_workspace_admin_management.py` | model 新增 `display_alias`；schema WorkspaceUpdate/WorkspaceRead 增加 display_alias + owner(OwnerRead)；router `GET /workspaces` 扩展 q/status/user_id/limit/offset(user_id 仅平台管理员，普通账号仍走 allowed_workspace_ids)；service 新增 `list_with_owner`(owner JOIN+筛选分页)、update 支持 display_alias | false |
| backend/migrations | 新增 | `migrations/versions/202606251900_add_resource_display_alias.py` | 为 daemon_runtimes、workspaces 增加 nullable `display_alias VARCHAR(200)`；单一 head 202606251900 | false |
| frontend/lib-daemon | 接口变更 | `lib/daemon.ts` | 新增 `listDaemonRuntimesPage`、`updateDaemonRuntime`、OwnerRead/DaemonRuntimeRead(display_alias+owner)/DaemonRuntimeListResponse/DaemonRuntimeUpdate 类型；保留旧 `listDaemonRuntimes()` 数组兼容(FR-06) | false |
| frontend/lib-workspaces | 接口变更 | `lib/workspaces.ts` | `listWorkspaces(params)` 支持 q/type/status/user_id/limit/offset；WorkspaceRead 增加 display_alias/owner；UpdateWorkspaceInput 增加 display_alias | false |
| frontend/app-pages | 逻辑变更 | `app/(dashboard)/runtimes/page.tsx`, `app/(dashboard)/workspaces/page.tsx`, `runtimes/page.test.tsx`, `runtimes/__tests__/page-usage.test.tsx`, `lib/__tests__/admin-global-checkpoints.test.ts` | 两页改造：服务端筛选分页(PAGE_SIZE/offset)、平台管理员人员搜索(isPlatformAdmin 控制显隐+listUsers+失败降级)、别名编辑(display_alias trim/null)、卡片 display_alias??name 回退、URL 参数恢复、筛选改重置到第一页 | false |
| frontend/components-shared | 逻辑变更 | `components/workspace-card.tsx` | 卡片标题 display_alias??name 回退；owner 负责人(display_name??email)展示；别名编辑入口(modal 触发) | false |

## 影响类型说明

- **数据结构变更**：daemon_runtimes / workspaces 表新增 display_alias 列（migration + ORM model）
- **接口变更**：新增/扩展 REST 端点（GET /runtimes/page、PATCH /runtimes/{id}、GET /workspaces 筛选参数）+ DTO（OwnerRead 嵌套对象）+ 前端 client 类型契约
- **逻辑变更**：分页查询 + owner JOIN + ilike 搜索 + 权限边界（is_platform_admin 跨 owner）+ 前端筛选分页状态管理 + 卡片别名/owner 展示
- **新增**：migration 文件 + 测试文件

## 未匹配文件

无。所有 20 个 git diff 源码文件均映射到根 _module-map.yaml / backend 子模块映射 / frontend 子模块映射中的模块。

## 决策覆盖映射

| 决策 | 主要影响模块 |
|------|-------------|
| D-001@v1 is_platform_admin 全权限短路 | backend/daemon, backend/workspace |
| D-002@v1 别名独立字段 | backend/daemon, backend/workspace, backend/migrations |
| D-003@v1 人员搜索仅平台管理员 | backend/daemon, backend/workspace, frontend/app-pages |
| D-004@v1 服务端分页+卡片样式 | frontend/app-pages, frontend/components-shared |
| D-005@v1 /page 路由顺序 | backend/daemon |
| D-006@v1 owner 嵌套 OwnerRead | backend/daemon, backend/workspace, frontend/lib-daemon, frontend/lib-workspaces |

## 文档同步建议（供 doc-syncer 角色 Step 3 使用）

以下模块卡片需同步本变更契约（当前未同步，verify-result.md 已记为残留项）：

- `backend/modules/daemon.md`：注意事项补 display_alias / /runtimes/page 路由顺序 / is_platform_admin 跨 owner / owner JOIN
- `backend/modules/workspace.md`：注意事项补 display_alias / 筛选分页参数(user_id 仅 admin) / owner JOIN
- `frontend/modules/lib-daemon.md`：补 listDaemonRuntimesPage / updateDaemonRuntime / 类型契约
- `frontend/modules/lib-workspaces.md`：补 listWorkspaces(params) / display_alias / owner
- `frontend/modules/app-pages.md`：补 /runtimes //workspaces 分页筛选人员别名
- `frontend/modules/components-shared.md`：补 WorkspaceCard 别名/owner/编辑入口

参考 memory `scan-regenerates-module-docs`：融入「注意事项」section，不加变更索引 section。
