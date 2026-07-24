---
author: qinyi
created_at: 2026-07-24T08:55:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 普通用户 | 非经理、非超管；只能看自己工作台，无切换入口 |
| 部门经理 | `PpmProjectMember.role_name` 含「部门经理」；可切换到自己所在部门及下属部门成员 |
| 项目/开发/业务经理 | `role_name` 含对应经理角色；可切换到其经理项目下的项目组成员 |
| 超级管理员 | `is_platform_admin` 或持 `super_admin` 角色；可切换到全部用户 |

## 功能需求

### FR-01: 我的待办分页（WEB + APP）
覆盖决策：D-001@v1, D-003@v1

Given 工作台「我的待办」区域
When 用户打开/翻页
Then 调用 `GET /workbench/todos?page=&page_size=`，默认每页 10 条，返回 `PageResp`（items + total + page + page_size），底部分页器可上一页/下一页，badge 显示 total。

Given 待办总数 > 10
When 在第 1 页点「下一页」
Then 展示第 2 页 10 条（切片正确），页码显示「第 2/N 页 · 共 total 条」。

Given 待办为空
When 打开工作台
Then 显示空态「暂无待办」，不报错。

Given APP 端工作台
When 打开
Then 出现「我的待办」卡片（当前缺失），带分页（上一页/下一页 + 页码）。

### FR-02: 切换查看他人工作台（WEB + APP）
覆盖决策：D-004@v1, D-005@v1

Given 当前用户是经理或 super_admin（`can_view_others=true`）
When 在个人信息区点「切换用户」并选某成员
Then 工作台 profile/指标/日历/待办/任务表全部以该目标用户数据返回并展示；顶部出现提示条「正在查看 XX 的工作台 · [返回我自己]」。

Given 已切换到他人
When 点「返回我自己」
Then `target_user_id` 清空，全部数据回到当前登录人。

Given 当前用户非经理非超管（`can_view_others=false`）
When 打开工作台
Then 不显示「切换用户」入口；即使前端强行传 `target_user_id=他人`，后端返回 403。

### FR-03: 可见用户口径（按经理角色分口径）
覆盖决策：D-002@v1

Given 当前用户是「部门经理」
When 打开切换列表
Then 列表 = 自己所属 Organization（部门）及其下属部门（`{oid} | _descendant_ids(oid)` 子树）的全部成员。

Given 当前用户是「项目/开发/业务经理」
When 打开切换列表
Then 列表 = 自己承担这些经理角色的项目（`manager_project_ids` 中 role_name 含该角色的项目）下的全部项目组成员（多项目去重并集）。

Given 当前用户兼具部门经理 + 其他经理角色
When 打开切换列表
Then 列表 = 部门子树成员 ∪ 项目组成员（并集，去重）。

Given 当前用户是 super_admin
When 打开切换列表
Then 列表 = 全部 `status=active` 用户。

Given 部门经理但无 UserOrganization 记录
When 打开切换列表
Then 部门子树为空，仅可能含项目组成员（若无则只有自己）；UI 显示可用项。

### FR-04: 权限收口（越权拦截）
覆盖决策：D-002@v1, D-005@v1

Given 非超管用户对 workbench 任一端点或 `/personal-task-plan/page` 传 `target_user_id=不在可见集的用户`
When 后端处理
Then `_resolve_target_user` 返回 403「无权查看该用户工作台」，绝不返回该用户数据。

Given 超管用户传任意 `target_user_id`
When 该用户存在
Then 返回该用户数据；不存在则 404。

Given 任一端点不传 `target_user_id`（或传自己）
When 处理
Then 行为与旧版完全一致（兼容）。

Given `/personal-task-plan/page` 传 `target_user_id`
When 处理
Then **仅**经 `_resolve_target_user` 校验后取 `target.id` 任务；**禁止**用 data_scope（data_scope 按 viewer 项目集过滤行，语义不符）。

## 非功能需求

- **兼容性**：`target_user_id` 全部可选，不传 = 旧行为；`can_view_others` 前端 `??` 兜底。
- **可回退**：本项目未上线，`WorkbenchSummary` 去 todos 无需历史兼容（CLAUDE.md 规则 11）。
- **可测试**：可见用户算法 / 分页 / target 透传 / 403 越权均有单测；前端 todo 分页、切换交互单测。
- **无 DB 迁移**：纯 DTO + 查询逻辑变更。
- **跨平台**：前后端代码兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 待办分页用独立后端端点（非客户端切片） |
| D-002@v1 | FR-03, FR-04 | 可见用户按经理角色分口径（部门→org子树 / 其他→项目成员 / 并集） |
| D-003@v1 | FR-01 | WorkbenchSummary 去 todos，职责瘦身 |
| D-004@v1 | FR-02 | 切换覆盖含「我的任务」表（personal-task-plan 加 target） |
| D-005@v1 | FR-02, FR-04 | can_view_others 放 profile 响应，前端显隐入口 |

无未覆盖决策（剩余风险 R-01~R-05 见 design.md §10，均有应对）。
