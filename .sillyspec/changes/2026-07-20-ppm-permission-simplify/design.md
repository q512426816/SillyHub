---
author: qinyi
created_at: 2026-07-20 12:32:27
---

# 设计文档（Design）— 精简 PPM 权限（移除操作类权限，仅保留菜单类权限并去掉接口校验）

## 1. 背景

PPM（项目与问题管理）模块当前定义了 25 个 `ppm:*` 权限（`backend/app/modules/auth/permissions.py` 的 `Permission` 枚举 PPM_* 成员），其中：

- **菜单类 8 个**（`read` / `view` / `stat` 级）：被前端 `frontend/src/lib/menu-permissions.ts` 用于控制 14 个 ppm 菜单条目的显隐。
- **操作类 17 个**（`write` / `delete` / `export` / `assign` 级）：仅在后端 6 个 ppm router 做 endpoint 校验。

调研确认这 17 个操作权限**实际是摆设**：

- 仅 `platform_admin` 角色默认持有全部 ppm 权限（`seed_platform_admin_role` 启动兜底 + 迁移 `202607041000` 种子），普通角色一个都没有（`test_non_system_role_has_no_ppm_permissions` 守护）。
- 前端 ppm 页面的"新增/删除"按钮**不依赖** `ppm:*` 权限，改用 `is_platform_admin` + 所有权判断。
- 因此操作权限的存在只增加系统复杂度（枚举/迁移/测试三处同步负担 + admin picker 列表冗长），无实际访问控制价值。

用户要求："有关 ppm: 的权限全部去掉，只保留菜单权限就行。" 并确认两点：①菜单开关保留现有粒度（不动 menu-permissions.ts 的菜单结构）；②后端接口完全去掉权限校验。并选择"彻底删除"方案（非保留定义）。

## 2. 设计目标

- 从代码（枚举）、数据库（`role_permissions` 授权）、测试三处**彻底删除** 17 个 ppm 操作权限。
- 后端 6 个 ppm router 去掉 `require_permission_any(Permission.PPM_*)` 校验，改为仅认证（登录即可调用）。
- 保留 8 个 ppm 菜单权限，前端菜单显隐控制不变。
- 清理因删权限产生的悬空引用（project-members 菜单的 `ppm:project:write`）。

## 3. 非目标

- **不**新增任何 ppm 权限（YAGNI）。
- **不**改变前端 ppm 页面的按钮控制逻辑（现状 `is_platform_admin` + 所有权保持不变）。
- **不**改变菜单粒度（不合并成总开关、不增减菜单条目）。
- **不**做历史兼容（项目未上线，规则 11 允许重置数据）。
- **不**动 ppm 业务逻辑（数据范围查询、CRUD 行为不变——与进行中的 ppm-data-scope 变更正交）。

## 4. 拆分判断

单一目标、任务数 <10、无多角色视图 / 跨页状态流转 / 批量特征（详见 step 5 评估）。按普通单变更推进，不拆分、不走批量模式、不生成 MASTER.md。

## 5. 总体方案

分 5 个 Phase（对应 plan 的 Wave 划分）：

### Phase 1 — 后端权限枚举精简

`backend/app/modules/auth/permissions.py`：删除 17 个 PPM_* 操作权限枚举成员，保留 8 个菜单权限成员。`Permission.group` property 不变（仍按 `ppm:` 前缀归 `PermissionGroup.PPM`）。

- 保留：`PPM_PROJECT_READ` `PPM_CUSTOMER_READ` `PPM_PLAN_READ` `PPM_PROBLEM_READ` `PPM_TASK_READ` `PPM_WORKHOUR_READ` `PPM_WORKHOUR_STAT` `PPM_KANBAN_VIEW`
- 删除：`PPM_PROJECT_WRITE/DELETE/EXPORT` `PPM_CUSTOMER_WRITE/DELETE/EXPORT` `PPM_PLAN_WRITE/DELETE/EXPORT` `PPM_PROBLEM_WRITE/DELETE/EXPORT` `PPM_TASK_WRITE/DELETE/EXPORT` `PPM_WORKHOUR_WRITE` `PPM_KANBAN_ASSIGN`

### Phase 2 — 后端 6 router 去校验（D-002）

`project` / `plan` / `task` / `problem` / `kanban` / `workbench` 六个 router：所有端点的 `Depends(require_permission_any(Permission.PPM_*))` → `Depends(get_current_principal)`（仅认证不授权，保留 JWT + API key 双路径）。集中声明的类型别名（如 task router 的 `TaskWriteUser` 等）统一替换为 `AuthUser = Annotated[User, Depends(get_current_principal)]`，散落声明的端点（plan/problem）内联替换。

### Phase 3 — 数据库迁移（双轨，D-003）

- **修改旧种子迁移** `202607041000_seed_ppm_permissions.py`：`PPM_PERMISSIONS` 清单从 25 项删到 8 项（仅菜单权限）。新环境/重置环境从头跑 alembic 时只 seed 8 个。
- **新增清理迁移** `20260720_drop_ppm_operation_permissions.py`（down_revision 接 execute 时确认的当前唯一 head）：`upgrade` 执行 `DELETE FROM role_permissions WHERE permission IN (<17 个被删权限>)`；`downgrade` 对称回植到 `platform_admin`。针对已部署 DB 清理多余授权。

### Phase 4 — 测试更新（D-004）

- `backend/tests/modules/auth/test_ppm_permissions.py`：`EXPECTED_PPM_PERMISSIONS` 从 25 项改 8 项；count 断言 `==25` → `==8`；`test_platform_admin_has_all_ppm_permissions` 改为只断言 8 个菜单权限。
- **Design Grill 核实**：ppm 模块**无 router/接口测试**（`backend/tests/modules/ppm/` 目录不存在，全仓 grep `/api/ppm` 零命中），故无"403 断言"需改。R-04 相应调整为"补最小冒烟测试弥补回归守护空缺"。

### Phase 5 — 前端清理 + daemon 重生成（D-001 / D-004）

- `frontend/src/lib/menu-permissions.ts`：project-members 菜单（L362-365）`permissions` 数组删除悬空的 `{ key: "ppm:project:write" }` 条目，只留 `ppm:project:read`（D-001）。菜单显隐不变（`canSeeMenu` 任一命中 → 有 read 即可见）。
- `frontend/src/components/admin-role-permission-picker.tsx`：按枚举/菜单映射渲染，删枚举后自动少列被删权限（execute 时确认数据源，若读 menu-permissions 需同步）。
- `sillyhub-daemon/src/api-types.ts`：生成产物，execute 后重新生成（确认生成命令，只接受 ppm 权限相关 diff）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/permissions.py | 删 17 个 PPM_* 操作权限枚举成员，留 8 个菜单权限 |
| 修改 | backend/app/modules/ppm/project/router.py | 端点 Depends(require_permission_any) → Depends(get_current_principal) |
| 修改 | backend/app/modules/ppm/plan/router.py | 同上 |
| 修改 | backend/app/modules/ppm/task/router.py | 同上，类型别名统一为 AuthUser |
| 修改 | backend/app/modules/ppm/problem/router.py | 同上 |
| 修改 | backend/app/modules/ppm/kanban/router.py | 同上 |
| 修改 | backend/app/modules/ppm/workbench/router.py | 同上（原复用 PPM_TASK_READ） |
| 修改 | backend/migrations/versions/202607041000_seed_ppm_permissions.py | PPM_PERMISSIONS 清单 25→8 |
| 新增 | backend/migrations/versions/20260720_drop_ppm_operation_permissions.py | 清理迁移 DELETE 17 条 role_permissions |
| 修改 | backend/tests/modules/auth/test_ppm_permissions.py | EXPECTED 25→8、count 断言、admin 持有权限断言 |
| 新增（建议） | backend/tests/modules/ppm/test_router_smoke.py | 最小冒烟：登录可访问 ppm 接口 200、未登录 401（弥补 ppm 模块无测试的回归守护空缺，对应 R-04 / AC-4） |
| 修改 | frontend/src/lib/menu-permissions.ts | project-members 菜单删悬空 ppm:project:write |
| 重生成 | sillyhub-daemon/src/api-types.ts | 重新生成（ppm 权限类型减少） |

## 7. 接口定义

router 端点签名变化（所有 ppm 端点统一模式）：

改前：
```python
user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROJECT_WRITE))]
```
改后：
```python
user: Annotated[User, Depends(get_current_principal)]
```

`get_current_principal`（`backend/app/core/auth_deps.py:154`）已存在，为双路径（JWT Bearer / X-API-Key）仅认证依赖，返回 `User`，不查权限。沿用它保证 daemon API key 调用路径不受影响。

集中别名统一：
```python
AuthUser = Annotated[User, Depends(get_current_principal)]
```

## 7.5 生命周期契约表

本次变更**不涉及** session / lease / agent_run / daemon lifecycle / state transition / claim / heartbeat 等生命周期事件。`sillyhub-daemon` 仅以其 `api-types.ts` 生成产物身份出现（重新生成），不改变 daemon 的生命周期、状态机或与 backend 的事件契约。故无需生命周期契约表。

## 8. 数据模型

**无表结构变更**。权限是 Python 枚举（`Permission`），不入库；授权记录在 `role_permissions` 表（`role_id` + `permission` 字符串，无独立 `permissions` 表，已核实 `202607041000` 迁移只操作 `role_permissions`）。

数据层变化：新清理迁移 `DELETE FROM role_permissions WHERE permission IN (17 个)`，清理 `platform_admin` 及任何手动获得这些权限的角色授权记录。

## 9. 兼容策略

- 项目未上线（规则 11），允许重置开发/测试数据，不要求历史兼容。
- API 行为**向后不兼容**：ppm 接口从"需 ppm 权限"变为"登录即可"。回退路径 = downgrade 新清理迁移（回植 17 权限）+ revert router 改动 + revert 枚举。
- 旧种子迁移改清单后，已 stamp 到 `202607041000` 的环境不会重跑该迁移，由新清理迁移负责清理已部署数据；新环境从头跑则直接 seed 8 个。
- 前端菜单显隐逻辑不变（仍由 8 个菜单权限驱动），普通用户行为无感知。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | ppm 接口安全语义降级（登录即可调增删改） | P1 | 实际影响小：仅 platform_admin 曾有权限 + 普通用户看不到 ppm 菜单（菜单靠 read 控制）+ 前端按钮靠 is_platform_admin/所有权；内部系统可接受。用户已知情同意。 |
| R-02 | 新迁移 down_revision 接错致 alembic 多 head | P0 | execute 前用 `cd backend && uv run alembic heads` 确认当前唯一 head，新迁移 down_revision 接它。 |
| R-03 | daemon api-types 重生成引入无关 diff | P2 | execute 时确认生成命令，重生成后核对 diff 只含 ppm 权限相关；若无关 diff 过多则跳过重生成（api-types 是派生产物，不阻塞主流程）。 |
| R-04 | ppm 模块无 router 测试，删校验后无自动化回归守护 | P1 | execute 补最小冒烟测试（登录 200 / 未登录 401）覆盖 AC-4；或 verify 阶段手动 curl 验证 `/api/ppm/*` 端点。 |
| R-05 | admin-role-permission-picker 数据源若读 menu-permissions.ts，project-members 悬空 write 删除后显示异常 | P2 | execute 时读 picker 确认数据源（枚举 vs menu 文件），按需同步。 |
| R-06 | 旧种子迁移改清单后，CI/已部署环境 alembic 校验 | P2 | 改清单是改 upgrade 内容，已 stamp 环境不重跑无影响；新清理迁移负责数据清理。 |

## 11. 决策追踪

当前版本决策（详见 `decisions.md`）：

- **D-001@v1** project-members 菜单悬空 `ppm:project:write` 引用清理 → 覆盖于 §5 Phase 5、§6 文件清单。
- **D-002@v1** 6 router 改用 `get_current_principal` 仅认证 → 覆盖于 §5 Phase 2、§7 接口定义。
- **D-003@v1** 迁移双轨（改旧 seed 清单 + 新清理迁移）→ 覆盖于 §5 Phase 3、§8 数据模型、§9 兼容策略。
- **D-004@v1** 测试 / seed_platform_admin_role / picker / daemon 四项同步 → 覆盖于 §5 Phase 4/5。
- **方案选择：彻底删除（A）** → 贯穿全文，决定枚举 / 迁移 / 测试三处全清。

无未解决决策。剩余风险见 §10。

## 12. 自审

- ✅ 需求覆盖：删 17 操作权限 + 留 8 菜单权限 + 6 router 去校验，覆盖用户两点决策 + 方案 A。
- ✅ Grill 覆盖：D-001~D-004 全部在 §5/§6/§7/§8/§9 引用。
- ✅ 约束一致：遵循 CONVENTIONS（ruff/mypy/中文/迁移可重置/双层 hook）。
- ✅ 真实性：文件路径、类名（`Permission` / `get_current_principal`）、表名（`role_permissions`）、方法签名均来自真实代码调研。
- ✅ YAGNI：不新增权限、不改前端按钮、不动业务逻辑。
- ✅ 验收标准：见下方（具体可测试）。
- ✅ 非目标清晰：§3 明确 5 项不做。
- ✅ 兼容策略：§9 说明回退路径 + 不向后兼容点。
- ✅ 风险识别：§10 共 6 项风险含 P0~P2 对策。
- ✅ 生命周期契约表：§7.5 说明不涉及，无需生成。

### 验收标准（AC）

- **AC-1** `Permission` 枚举 PPM_* 成员数 25→8，`test_ppm_permissions.py` EXPECTED + `count==8` 通过。
- **AC-2** 6 个 ppm router 中 `require_permission_any` 引用 grep 零命中。
- **AC-3** 新清理迁移 upgrade 后，`SELECT COUNT(*) FROM role_permissions WHERE permission IN (17 个)` == 0。
- **AC-4** ppm 接口：登录用户返回 200，未登录返回 401。
- **AC-5** 前端 project-members 菜单对持有 `ppm:project:read` 的用户正常可见。
- **AC-6** admin 角色权限 picker 不再列出被删的 17 个操作权限。
- **AC-7** backend lint（`uv run ruff check . && uv run ruff format --check . && uv run mypy app`）通过；frontend `pnpm typecheck` 通过。
- **AC-8** backend `tests/modules/auth/test_ppm_permissions.py` 通过 + 新增 ppm 接口冒烟测试通过（若 execute 补，覆盖 AC-4）。
