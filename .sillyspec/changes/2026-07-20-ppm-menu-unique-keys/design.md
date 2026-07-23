---
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 设计文档（Design）— PPM 菜单权限 key 独立化（每菜单一个专属 key）

## 1. 背景

承接刚 commit 的 `2026-07-20-ppm-permission-simplify`（ccfab86a，删 17 个摆设操作权限、留 8 个菜单/读权限）。该变更 D-001 假设"8 个菜单 key 够用"，但实际 **14 个 PPM 菜单共享 8 个 key**，导致 4 个 key 被多个菜单共用，admin 无法独立控制每个菜单显隐：

| 共享 key | 共用菜单 |
|---|---|
| `ppm:project:read` | 项目、项目成员、干系人（3 个） |
| `ppm:plan:read` | 项目计划、计划节点、里程碑明细（3 个） |
| `ppm:problem:read` | 问题清单、问题变更（2 个） |
| `ppm:task:read` | 工作台、任务计划（2 个） |

用户反馈："每个菜单都要独立的 KEY，现在有好多都一致的，不好区分。" 并确认按推荐方案 14 个菜单各配一个独立 key。

## 2. 设计目标

- 14 个 PPM 菜单**各配一个专属权限 key**，admin 授权时可任意组合控制每个菜单显隐。
- 后端 `Permission` 枚举新增 9 个菜单 key（8→14），保留现有 5 个 key 给对应菜单。
- 前端 `menu-permissions.ts` 14 个菜单 key 重映射到各自专属 key。
- platform_admin 自动获得全部 14 个新菜单 key（依赖 `seed_platform_admin_role` 启动遍历枚举兜底，已有逻辑）。
- 测试同步（test_ppm_permissions EXPECTED / test_permissions count / menu-permissions.test.ts mirror）。

## 3. 非目标

- **不**删除任何现有 key（包括将变悬空的 `ppm:plan:read`/`ppm:problem:read`/`ppm:task:read`，保留不破坏数据，YAGNI 删除）。
- **不**改后端 ppm router 鉴权（上个变更已改 `get_current_principal` 仅认证，菜单 key 只用于前端菜单显隐，后端不做 key 校验）。
- **不**改菜单结构（仍是 14 个 PPM 菜单，不增不减菜单条目）。
- **不**做历史兼容（项目未上线，规则 11 允许重置数据）。
- **不**动 ppm 业务逻辑、前端按钮逻辑、daemon。

## 4. 拆分判断

单一目标（菜单 key 细化）、任务数 <10、无多角色视图/跨页状态流转/批量特征。按普通单变更推进，不拆分、不走批量模式。

## 5. 总体方案

### 14 菜单 → 14 专属 key 映射表（方案 A，用户已确认）

| 菜单 menuKey | 专属 key | 状态 |
|---|---|---|
| ppm-workbench（工作台） | `ppm:workbench:view` | 🆕 新增 |
| ppm-projects（项目） | `ppm:project:read` | ✅ 保留 |
| ppm-customers（客户） | `ppm:customer:read` | ✅ 保留 |
| ppm-project-members（项目成员） | `ppm:project-member:read` | 🆕 新增 |
| ppm-project-stakeholders（干系人） | `ppm:project-stakeholder:read` | 🆕 新增 |
| ppm-project-plans（项目计划） | `ppm:project-plan:read` | 🆕 新增 |
| ppm-plan-nodes（计划节点） | `ppm:plan-node:read` | 🆕 新增 |
| ppm-milestone-details（里程碑明细） | `ppm:milestone-detail:read` | 🆕 新增 |
| ppm-problem-list（问题清单） | `ppm:problem-list:read` | 🆕 新增 |
| ppm-problem-changes（问题变更） | `ppm:problem-change:read` | 🆕 新增 |
| ppm-task-plans（任务计划） | `ppm:task-plan:read` | 🆕 新增 |
| ppm-work-hours（工时） | `ppm:work-hour:read` | ✅ 保留 |
| ppm-work-hour-statistics（工时统计） | `ppm:work-hour:stat` | ✅ 保留 |
| ppm-kanban（看板） | `ppm:kanban:view` | ✅ 保留 |

**新增 9 个枚举成员**：`PPM_WORKBENCH_VIEW` `PPM_PROJECT_MEMBER_READ` `PPM_PROJECT_STAKEHOLDER_READ` `PPM_PROJECT_PLAN_READ` `PPM_PLAN_NODE_READ` `PPM_MILESTONE_DETAIL_READ` `PPM_PROBLEM_LIST_READ` `PPM_PROBLEM_CHANGE_READ` `PPM_TASK_PLAN_READ`

**保留 5 个**：`PPM_PROJECT_READ` `PPM_CUSTOMER_READ` `PPM_WORKHOUR_READ` `PPM_WORKHOUR_STAT` `PPM_KANBAN_VIEW`

**悬空保留 3 个**（无菜单直接引用，但不删）：`PPM_PLAN_READ` `PPM_PROBLEM_READ` `PPM_TASK_READ` —— 仍归 `PermissionGroup.PPM`（`group` property 按 `ppm:` 前缀），picker 会列但不影响功能。

命名参照原系统（RuoYi）细分权限语义（`pm:project-member:read` → `ppm:project-member:read` 等），贴合菜单名。

### Phase 1 — 后端枚举扩容

`backend/app/modules/auth/permissions.py`：新增 9 个枚举成员（值见上表）。`group` property 不变（`ppm:` 前缀归 PPM）。**枚举 PPM 成员 8→17**（14 个被菜单直接引用 + 3 个悬空旧 key 保留），**总枚举 53→62**。

### Phase 2 — seed 迁移清单 + platform_admin 补种

- `backend/migrations/versions/202607041000_seed_ppm_permissions.py`：`PPM_PERMISSIONS` 清单 8→14（加 9 个新 key）。新环境从头 seed 14 个。
- platform_admin 获得新 key：依赖 `seed_platform_admin_role`（service.py）启动遍历 `Permission` 枚举幂等补种（已有逻辑，`test_platform_admin_seed_grants_all_ppm_permissions` 守护）。已部署环境重启 backend 即补，**无需手写补种迁移**。

### Phase 3 — 前端菜单 key 重映射

`frontend/src/lib/menu-permissions.ts`：14 个 PPM 菜单的 `permissions` 数组按映射表改为各自专属 key（单元素数组，每个菜单一个 key）。

### Phase 4 — 测试 + openapi 同步

- `test_ppm_permissions.py`：`EXPECTED_PPM_PERMISSIONS` 8→17（加 9 个新成员）。
- `test_permissions.py`：`test_permission_count_is_53` → `_is_62`（总枚举 +9）。
- `menu-permissions.test.ts`：`BACKEND_PERMISSION_KEYS` mirror 加 9 个新 key（总 54→63，PPM 8→17）；project-members/stakeholders/project-plans/plan-nodes/milestone/problem-list/problem-changes/workbench 等菜单断言改为各自专属 key。
- `backend/openapi.json` 重生成（ppm 权限枚举 8→14）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/auth/permissions.py | +9 个 PPM 菜单 key 枚举成员 |
| 修改 | backend/migrations/versions/202607041000_seed_ppm_permissions.py | PPM_PERMISSIONS 清单 8→14 |
| 修改 | backend/tests/modules/auth/test_ppm_permissions.py | EXPECTED 8→17 |
| 修改 | backend/tests/modules/auth/test_permissions.py | count 53→62 |
| 修改 | frontend/src/lib/menu-permissions.ts | 14 菜单 key 重映射专属 |
| 修改 | frontend/src/lib/__tests__/menu-permissions.test.ts | mirror 54→63（PPM 8→17）+ 各菜单专属 key 断言 |
| 重生成 | backend/openapi.json | ppm 权限枚举 8→14 |

## 7. 接口定义

**无接口变更**。菜单 key 仅用于前端菜单显隐（`canSeeMenu` 命中任一 key → 可见），后端 ppm router 不做 key 校验（上个变更已改 `get_current_principal`）。picker 按 `Permission` 枚举渲染，新增 9 个会自动多列。

## 7.5 生命周期契约表

本变更**不涉及** session/lease/agent_run/daemon lifecycle/state transition。仅扩权限枚举 + 菜单映射数据，无生命周期事件。无需契约表。

## 8. 数据模型

**无表结构变更**。权限是 Python 枚举不入库；授权在 `role_permissions` 表（`role_id` + `permission` 字符串）。

数据层变化：
- 新环境：seed migration 直接 seed 14 个 PPM key 给 platform_admin。
- 已部署环境：重启 backend 时 `seed_platform_admin_role` 遍历枚举补种 9 个新 key（幂等，只加缺失）。
- 旧 key（含悬空 3 个）的 `role_permissions` 记录不动（不删）。

## 9. 兼容策略

- 项目未上线（规则 11），不要求历史兼容。
- 前端菜单显隐：旧 role_permissions 无新 key 的角色 → 对应菜单不显示。platform_admin 重启后补齐。
- 旧 key 保留：悬空的 `plan:read`/`problem:read`/`task:read` 不删，已授权角色不受影响。
- 回退路径：revert 枚举+9 + menu-permissions 重映射 + seed 清单。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 已部署环境不重启 backend → platform_admin 缺新 key → 菜单不显示 | P2 | 部署文档注明需重启 backend（seed 兜底补种）；或手动跑 seed。项目未上线可重置。 |
| R-02 | 悬空旧 key 留在枚举，picker 列出无菜单对应的 key 误导 admin | P3 | 可接受（admin 不勾即可）；后续若嫌乱可补删迁移。YAGNI 现在不删。 |
| R-03 | menu-permissions.test.ts mirror 与 backend 枚举漂移 | P2 | mirror 加 9 个新 key 同步；count 断言 54→63 守护。 |
| R-04 | seed_platform_admin_role 补种幂等性 | P1 | 已有 test_platform_admin_seed_grants_all_ppm_permissions 守护（seed 后拥有全部枚举）；execute 验证补 9 个新 key。 |

## 11. 决策追踪

- **D-001** 方案 A（每菜单专属 key，命名贴合菜单名）→ §5 映射表。
- **D-002** 悬空旧 key（plan/problem/task:read）保留不删 → §3 非目标、§5、R-02。
- **D-003** platform_admin 补种依赖 seed_platform_admin_role 启动兜底，不写补种迁移 → §5 Phase 2、§8、R-01/R-04。
- **D-004** 命名参照原系统细分权限语义 → §5 映射表。

无未解决决策。剩余风险见 §10。

## 12. 自审

- ✅ 需求覆盖：14 菜单各独立 key，覆盖用户"每个菜单独立 KEY"反馈。
- ✅ 约束一致：遵循 CONVENTIONS（ruff/mypy/中文/迁移可重置/双层 hook）。
- ✅ 真实性：枚举成员名、menuKey、seed 迁移、seed_platform_admin_role 均来自真实代码（ccfab86a 后状态）。
- ✅ YAGNI：不删悬空 key、不动 router/业务/daemon。
- ✅ 非目标清晰：§3 明确 5 项不做。
- ✅ 风险识别：§10 共 4 项含 P1~P3 对策。
- ✅ 生命周期契约表：§7.5 不涉及，无需生成。

### 验收标准（AC）

- **AC-1** `Permission` 枚举 PPM_* 成员 8→17（14 菜单 key + 3 悬空旧 key），新增 9 个值正确，`test_ppm_permissions.py` EXPECTED 通过。
- **AC-2** `test_permissions.py` count 断言 53→62 通过。
- **AC-3** `menu-permissions.ts` 14 菜单各用专属 key，无 2 个菜单共享同一 key。
- **AC-4** `menu-permissions.test.ts` mirror 含 17 个 PPM key（总 63），各菜单断言为专属 key，全绿。
- **AC-5** platform_admin seed 后拥有全部 17 个 PPM key（含 9 新增 + 3 悬空旧）。
- **AC-6** backend lint（ruff+format+mypy）+ frontend typecheck 通过。
- **AC-7** openapi.json 重生成后 ppm 权限枚举含 17 值。
- **AC-8** admin picker 展示 14 个 PPM 菜单卡（各 1 专属 key，含 9 新增菜单）；悬空 3 旧 key 是否单独显示取决于 picker 数据源（execute 确认：若读 menu-permissions.ts 则按菜单卡渲染、悬空 key 不显示）。
