---
author: WhaleFall
created_at: 2026-09-20 17:56:39
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-20-workspace-member-visibility

## 背景

工作区是成员制资产：一个工作区只有其成员（`user_workspace_roles` 表中的角色绑定）和平台管理员应能看到、能进入。但当前 RBAC 判定链（`backend/app/modules/auth/rbac.py:107-132` `has_permission`）中，**平台级角色授权**（管理中心的用户-角色绑定，`user_roles` 表）在带 `workspace_id` 判定时会以「具体业务权限」放行（rbac.py:124-126）——即平台级持有 `workspace:read` 等于对所有工作区有读权限。

ql-20260917-007 曾据此把列表端点（`backend/app/modules/workspace/router.py:351-362`）对齐为「平台级 workspace:read → 全量可见」，修复了当时「列表看不到、却能收通知、能点进内容」的三处口径割裂。该裁决的前提是平台级授权=真实跨工作区权限；但产品语义上平台级角色（如系统角色 developer）承担的是「功能入口」职责（菜单可见性、平台级端点、个人资产），不应顺带授予全部工作区内容。

实测（2026-09-20，本机 Docker 库 `platform`）：账号 180490（胡斌，非平台管理员、非任何工作区成员）仅因绑定 developer 系统角色（携带平台级 `workspace:read`）即看到全部 5 个工作区并可点进——用户确认该行为不正确。

## 设计目标

1. 工作区内容可见性回归成员制：非成员（且非平台管理员/不持 `platform:admin`）看不到工作区列表条目，直连工作区 URL 得 403。
2. 平台级权限降级为纯功能入口：持平台级 `workspace:read` 仍能看菜单、打开列表页（空列表），但无任何工作区内容效力。
3. 全权限统一：上述收紧对**所有** Permission 枚举生效，不按权限白名单区分（消除「开了菜单顺带拿到全部工作区内容」的暗道）。
4. 三处口径联动一致：列表可见性 ≡ 工作区内容访问 ≡ 工作区事件通知收件人（避免重蹈 ql-20260917-007 修过的反向割裂）。

## 非目标

- 不改 `/api/auth/me` 权限聚合（`collect_permissions_everywhere`）、菜单门控、前端页面——入口语义与 UI 不动（空列表已有空态）。
- 不改权限枚举、角色种子、表结构——无 schema/数据迁移。
- 不处理列表卡片「客户端路径」显示创建者全局路径的问题（D-004，另开 quick）。
- 不引入「平台级巡视员」类跨工作区只读角色的新机制（若未来需要，走新决策，见 D-003 退役判据）。

## 拆分判断

单变更闭环：三触点（判定链/列表端点/通知收件人）是同一语义的三个投影，拆开会制造中间态口径割裂（正是本变更要消灭的问题类型），故不拆分、不走批量模式。

## 总体方案

**Wave 1（语义核心）**：`rbac.has_permission` 收紧——`workspace_id is not None` 时平台级段仅 `platform:admin` 放行；`workspace_id is None`（`require_permission_any` 功能入口路径）行为不变。`is_platform_admin` 短路保留。

**Wave 2（口径对齐）**：
- 列表端点 `list_workspaces`：ql-20260917-007 平台分支的条件从「`workspace:read` 或 `platform:admin`」收窄为「仅 `platform:admin`」；`user.is_platform_admin` 分支不变。
- `rbac.list_user_ids_with_permission` 段 2（平台级授予段）：匹配权限从 `[target, admin_perm]` 收窄为 `[admin_perm]`——工作区事件广播收件人 = 成员（段 1）+ `platform:admin` 持有者（段 2）+ `is_platform_admin` 用户（段 3）。

**Wave 3（测试收口）**：反转 ql-20260917-007 的 `test_platform_grant_list.py` 断言为新技术义；新增判定链收紧专项测试；回归通知收件人测试。

### 行为对照（用户视角）

| 角色 | 改动前 | 改动后 |
|---|---|---|
| developer 角色用户（非成员，如 180490） | 看到全部工作区，可点进 | 菜单仍可见，列表为空，直连 URL 403 |
| 工作区成员 | 正常 | 不变 |
| 平台管理员（`is_platform_admin`，如 admin2）/ 持 `platform:admin` 角色 | 全量 | 不变 |
| 创建工作区的用户 | 自动成为 workspace_owner（`backend/app/modules/workspace/service.py:161/182/246` `_ensure_creator_as_owner`） | 不变（创建即成员，新语义下创建者不受影响） |

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/rbac.py | `has_permission`（:107-132）平台段收紧：带 workspace_id 时仅 `platform:admin` 放行；不带 workspace_id 保持现状。`list_user_ids_with_permission` 段 2（:179-194）匹配权限收窄为仅 `admin_perm`。仅改内部判定逻辑，无对外字段/DTO/接口签名变动 |
| 修改 | backend/app/modules/workspace/router.py | `list_workspaces`（:292-379）平台分支（:351-362）条件收窄为仅 `platform:admin`；docstring 同步改写（ql-20260917-007 段落注明被本变更收窄）。无接口签名/响应体变动 |
| 修改 | backend/app/modules/workspace/tests/test_platform_grant_list.py | ql-20260917-007 断言语义反转：平台级 `workspace:read` 非成员 → 空列表 + 内容 403 + 不收通知；`platform:admin` / `is_platform_admin` → 全量（三口径一致性断言） |
| 新增 | NEW:backend/app/modules/auth/tests/test_rbac_workspace_scope.py | 判定链收紧专项测试：非成员+平台级任意权限（workspace:read / mcp:read 等）→ `has_permission(ws)` False；持 `platform:admin` → True；`is_platform_admin` → True；无 workspace 上下文（`require_permission_any` 语义）→ 平台级权限仍放行 |

## 接口定义

无新增/修改对外 API。内部函数签名不变，仅判定逻辑变化：

```python
# backend/app/modules/auth/rbac.py — has_permission 新语义伪码
async def has_permission(session, *, user, permission, workspace_id) -> bool:
    if user.is_platform_admin:                      # 短路保留
        return True
    platform_perms = await collect_permissions_platform(session, user_id=user.id)
    holds_platform_admin = Permission.PLATFORM_ADMIN.value in platform_perms
    if workspace_id is None:                        # 功能入口路径：行为不变
        return holds_platform_admin or permission.value in platform_perms
    if holds_platform_admin:                        # 工作区内：平台段仅 platform:admin
        return True
    perms = await collect_permissions(session, user_id=user.id, workspace_id=workspace_id)
    return permission.value in perms or Permission.PLATFORM_ADMIN.value in perms

# list_user_ids_with_permission 段 2：RolePermission.permission.in_([admin_perm])
#（原 [target, admin_perm]——工作区广播不再因平台级持有 target 而收件）
```

## 生命周期契约表

不涉及生命周期契约（本变更仅收紧权限判定，不触及 session/lease/agent_run/daemon 状态流转；文中 `agent_session:read` 是权限标识符，非会话生命周期事件）。

## 数据模型

无表结构/字段变更。`users` / `roles` / `user_roles` / `user_workspace_roles` / `role_permissions` 表与既有数据全部沿用；权限缓存（`core/permission_cache`）键值结构不变（权限集合不变，变的只是集合的解释方式，无需失效存量缓存）。

## 兼容策略（brownfield 必填）

- **平台管理员零感知**：`is_platform_admin` / `platform:admin` 路径行为完全不变。
- **成员零感知**：仅靠工作区内角色获权的用户（现存绝大多数）判定路径不变。
- **行为变化面**（有意为之，见行为对照表）：以平台级业务权限访问非成员工作区的用户（当前实测仅 180490 一人，源于 developer 系统角色）失去该访问。
- **回退路径**：三个触点均为小逻辑改动，revert 三个文件即恢复 ql-20260917-007 语义；无数据迁移故无回退残留。
- **不改变的 API/表结构**：全部对外端点签名、响应体、OpenAPI、前端类型（`api-types.ts` 无需再生成）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 三触点不同步产生新口径割裂（列表看得见进不去 / 收到通知看不了内容） | P0 | Wave 2 同批落地；`test_platform_grant_list.py` 改造为三口径一致性断言（列表 ⊆ 可访问 ⊆ 通知收件人同源判定） |
| R-02 | 存量测试依赖「平台级权限穿透工作区」的隐式行为，回归面超预期 | P1 | execute 阶段先全量扫 `has_permission` 间接测试（grep 已定位 auth/workspace/notification/agent/daemon 等模块），逐个核实是「入口语义」（保留）还是「工作区穿透」（同步改断言）；仅跑相关测试（CLAUDE.md 规则 0） |
| R-03 | 用户预期落差：developer 等角色用户从「能看全部」变「空列表」，误以为功能坏了 | P2 | 空列表为既有空态；如需提示语（「未被加入任何工作区」）走后续 quick，不在本变更扩前端范围 |
| R-04 | 无前端文件改动，无 UI 原型（分级依据：纯后端权限语义变更，行为以测试断言表达） | P2 | 记录跳过原因即可（本行即记录） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标 1/2、总体方案 Wave 2、行为对照表 | 已覆盖 |
| D-002@v1 | 设计目标 3、接口定义 has_permission 伪码（无权限白名单） | 已覆盖 |
| D-003@v1 | 总体方案三 Wave 划分、文件变更清单四文件 | 已覆盖 |
| D-004@v1 | 非目标第 3 条 | 已覆盖 |

无未解决决策。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（决策追踪表四条全覆盖）
- [x] 生命周期关键词豁免短语已紧邻「生命周期契约表」标题
- [x] UI 原型分级核对：无前端文件改动，跳过原因记入风险登记 R-04
- [x] 无「⚠️ 自审存疑」项
