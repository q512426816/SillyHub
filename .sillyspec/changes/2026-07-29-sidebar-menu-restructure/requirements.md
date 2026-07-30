---
author: qinyi
created_at: 2026-07-30 08:52:19
change: 2026-07-29-sidebar-menu-restructure
---

# 需求规格（Requirements）— SillyHub 侧边栏菜单信息架构重组

## 角色

| 角色 | 说明 |
|---|---|
| 平台管理员 | `is_platform_admin`，全菜单可见；在角色管理中分配 `llm_provider:read` |
| 普通成员 | 被分配角色的用户；菜单可见性由角色权限决定 |
| 开发者 | 实施本变更，维护菜单数据源与测试 |

## 功能需求

### FR-01: 菜单按功能域重组
覆盖决策：D-001@v1, D-006@v1

Given 用户已登录 SillyHub 且处于非 ppm 路径
When 查看侧边栏
Then 菜单按 5 组渲染（工作区/智能体/配置中心/协作治理/系统管理），各菜单项归属符合 design §5.1，且守护进程运行时位于配置中心组。

### FR-02: 我的供应商独立菜单直达
覆盖决策：D-002@v1

Given 用户具有 `llm_provider:read` 权限或为 platform admin
When 点击侧边栏"我的供应商"
Then 直达 `/settings/providers` 页面，可管理自己的供应商（复用 `LlmProviderSection`）。

Given 用户无 `llm_provider:read` 且非 platform admin
When 查看侧边栏
Then 不显示"我的供应商"菜单项。

### FR-03: 技能管理 / MCP 管理独立菜单（平台级）
覆盖决策：D-003@v1

Given 用户具有 `settings:admin` 权限或为 platform admin
When 点击侧边栏"技能管理"或"MCP 管理"
Then 分别直达 `/settings/skills`、`/settings/mcp`（平台级页面）。

### FR-04: 设置页瘦身
覆盖决策：D-004@v1

Given 用户打开 `/settings`
When 页面渲染
Then 仅显示工作区信息/智能体配置/安全策略/集成 4 个 Tab，默认选中工作区信息；无供应商 Tab、无 4 个 EntryCard 卡片入口。

### FR-05: 供应商可见性可分配
覆盖决策：D-002@v1

Given 后端 `permissions.py` 已含 `llm_provider:read`
When 重启后端
Then `seed_platform_admin_role` 自动将该权限绑定至 platform_admin 角色（无需 migration），且角色管理中可为任意角色分配/收回该权限。

### FR-06: 菜单视觉统一
覆盖决策：D-005@v1

Given 侧边栏渲染
When 查看任意菜单项
Then 图标均为 lucide 线条图标（含新增 3 项）、无 emoji；分组间距与选中高亮样式统一；ppm 隔离与 `navHidden` 二级页逻辑保持不变。

## 非功能需求

- 兼容性：现有路由路径不变；新增权限为纯增量，无 `llm_provider:read` 的角色仅看不到新菜单项，无旧行为被破坏。
- 可回退：菜单重排为展示层调整，回退只需还原前端文件；后端权限枚举回退不影响存量数据。
- 可测试：菜单分组/可见性/新页面/设置页瘦身均有对应前端测试；后端权限枚举变更有测试覆盖。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 菜单按功能域重组 5 组 |
| D-002@v1 | FR-02, FR-05 | 供应商独立菜单 + 可分配权限 |
| D-003@v1 | FR-03 | 技能/MCP 平台级 |
| D-004@v1 | FR-04 | 设置页瘦身 |
| D-005@v1 | FR-06 | 视觉统一 |
| D-006@v1 | FR-01 | 守护进程运行时归配置中心 |
