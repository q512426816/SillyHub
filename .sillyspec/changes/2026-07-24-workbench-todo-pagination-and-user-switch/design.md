---
author: qinyi
created_at: 2026-07-24T08:45:00
scale: large
---

# 设计文档（Design）— 工作台待办分页 + 按角色切换查看他人工作台

## 1. 背景

个人工作台（`/ppm/workbench`）当前「我的待办」一次性渲染后端派生的全部待办（问题在办 + 变更待审 + 任务 top20），无分页；待办多时左栏冗长。同时工作台三块数据（profile/summary/calendar）+ 我的任务表**全部只读当前登录人**，部门/项目/开发/业务经理无法查看下属或项目组成员的工作台，缺乏管理视角。

本次给工作台加两个能力：①「我的待办」分页（每页默认 10 条）；②全部经理角色（部门/项目/开发/业务经理任一）+ super_admin 可**切换用户**查看他人工作台——切换后工作台内**所有查询接口**（个人信息 / 指标 / 日历 / 待办 / 我的任务）均以目标用户返回。WEB 与 APP 双端都做。

依据：`backend/app/modules/ppm/workbench/{router,service,schema}.py`、`backend/app/modules/ppm/common/data_scope.py`、`backend/app/modules/admin/{model,organizations_service}.py`、`frontend/src/app/(dashboard)/ppm/workbench/**`、`frontend/src/app/m/ppm/workbench/page.tsx`。

## 2. 设计目标

- **FR-1 待办分页（WEB+APP）**：后端新增分页端点，total 准确；前端「我的待办」默认每页 10 条，可翻页。
- **FR-2 切换用户（WEB+APP）**：经理（部门/项目/开发/业务经理任一）+ super_admin 可在个人信息区切换查看他人工作台；切换后 profile/指标/日历/待办/任务表全部跟随目标用户。
- **FR-3 可见用户口径**：部门经理 → 自己所在部门及下属部门（Organization 子树）全部人员；项目/开发/业务经理 → 自己承担这些角色的项目下的项目组成员；多角色取并集；super_admin → 全部用户。
- **FR-4 权限收口**：target_user_id 越权（非可见集且非超管）→ 后端 403；非经理非超管 `can_view_others=false`，无切换入口。

## 3. 非目标

- 不改 workbench 三栏布局/移动卡片流结构，只在现有卡片内增量加控件。
- 不新建数据库表、不加 migration（纯 DTO + 查询逻辑）。
- 不做「批量管理多个下属工作台」的聚合视图（YAGNI，单用户切换已满足）。
- 不改看板（kanban）/项目计划等其它子域的数据范围。
- 待办分页只针对「我的待办」列表；「我的任务」表现状为一次性 cap 100 条（`page_size=100`，无分页器 UI），本次仅加 target_user_id 透传，不补其分页器。

## 4. 拆分判断

单一变更，不走批量模式：分页端点、切换用户权限、双端 UI 三者强耦合（共用 target_user_id 透传链路 + 可见用户算法），拆开会割裂验收。作为一次 large 变更，按 Wave 分阶段实现（后端 → WEB → APP → 测试）。

## 5. 总体方案

### 5.1 后端：target_user_id 透传 + 权限收口 + 分页端点

- workbench service 三个 getter（`get_profile`/`get_summary`/`get_calendar`）签名加 `target_user: User`（由 router 解析后传入），内部所有 `user.id` 取数改为 `target_user.id`。
- 新增 `GET /workbench/todos`：复用改写后的 `_derive_todos`，支持 `page`/`page_size`（默认 10），返回 `PageResp<WorkbenchTodoItem>`；去除原 top20 任务上限，全量取 + 合并稳定排序 + 切片 + total。
- 新增 `GET /workbench/switchable-users`：返回当前登录人可切换用户列表。
- 新增权限解析 `_resolve_target_user(user, target_user_id)`：不传/传自己 → user；传他人 → 校验后返回目标 User，否则 403。
- `WorkbenchSummary` 去掉 `todos`（职责瘦身，未上线无需兼容）。
- `WorkbenchProfile` 加 `can_view_others: bool`（反映**登录人**能力，与 target 无关）。
- `/personal-task-plan/page` 加可选 `target_user_id`，service 层按 `_resolve_target_user` 解析取数（切换后任务表跟随）。

### 5.2 前端 WEB

- `page.tsx` 维护 `targetUserId` 状态（null=自己），透传给 profile/summary/calendar/todos/task table 全部 fetch；查看他人时顶部显示提示条「正在查看 XX 的工作台 · [返回我自己]」。
- `ProfileSummaryCard` 加「切换用户」下拉（仅 `can_view_others` 渲染）：选项 = switchable-users + 「我自己」。
- `TodoListPanel` 改为自带 fetch + 分页（调 `/workbench/todos`，底部分页器 上一页/下一页/共N条/每页10条），badge 显示 total。
- `WorkbenchTaskTable` 接收 `targetUserId` 透传到 `listPersonalPlanTasks`。

### 5.3 前端 APP（`app/m/ppm/workbench`）

- 新增「我的待办」卡片（当前缺失），带分页（移动端 上一页/下一页 + 页码）。
- `ProfileCard` 加「切换查看其他成员」入口（底部 sheet 选择），切换后 profile/指标/日历/待办全部跟随。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/workbench/router.py` | 3 端点（profile/summary/calendar）加 `target_user_id` Query；新建 `/workbench/todos`（带 target）+ `/workbench/switchable-users` |
| 修改 | `backend/app/modules/ppm/workbench/service.py` | getter 加 target_user；`_resolve_target_user`/`_visible_user_ids`/`_can_view_others`；`_derive_todos` 分页；`get_todos`/`list_switchable_users` |
| 修改 | `backend/app/modules/ppm/workbench/schema.py` | `WorkbenchProfile+=can_view_others`；`WorkbenchSummary-=todos`；新增 `WorkbenchSwitchableUser` |
| 修改 | `backend/app/modules/ppm/task/router.py` | `/personal-task-plan/page` 加可选 `target_user_id`：先 `_resolve_target_user` 校验（**仅此一路，禁用 data_scope**——data_scope 是按 viewer 经理项目集过滤行，与"看指定目标用户的任务"语义不符），再 `req.user_id=target.id` |
| 不改 | `backend/app/modules/ppm/task/service.py` | `PlanTaskService.page(req)` 按 `req.user_id` 过滤，通用，无需改（router 注入 target.id 即可） |
| 修改 | `backend/app/modules/ppm/workbench/tests/test_workbench_service.py` | 可见用户算法 / 分页 / target_user 透传 / 越权 403 |
| 修改 | `frontend/src/lib/ppm/workbench.ts` | 各 fetch 加 `targetUserId`；新增 `fetchWorkbenchTodos`/`fetchWorkbenchSwitchableUsers` |
| 修改 | `frontend/src/lib/ppm/types.ts` | `WorkbenchProfile+=can_view_others`；`WorkbenchSummary-=todos`；新增 `WorkbenchSwitchableUser` |
| 修改 | `frontend/src/lib/ppm/task.ts` | `listPersonalPlanTasks` 加 `targetUserId` |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/page.tsx` | `targetUserId` 状态 + 透传 + 切换提示条 |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/_components/profile-summary-card.tsx` | 「切换用户」下拉 |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.tsx` | 自带 fetch + 分页 |
| 修改 | `frontend/src/app/(dashboard)/ppm/workbench/_components/workbench-task-table.tsx` | 透传 `targetUserId` |
| 修改 | `frontend/src/app/m/ppm/workbench/page.tsx` | `targetUserId` + 新增待办卡片(分页) + ProfileCard 切换入口 |
| 新增/修改 | 前端对应 `*.test.tsx` | todo 分页、切换用户交互单测 |

## 7. 接口定义

### 7.1 新增端点

```
GET /api/ppm/workbench/todos
    ?target_user_id=<uuid|空>   # 空=当前登录人
    &page=<int,默认1>
    &page_size=<int,默认10>
  → PageResp<WorkbenchTodoItem>   # { items:[{id,name,type,source}], total, page, page_size }
  # 权限:target 非自己时校验 super_admin OR (经理 AND 目标∈可见集),否则 403

GET /api/ppm/workbench/switchable-users
  → list[WorkbenchSwitchableUser]
  # 当前登录人可切换的用户;非经理/非超管 → []
  # WorkbenchSwitchableUser = { user_id, display_name, employee_no, department_name }
```

### 7.2 改造端点（加可选 target_user_id）

```
GET /api/ppm/workbench/profile?target_user_id=<uuid|空>
  → WorkbenchProfile   # += can_view_others:bool(反映登录人能力)

GET /api/ppm/workbench/summary?target_user_id=<uuid|空>&range=week|month|all
  → WorkbenchSummary   # -= todos(只留 metrics)

GET /api/ppm/workbench/calendar?target_user_id=<uuid|空>&year_month=YYYY-MM
  → WorkbenchCalendar

GET /api/ppm/personal-task-plan/page?...&target_user_id=<uuid|空>
  → Page<PlanTask>     # 现有,加可选 target_user_id(权限同 workbench)
```

### 7.3 权限解析（service 伪代码）

> **口径区分（C2）**：本变更的「可查看用户集」(`_visible_user_ids`) 与 `data_scope` 的「数据范围」是**两件事**，刻意分口径：
> - `data_scope`（2026-07-22 统一）：按 viewer 经理**项目集**过滤**行**（任务/问题可见性），部门经理**不再按组织树**。
> - `_visible_user_ids`（本变更）：回答"viewer 能切到看谁的工作台"——**部门经理走 Organization 子树**（管部门），**项目/开发/业务经理走项目成员**（管项目组）。两者不共用一套逻辑，但角色名常量复用 `data_scope.MANAGER_ROLE_NAMES`，避免硬编码漂移。
>
> `/personal-task-plan/page` 注入 target 时**只走** `_resolve_target_user`，**禁用 data_scope**（见 F5/R-01）。

```python
# 复用 data_scope 常量(避免硬编码漂移)
from app.modules.ppm.common.data_scope import MANAGER_ROLE_NAMES, is_super_admin
PROJ_MGR_NAMES = MANAGER_ROLE_NAMES - {"部门经理"}   # 项目/开发/业务经理
DEPT_MGR = "部门经理"

async def _load_user(self, user_id) -> User:
    u = (await self._session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404, "目标用户不存在")
    return u

async def _resolve_target_user(self, user, target_user_id):
    # 不传 / 传自己 → 当前登录人(完全兼容旧行为)
    if not target_user_id or str(target_user_id) == str(user.id):
        return user
    # 超管:任意目标(仍校验存在性 → 404)
    if await is_super_admin(self._session, user):
        return await self._load_user(target_user_id)
    # 经理:目标须在可见集,否则 403
    visible = await self._visible_user_ids(user)
    if target_user_id not in visible:
        raise HTTPException(403, "无权查看该用户工作台")
    return await self._load_user(target_user_id)

async def _visible_user_ids(self, user) -> set[uuid]:
    # 一次查 me 的全部项目成员记录,拆 role_name 中文集合
    rows = (await self._session.execute(
        select(PpmProjectMember).where(PpmProjectMember.user_id == user.id))).scalars().all()
    has_dept = any(_split_roles(r.role_name) & {DEPT_MGR} for r in rows)
    proj_pids = {r.pm_project_id for r in rows if _split_roles(r.role_name) & PROJ_MGR_NAMES}
    ids: set[uuid] = set()
    if has_dept:
        # 部门经理 → 所属 org 子树成员(含自身部门,须并回根)
        my_orgs = (await self._session.execute(
            select(UserOrganization.organization_id).where(UserOrganization.user_id == user.id))).scalars().all()
        for oid in my_orgs:
            subtree = {oid} | await _descendant_ids(self._session, oid)  # ← _descendant_ids 排除根,并回 oid
            ids |= set((await self._session.execute(
                select(UserOrganization.user_id).where(UserOrganization.organization_id.in_(subtree)))).scalars().all())
    if proj_pids:
        ids |= set((await self._session.execute(
            select(PpmProjectMember.user_id).where(PpmProjectMember.pm_project_id.in_(proj_pids)))).scalars().all())
    ids.add(user.id)
    return ids

async def _can_view_others(self, user) -> bool:
    if await is_super_admin(self._session, user): return True
    rows = (await self._session.execute(
        select(PpmProjectMember.role_name).where(PpmProjectMember.user_id == user.id))).scalars().all()
    return any(_split_roles(r or "") & MANAGER_ROLE_NAMES for r in rows)

async def list_switchable_users(self, user) -> list[WorkbenchSwitchableUser]:
    # 可见集 → 批量取 display_name/employee_no/department_name(防 N+1,一次 JOIN)
    ids = await self._visible_user_ids(user)
    # 单查:User + 首个 active org 名(对齐 get_profile 部门装配口径)
    rows = (await self._session.execute(
        select(User, Organization.name)
        .outerjoin(UserOrganization, UserOrganization.user_id == User.id)
        .outerjoin(Organization, and_(Organization.id == UserOrganization.organization_id, Organization.status == "active"))
        .where(User.id.in_(ids), User.status == "active")
    )).all()
    # 每用户取首个部门名,装配 WorkbenchSwitchableUser(user_id/display_name/employee_no/department_name)
    ...
```

`_split_roles` = `set(s.strip() for s in (role_name or "").split(",") if s.strip())`。`_descendant_ids` 复用 `app/modules/admin/organizations_service.py`，但**它排除根 org**（`discovered.discard(root_id)` L75），取成员须 `{oid} | _descendant_ids(oid)` 并回根——对齐 `_subtree_member_count`（L108-109）。漏并回根会让部门经理看不到自己所在部门成员，违反 FR-3（Grill C3 已纠正）。

`_derive_todos` 改分页后加保护上限（单源各取 ≤200，防极端数据膨胀，Grill F2 建议）：合并后 `total = len(all)`，切片 `[offset:offset+page_size]`。

### 7.4 分页待办派生

`_derive_todos(target_user, page, page_size)`：三源（问题在办 `now_handle_user` 含目标 / 变更待审 `status="1"` 含目标 / 任务 `user_id=目标` 且未完成）全量取 → 合并 → 稳定排序（问题→变更→任务，任务内按 start_time 升序）→ `total=len(all)` → 切片 `[offset:offset+page_size]`。

## 8. 数据模型

**无表结构变更、无 migration。** 纯 DTO：
- `WorkbenchProfile` += `can_view_others: bool`
- `WorkbenchSummary` -= `todos`（字段移除）
- 新增 `WorkbenchSwitchableUser` DTO
- 复用现有 `PageResp<T>`（`{items, total, page, page_size}`）

## 9. 兼容策略

- **`target_user_id` 全部可选**：不传或传自己 = 当前登录人，与旧端点行为完全一致（前端旧调用不破）。
- **`WorkbenchSummary` 去 todos 是 breaking**：本项目未上线（CLAUDE.md 规则 11，不要求历史兼容），前端同步改造，无回滚负担。
- **`/personal-task-plan/page` 加可选 `target_user_id`**：默认行为不变，仅经理/超管传他人时生效。
- **`can_view_others` 新增字段**：前端用 `??` 兜底，旧响应缺失不报错。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | target_user_id 越权（非可见集且非超管）看到他人数据 | P0 | `_resolve_target_user` 严格校验，不满足 403；`/personal-task-plan/page` **仅走** `_resolve_target_user`、**禁用 data_scope**（data_scope 按 viewer 项目集过滤行，语义不符会泄露）；单测覆盖越权场景 |
| R-02 | `_derive_todos` 全量取数后切片，单人待办量极大时慢 | P2 | 单人活跃待办有限（问题在办+变更+未完成任务），可接受；必要时加保护上限 |
| R-03 | 部门经理无 `UserOrganization` 记录 → 看不到人 | P2 | 业务上部门经理应在部门内；空集合理，UI 显示「无可切换用户」 |
| R-04 | 可见用户集每次请求查库（N+1 / 重复查） | P2 | switchable-users 实时查可接受；target 解析复用 set 成员判断（O(1)） |
| R-05 | 切换后任务表与工作台口径不一致 | P1 | `/personal-task-plan/page` 同步加 target_user_id，D-004 保证一致 |

## 11. 决策追踪

- **D-001@v1**：分页用独立 `/workbench/todos` 端点（非客户端切片），保 total 准确 → 覆盖 FR-1 / §5.1 / §7.1。
- **D-002@v1**：可见用户按经理角色分口径（部门经理→org 子树；项目/开发/业务经理→项目成员；并集）→ 覆盖 FR-3 / §7.3。
- **D-003@v1**：`WorkbenchSummary` 去 todos，职责瘦身 → 覆盖 §5.1 / §8 / §9。
- **D-004@v1**：切换覆盖含「我的任务」表（`/personal-task-plan/page` 加 target_user_id）→ 覆盖 FR-2 / §5.2 / R-05。
- **D-005@v1**：`can_view_others` 放 profile 响应，前端据此显隐切换入口 → 覆盖 FR-4 / §7.2。

无未解决决策。

## 12. 自审

- ✅ 章节齐全（背景/目标/非目标/总体方案/文件清单/接口定义/数据模型/兼容/风险/决策/自审）。
- ✅ 无 session/lease/agent_run/daemon/lifecycle 关键词，无需生命周期契约表（Grill 确认）。
- ✅ 所有 D-001~D-005 均在正文引用并映射到 FR/章节。
- ✅ target_user_id 透传链路完整：router → service `_resolve_target_user` → 各 getter 按 target.id 取数 → 前端整页透传（用户强调的硬约束已落实）。
- ✅ **Design Grill 阻断项已修正**：
  - C3（fail）：`_descendant_ids` 排除根 → §7.3 改 `{oid} | _descendant_ids(oid)` 并回根（已读 `organizations_service.py:75/108` 核实）。
  - F5（P0）：`/personal-task-plan/page` 越权 → 明确**仅走** `_resolve_target_user`、**禁用 data_scope**（已读 `task/router.py:287-344` 核实现状 `svc.page(req)` 不用 data_scope，注入 target 仅换 user_id，耦合浅）。
  - C2：复用 `data_scope.MANAGER_ROLE_NAMES` 常量 + 加「可查看用户集 vs 数据范围」口径区分说明。
  - D3：补 `list_switchable_users` 批量装配（JOIN 防 N+1）+ `_load_user` 404。
  - F4/§3：「任务表本就分页」更正为「cap 100 条无分页器」。
- ✅ F3（R-05 担忧）已消解：`personal_plan_task_page` 现状不依赖 data_scope，注入 target 耦合浅，回退方案大概率不用。
- ✅ `scale: large`（跨 backend+WEB+APP 三模块、新 API、权限、DTO 变更）。

## 13. 第二轮细化(2026-07-24,D-006~008)

部署第一轮后用户追加 3 点细化:

- **只读模式(D-006)**:切换查看他人工作台(targetUserId≠null)时,整台只读——禁用所有数据操作(任务详情/执行/启动 → 「仅查看」)+ 禁用所有页面跳转(待办点击、WEB 快捷入口、APP 指标下钻/快捷入口)。前端 `readOnly=isViewingOther` 透传 TodoListPanel/WorkbenchTaskTable/QuickEntryGrid(WEB)、MetricsCard/QuickEntriesCard(APP);只读态按钮 `disabled`、`<Link>` 退化为不可点 div + 提示文案。后端无需改(写操作本就不带 target_user_id;只读是前端约束,管理视角纯查看)。
- **切换人员可搜索(D-007)**:纯下拉改可搜索——WEB 用 antd `Select`(showSearch,按姓名/工号/部门过滤);APP 用输入框 + 实时过滤可点列表(我自己始终置顶)。
- **APP 不展示待办(D-008)**:移除 APP `TodoCard`(第一版新增的)。APP 工作台=个人信息(含切换)+ 指标 + 工作日历 + 快捷入口;待办分页仅 WEB。后端 `/workbench/todos` 保留(WEB 用)。
