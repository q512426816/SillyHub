---
id: task-11
title: 更新变更文档与模块影响记录，完成 verify 前自检
priority: P1
estimated_hours: 2
depends_on: [task-09, task-10]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-005@v1, D-006@v1]
allowed_paths:
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/**
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/workspace.md
  - .sillyspec/docs/frontend/modules/lib-daemon.md
  - .sillyspec/docs/frontend/modules/lib-workspaces.md
  - .sillyspec/docs/frontend/modules/app-pages.md
  - .sillyspec/docs/frontend/modules/components-shared.md
  - .sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-11.md
author: qinyi
created_at: "2026-06-25 18:10:00"
---

# task-11: 更新变更文档与模块影响记录，完成 verify 前自检

> 本 task 在 task-09/10 验证通过后，同步变更文档与模块影响记录，完成 verify 前自检，准备进入 `sillyspec verify`。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`、`tasks.md`、`decisions.md`（按需） | 勾选已完成 task；补充实现期发现的设计偏差或残余风险，不改已通过 Grill 的核心决策。 |
| 修改 | `.sillyspec/docs/backend/modules/daemon.md` | 注明 daemon runtime 新增 `display_alias`、`/runtimes/page`、PATCH、跨 owner 管理、owner DTO 的影响与注意事项。 |
| 修改 | `.sillyspec/docs/backend/modules/workspace.md` | 注明 workspace `display_alias`、列表筛选分页、owner DTO 的影响与注意事项。 |
| 修改 | `.sillyspec/docs/frontend/modules/lib-daemon.md` | 同步 `listDaemonRuntimesPage`、`updateDaemonRuntime`、`display_alias`/`owner` 类型契约。 |
| 修改 | `.sillyspec/docs/frontend/modules/lib-workspaces.md` | 同步 `listWorkspaces(params)`、`Workspace.display_alias/owner`、`UpdateWorkspaceInput.display_alias`。 |
| 修改 | `.sillyspec/docs/frontend/modules/app-pages.md`、`components-shared.md` | 同步 `/runtimes`、`/workspaces` 页面与 `WorkspaceCard` 的筛选/分页/人员/别名能力。 |
| 修改 | 本 task 文件 | 记录自检结果。 |

## 覆盖来源

| 来源 | 本 task 落点 |
|---|---|
| FR-01~FR-06、D-001~D-006 | 在 tasks.md/plan.md 勾选完成；模块文档同步契约。 |
| design §6 文件变更清单 | 模块文档逐项反映实际落点。 |

## 实现要求

1. **勾选任务完成**：在 `plan.md` 与 `tasks.md` 中勾选 task-01~11 的完成状态（execute 完成后由进度系统或本 task 标记）。
2. **记录实现偏差**：若实现期出现与 design 的偏差（如 `formatCache`、字段命名微调），在 `design.md` 末尾或 `decisions.md` 补一条说明，不改已 accepted 的 D-001~D-006 核心；无法覆盖的决策写入残余风险。
3. **模块文档同步**（参考 memory `scan-regenerates-module-docs`：scan 会重生成简洁 module-card，手动追加要融入「注意事项」section，不加变更索引 section）：
   - `backend/modules/daemon.md`：注意事项补「runtime 新增 nullable `display_alias VARCHAR(200)`；`/runtimes/page` 固定路由必须在 `{runtime_id}` 前；`get/disable/enable/delete/update` 接收 `is_platform_admin` 跨 owner；列表 owner 由 JOIN users 填充，详情可为 None」。
   - `backend/modules/workspace.md`：注意事项补「workspace `display_alias`；列表 `q/type/status/user_id/limit/offset`（user_id 仅平台管理员，普通账号仍走 allowed_workspace_ids）；owner 由 created_by JOIN users 填充」。
   - `frontend/modules/lib-daemon.md`：补 `listDaemonRuntimesPage`、`updateDaemonRuntime`、`DaemonRuntimeRead.display_alias/owner` 契约与旧 `listDaemonRuntimes()` 数组兼容约定。
   - `frontend/modules/lib-workspaces.md`：补 `listWorkspaces(params)`、`Workspace.display_alias/owner`、`UpdateWorkspaceInput.display_alias`。
   - `frontend/modules/app-pages.md`：补 `/runtimes`、`/workspaces` 服务端分页 + 筛选 + 平台管理员人员搜索 + 别名编辑。
   - `frontend/modules/components-shared.md`：补 `WorkspaceCard` 别名标题/owner/编辑入口。
4. **verify 前自检**（对照 design 自审表 + plan 全局验收标准）：
   - 平台管理员可分页查看全部 daemon runtime/workspace 并按人员过滤。
   - 普通账号仅在可见范围内过滤；传他人 `user_id` 不扩大范围。
   - 两类资源可保存/清空/展示 `display_alias`，空别名回退。
   - `GET /api/daemon/runtimes` 仍数组；`/runtimes/page` 返回分页对象且不被 `{runtime_id}` 抢占。
   - `GET /api/workspaces` 保持 `{items,total}`。
   - 两页有服务端分页 + 筛选条 + 平台管理员人员搜索 + 别名编辑 + 系统风格卡片。
   - 后端模块测试、前端类型/lint/相关测试通过；未通过项有残余风险记录。
5. **决策覆盖核对**：D-001~D-006 全部有实现落点；若某决策部分未覆盖，写入残余风险而非掩盖。
6. **archive 准备**：确认变更目录下文档齐全（proposal/requirements/design/decisions/tasks/plan/tasks/task-01~11.md/prototype），为 `sillyspec verify` 与后续 archive 做好准备。

## 接口定义

本 task 无代码接口，只产出文档更新与自检记录。

## 边界处理

1. **不改已 accepted 决策**：D-001~D-006 核心 answer 不改；偏差用追加说明记录。
2. **模块文档格式**：融入「注意事项」，不加变更索引 section（memory：scan 会删变更索引）。
3. **不夸大完成度**：未实现/有环境限制的项明确记为残余风险。
4. **决策不丢失**：无法覆盖的 D-xxx@vN 写入残余风险或非目标。
5. **文档头部**：新增/修改的 `.md` 文件保留 `author`/`created_at` frontmatter（CLAUDE.md 铁律）。
6. **范围控制**：只改本变更文档与受影响模块文档；不碰无关模块文档。

## 非目标

- 不修改任何生产代码、测试代码、migration、前端实现（由 task-03~10 提供）。
- 不重写 design 核心方案。
- 不归档变更（archive 由后续 `sillyspec archive` 流程负责，需 verify 通过）。
- 不更新无关模块文档。

## 参考

- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/design.md`（§6 文件清单、§12 自审表）、`requirements.md`、`decisions.md`、`plan.md`（全局验收标准、覆盖矩阵）。
- `.sillyspec/docs/backend/modules/daemon.md`、`workspace.md`。
- `.sillyspec/docs/frontend/modules/lib-daemon.md`、`lib-workspaces.md`、`app-pages.md`、`components-shared.md`。
- `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/tasks/task-01.md`~`task-10.md`。
- memory：scan-regenerates-module-docs（模块文档格式约定）。

## TDD 步骤

1. 汇总 task-09/10 的验证结果与残余风险。
2. 勾选 plan/tasks 完成状态。
3. 按文件清单逐项同步模块文档「注意事项」。
4. 对照 design 自审表 + plan 全局验收标准逐条自检。
5. 决策覆盖核对，记录残余风险。
6. 准备 `sillyspec verify`。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | plan.md/tasks.md | task-01~11 完成状态已勾选；偏差有记录。 |
| AC-02 | backend 模块文档 | daemon.md/workspace.md「注意事项」反映 `display_alias`/分页/owner/跨 owner/路由顺序。 |
| AC-03 | frontend 模块文档 | lib-daemon/lib-workspaces/app-pages/components-shared 反映新 client/页面/卡片能力。 |
| AC-04 | design 自审表对照 | 各项「通过」且有实现/测试证据；未通过项有残余风险。 |
| AC-05 | plan 全局验收标准对照 | 7 条标准逐条核对，有结论。 |
| AC-06 | 决策覆盖 | D-001~D-006 全有落点；未覆盖项入残余风险。 |
| AC-07 | verify 就绪 | 文档齐全，自检通过，可进入 `sillyspec verify`。 |
