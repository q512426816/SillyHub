# 决策台账（Decisions）— 工作台待办分页 + 切换用户

author: qinyi
created_at: 2026-07-24T08:45:00

---

## D-001@v1 — 待办分页用独立后端端点

- **type**: architecture
- **status**: accepted
- **source**: brainstorm 方案对比（方案 A vs B 客户端切片）
- **question**: 「我的待办」分页用独立分页端点，还是前端对 summary.todos 客户端切片？
- **answer**: 用独立后端端点 `GET /workbench/todos` 返回 `PageResp`。
- **normalized_requirement**: 待办分页 total 必须准确；问题待办无上限，客户端切片 total 失真且 summary 职责膨胀，故用独立端点。
- **impacts**: 后端新增端点；`_derive_todos` 去除 top20 改全量+切片；前端 TodoListPanel 自带 fetch。
- **evidence**: design.md §5.1 / §7.1 / §7.4
- **priority**: high

---

## D-002@v1 — 可见用户按经理角色分口径

- **type**: requirement
- **status**: accepted
- **source**: 用户在方案确认时细化（"部门经理看自己所在部门及下属部门全部人员；项目/开发/业务经理看其经理项目下的项目组成员；多项目去重并集"）
- **question**: 切换用户时，可切换的用户范围如何界定？
- **answer**: 按经理角色类型分口径——部门经理 → Organization 子树成员；项目/开发/业务经理 → manager 项目（不含部门经理角色项目）的 PpmProjectMember.user_id；兼具则并集；super_admin → 全部 active 用户。
- **normalized_requirement**: 部门经理管部门（org 子树含下属部门），其他经理管项目（项目组成员），不混用单一口径。
- **impacts**: service 新增 `_visible_user_ids`；查 `PpmProjectMember.role_name` 拆分 + `UserOrganization` + `_descendant_ids`。
- **evidence**: design.md §7.3 / FR-3
- **priority**: high

---

## D-003@v1 — WorkbenchSummary 移除 todos 字段

- **type**: schema
- **status**: accepted
- **source**: D-001 导致 todos 走独立端点后，summary 不再需要 todos
- **question**: summary 是否仍返回 todos？
- **answer**: 移除 `WorkbenchSummary.todos`，summary 只留 metrics。
- **normalized_requirement**: 职责瘦身；未上线无需历史兼容（CLAUDE.md 规则 11）。
- **impacts**: 后端 schema 变；前端 types 同步；TodoListPanel 不再从 summary 取 todos。
- **evidence**: design.md §8 / §9
- **priority**: medium

---

## D-004@v1 — 切换用户覆盖「我的任务」表

- **type**: requirement
- **status**: accepted
- **source**: 用户强调"切换工作台后里面查询接口要以切换用户展示"
- **question**: 切换用户后，工作台「我的任务」表是否也跟随目标用户？
- **answer**: 是。`/personal-task-plan/page` 加可选 target_user_id（权限同 workbench），切换后任务表按目标用户取数，避免"切了人任务还是我的"割裂。
- **normalized_requirement**: 工作台内所有查询接口（profile/指标/日历/待办/任务表）切换后均按 target_user 返回。
- **impacts**: task/router.py + service 加 target_user_id；前端 WorkbenchTaskTable 透传 targetUserId。
- **evidence**: design.md §5.2 / R-05 / 用户确认原话
- **priority**: high

---

## D-005@v1 — can_view_others 放 profile 响应

- **type**: ux
- **status**: accepted
- **source**: 前端需知是否显示「切换用户」入口
- **question**: 前端如何判断当前用户能否切换？
- **answer**: profile 响应新增 `can_view_others: bool`（反映**登录人**能力，与 target 无关），前端据此显隐切换控件。
- **normalized_requirement**: 非 manager/非 super 隐藏入口；目标用户 profile 也带该字段（始终反映登录人能力）。
- **impacts**: WorkbenchProfile += can_view_others；前端 ?? 兜底旧响应。
- **evidence**: design.md §7.2 / FR-4
- **priority**: medium
