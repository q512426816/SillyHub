---
author: WhaleFall
created_at: 2026-09-20 18:00:00
---

# 提案书（Proposal）

## 动机

工作区是成员制资产，但当前 RBAC 判定链允许**平台级角色授权**穿透进任意工作区：平台级持有 `workspace:read` 即对全部工作区有读权限。实测（2026-09-20）账号 180490（胡斌，非平台管理员、非任何工作区成员）仅因绑定 developer 系统角色（携带平台级 `workspace:read`）即看到全部 5 个工作区并可点进内容。用户确认该行为不正确，需要回归成员制。

## 关键问题

1. **权限语义混淆**：平台级角色（如 developer）承担的是「功能入口」职责（菜单可见性、平台级端点、个人资产），但 `has_permission` 带工作区上下文判定时以具体业务权限放行平台级授予（`backend/app/modules/auth/rbac.py:124-126`），等于「开了菜单顺带拿到全部工作区内容」。
2. **三处口径联动放大**：ql-20260917-007 基于上述语义把列表端点对齐为「平台级 workspace:read → 全量可见」（`backend/app/modules/workspace/router.py:351-362`），工作区事件通知收件人也含平台级持权限者（`backend/app/modules/auth/rbac.py:179-194` 段 2）——暗道在三个入口同时敞开。
3. **数据治理治标不治本**：只摘 developer 角色的 `workspace:read`（或解除 180490 绑定）能救当前一例，但任何管理员在角色管理页再授一次该权限，暗道重开；且 developer 角色还带 `mcp:read` 等双用途权限，无法靠剥离角色权限根治。

## 变更范围

- `rbac.has_permission` 收紧：带 `workspace_id` 判定时平台级段仅 `platform:admin` 放行（`is_platform_admin` 短路保留），对全部 Permission 枚举生效；不带 `workspace_id`（功能入口路径）行为不变。
- 列表端点 `list_workspaces` 平台分支收窄为仅 `platform:admin`。
- 通知收件人查找 `list_user_ids_with_permission` 段 2 收窄为仅 `platform:admin` 持有者。
- 测试：反转 ql-20260917-007 的 `test_platform_grant_list.py` 断言 + 新增判定链收紧专项测试。

## 不在范围内（显式清单）

- 不改 `/api/auth/me` 权限聚合、菜单门控、前端页面（空列表已有空态）。
- 不改权限枚举、角色种子、表结构（无 schema/数据迁移，权限缓存结构不变）。
- 不处理列表卡片「客户端路径」显示创建者全局路径的问题（D-004，另开 quick）。
- 不引入「平台级巡视员」类跨工作区只读角色机制。

## 成功标准（可验证）

- 非成员（不持 `platform:admin`、非 `is_platform_admin`）即使持平台级 `workspace:read`：列表为空、直连工作区 URL 403、不收该工作区事件通知。
- 工作区成员与平台管理员（`is_platform_admin` / 持 `platform:admin`）行为与改动前完全一致。
- 平台级权限的功能入口效力不变：`require_permission_any` 路径、菜单可见性、`/api/auth/me` 聚合与改动前一致。
- 三个触点测试全绿：判定链专项测试 + `test_platform_grant_list.py`（反转后）+ 通知收件人回归。
