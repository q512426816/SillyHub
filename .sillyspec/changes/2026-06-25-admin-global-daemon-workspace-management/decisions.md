---
author: qinyi
created_at: 2026-06-25T17:35:00
---

# decisions.md — 平台管理员全局守护进程与工作区管理

## D-001@v1: 平台管理员沿用 is_platform_admin 全权限短路

- type: architecture
- status: accepted
- source: code/docs
- question: 平台管理员查看和操作全部用户 daemon runtime / workspace 应如何落权限边界？
- answer: 沿用 `auth.rbac.has_permission` 中 `is_platform_admin` 的全权限短路。工作区列表已有平台管理员全量分支；daemon runtime 需要补充列表全量和管理动作跨 owner 分支。普通账号仍使用现有 owner / workspace permission 约束。
- normalized_requirement: 平台管理员可查看全部 daemon runtime / workspace，并可执行卡片上的别名、启用/禁用、删除、重新扫描等既有管理动作；普通账号不能因筛选参数扩大可见范围。
- impacts: [FR-01, FR-02, BE-01, BE-02, BE-03, QA-01]
- evidence: `backend/app/modules/auth/rbac.py`, `backend/app/modules/workspace/router.py`, `backend/app/modules/daemon/router.py`, `backend/app/modules/daemon/runtime/service.py`
- priority: P0

## D-002@v1: 别名独立于资源原始名称

- type: boundary
- status: accepted
- source: user + code
- question: “别名定义”是否直接覆盖 workspace.name / daemon.name？
- answer: 不覆盖原始名称。新增 `display_alias` 作为展示别名，卡片标题和搜索优先使用别名，空值回退原始 `name` / `slug` / `provider`。
- normalized_requirement: 两类资源都支持随时 PATCH `display_alias`，且不会破坏 daemon 注册幂等、workspace scan 解析和既有 slug/name 语义。
- impacts: [FR-03, BE-04, BE-05, FE-03, QA-02]
- evidence: `backend/app/modules/daemon/model.py`, `backend/app/modules/workspace/model.py`, `backend/app/modules/workspace/schema.py`
- priority: P0

## D-003@v1: 人员搜索仅扩展平台管理员全局视图

- type: boundary
- status: accepted
- source: user + code
- question: 人员搜索是否对所有账号开放并改变查询范围？
- answer: 人员筛选控件只在平台管理员视图展示并生效，按 daemon `user_id` / workspace `created_by` 过滤。普通账号可按名称、类型、状态筛选自己可见的数据，传入 `user_id` 也不能越权。
- normalized_requirement: API 支持 `q/type/status/user_id/limit/offset`；`user_id` 只对平台管理员生效，普通账号查询仍受现有 owner / workspace permission 限制。
- impacts: [FR-02, FR-04, BE-02, BE-03, FE-01, FE-02, QA-01]
- evidence: `backend/app/modules/daemon/model.py`, `backend/app/modules/workspace/model.py`, `backend/app/modules/admin/users_service.py`
- priority: P0

## D-004@v1: 页面使用服务端分页，卡片样式对齐既有样式系统

- type: ux
- status: accepted
- source: docs
- question: 两块卡片和分页如何与系统风格一致？
- answer: 使用服务端 `limit/offset` 分页和总数；前端使用现有 `PageContainer`、`Button`、`Badge`、系统 token 风格和 8px 卡片圆角。卡片不嵌套卡片，信息区按 owner / 类型 / 状态 / 路径组织，操作区保持稳定尺寸。
- normalized_requirement: 守护进程与工作区页面都有筛选条、卡片网格、分页器、别名编辑入口和一致状态徽标；移动端一列、桌面两列，文本不溢出。
- impacts: [FR-05, FE-01, FE-02, FE-03, QA-03]
- evidence: `.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`, `.sillyspec/changes/2026-06-25-admin-global-daemon-workspace-management/prototype-admin-global-daemon-workspace-management.html`
- priority: P1
