---
author: qinyi
created_at: 2026-07-18 17:16:00
change: 2026-07-18-ppm-data-scope
---

# 任务计划 / 问题清单 — 数据查询范围权限控制 设计文档

> ⚠️ 本文档为人工重写,纠正 sillyspec CLI 自动生成的错误版本(CLI 误把对象写成「项目计划/项目维护」、误用部门子树方案、误列角色、误判"其余看不到数据")。以本版本为准。

## 1. 背景与目标

PPM「任务计划」(`GET /api/ppm/task-plan/page`)与「问题清单」(`GET /api/ppm/problem-list`)列表当前对任何持功能权限的用户**返回全表数据**:后端不强制按人/角色过滤,前端"我的/全部"切换是纯前端可选行为(普通用户点"全部"即可看全平台数据)。

本变更新增**按角色限制查询数据范围**:超级管理员看全部;部门经理 / 项目经理 / 开发经理 / 业务经理 看相关项目的全部任务;其余角色只看自己要干的任务。

**对象仅限**:任务计划(`PlanTask`)+ 问题清单(`PpmProblemList`)两个查询入口。不含项目计划/项目维护/看板(YAGNI)。

## 2. 需求(已与用户多轮确认)

5 档角色可见范围:

| 身份 | 判定依据 | 可见范围 |
|---|---|---|
| 超级管理员 | `user.is_platform_admin=true` 或持 `super_admin` 角色 | 全部 |
| 经理(部门经理/项目经理/开发经理/业务经理) | 在**某项目成员**里 `role_name` 含对应角色 | 该项目(集合)下的**全部**任务 |
| 其余 | 无以上身份 | 只看自己要干的 |

关键语义(用户确认):

- **经理按"项目"逐个判定**(用户 Step6 Q1 选「按每个项目里的角色」):张三在 A 项目是项目经理 → 看 A 项目全部任务;在 B 项目是普通开发 → B 项目只看自己负责的。一人不同项目角色可不同。
- **部门经理 = 同项目经理逻辑**(用户 Step6 Q2 选「也按项目角色算」):`role_name` 含"部门经理" → 看相关项目。**不引入组织/部门维度,不碰 `Organization`/`UserOrganization` 表。**
- **"自己要干的"**(用户 Step6 Q3 选「只看自己负责的」):
  - 任务计划 = `PlanTask.user_id == 自己`
  - 问题清单 = 自己是 `duty_user_id`(责任人) / `audit_user_id`(验证人) / `now_handle_user`(当前处理人,逗号拆分含自己)任一
- **多项目取并集**:经理项目集 ∪ 自己负责的,`OR` 合并。
- 四个经理角色(项目经理/开发经理/业务经理/部门经理)权限**完全相同**,仅 `role_name` 值不同(用户需求明示"开发经理/业务经理同项目经理")。

## 3. 现状(真实代码依据)

| 项 | 位置 | 说明 |
|---|---|---|
| 任务计划列表 | `task/router.py:141` → `PlanTaskService.page`(`task/service.py:160`) | 零范围过滤,不传 `user_id` 即全表 |
| 任务计划导出 | `task/router.py:237` → `PlanTaskService.page`(同源参数) | 同上,需同步 |
| 问题清单列表 | `problem/router.py:87` → `ProblemService.list_problems`(`problem/service.py:214`) | 零范围过滤,`duty_user_id` 仅可选参数 |
| 问题清单导出 | `problem/router.py:144` → `list_problems_for_export`(`problem/service.py:1083`) | `select(PpmProblemList)` 全量,需同步 |
| 任务执行人字段 | `PlanTask.user_id`(`task/model.py:56`,单一,必填) | "要干活的"主键;另有 `work_partner`(字符串)/`TaskExecute.execute_user_id`(本次不纳入,用户选"只看自己负责") |
| 问题处理人字段 | `duty_user_id`(:94)/`audit_user_id`(:108)/`now_handle_user`(:129,逗号多人) | 按流转阶段不同字段 |
| 任务↔项目 | `PlanTask.project_id`(`task/model.py:75`,软 UUID,**可空**) | 经理项目集过滤键 |
| 问题↔项目 | `PpmProblemList.project_id`(`problem/model.py:74`,软 UUID) | 经理项目集过滤键 |
| 经理判定来源 | `PpmProjectMember.role_name`(`project/model.py:229`,逗号拼接中文角色名) | 前端 `PpmUserSelect res="role"` 选系统角色回填 `name`(D-009@v1 字符串化,`role_id` 弃用留空) |
| 系统角色 key↔name | DB `roles` 表 | `super_admin`/`DEPTBOSS`(部门经理)/`XMJL`(项目经理)/`KFJL`(开发经理)/`YWJL`(业务经理)/`WBJL`(维保经理) 等 |
| 超管判定 | `User.is_platform_admin`(`auth/model.py:54`);rbac 短路 `rbac.py:101` | 现有权限体系短路点 |

**关键利好**:系统已有标准角色 key 且项目成员 `role_name` 已记录经理角色。**无需新建角色、无需新增数据表、无需 migration** —— 这是纯查询过滤逻辑(方案 A 的核心优势)。

## 4. 数据模型变更

**无。** 不新增表、不新增字段、不需要 alembic migration。完全复用现有 `PpmProjectMember.role_name` + `PlanTask`/`PpmProblemList` 现有字段做查询过滤。

## 5. 技术设计(方案 A:公共过滤模块 + service 注入)

> 决策 D-006@v1 选定方案 A(用户 Step8 确认)。否决 B(接口层依赖注入,改签名多、风格不一致)、C(预算缓存,YAGNI)。

### 5.1 经理角色集常量

`ppm/common/data_scope.py`(新建):

```python
# 经理角色名(项目成员 role_name 逗号拆分后精确匹配)。对应系统角色 key:
#   部门经理=DEPTBOSS / 项目经理=XMJL / 开发经理=KFJL / 业务经理=YWJL
# 注:不含"维保经理(WBJL)"——用户需求未列入。
MANAGER_ROLE_NAMES: frozenset[str] = frozenset(
    {"部门经理", "项目经理", "开发经理", "业务经理"}
)
SUPER_ADMIN_KEY = "super_admin"
```

### 5.2 经理项目集计算(应用层拆分)

```python
async def _manager_project_ids(session, user: User) -> set[uuid.UUID]:
    """当前用户作为经理(任一经理角色)的项目 id 集合。

    role_name 是逗号拼接多角色字符串(如"开发经理,项目经理,前端开发人员"),
    应用层拆分后精确匹配 MANAGER_ROLE_NAMES(SQL 字符串匹配易误伤,故 Python 拆分)。
    """
    rows = await session.exec(
        select(PpmProjectMember.pm_project_id, PpmProjectMember.role_name)
        .where(PpmProjectMember.user_id == user.id)
    )
    ids: set[uuid.UUID] = set()
    for pm_project_id, role_name in rows:
        names = {s.strip() for s in (role_name or "").split(",") if s.strip()}
        if names & MANAGER_ROLE_NAMES:
            ids.add(pm_project_id)
    return ids
```

### 5.3 任务计划范围过滤

`PlanTaskService.page(req, *, user)` 新增 `user` 参数,在现有 where 拼接后注入范围:

```python
if not (user.is_platform_admin or await _has_role(session, user, SUPER_ADMIN_KEY)):
    manager_pids = await _manager_project_ids(session, user)
    scope_clause = or_(
        PlanTask.project_id.in_(manager_pids),   # 经理:相关项目全部
        PlanTask.user_id == user.id,             # 自己负责的
    )
    stmt = stmt.where(scope_clause)
# 超管:不加 where(全部)
```

- `project_id` 为 NULL 的任务:不在经理集 → 仅当 `user_id==自己` 命中第二分支;否则只有超管可见(合理默认,见 D-009)。
- 导出 `export-excel` 同步注入同一过滤(防绕过)。

### 5.4 问题清单范围过滤

`ProblemService.list_problems(...)` 与导出同步:

```python
if not is_super:
    manager_pids = await _manager_project_ids(session, user)
    uid_str = str(user.id)
    scope_clause = or_(
        PpmProblemList.project_id.in_(manager_pids),       # 经理:相关项目全部
        PpmProblemList.duty_user_id == user.id,            # 责任人是自己
        PpmProblemList.audit_user_id == user.id,           # 验证人是自己
        _now_handle_contains(PpmProblemList.now_handle_user, uid_str),  # 当前处理人含自己
    )
    stmt = stmt.where(scope_clause)
```

- `now_handle_user` 是 UUID 逗号拼接字符串,应用层拆分判断(避免 like 子串误匹配),或 service 先查经理项目集 + 三个 user_id 字段用 `==`,`now_handle_user` 走 split 内存过滤(execute 阶段选最稳实现)。

### 5.5 router 透传当前用户

- `task/router.py:141`(`/task-plan/page`)与 `:237`(导出):service 调用补传 `user`(router 已有 `user` 依赖)。
- `problem/router.py:87`(列表)与 `:144`(导出):同上补传 `user`。
- `require_permission_any(PPM_TASK_READ / PPM_PROBLEM_READ)` **保留**(D-008:功能权限管"能不能进",scope 管"能看哪些",正交)。

### 5.6 前端"我的/全部"语义对齐

- 任务计划页 `task-plans/page.tsx`(view: all/personal)、问题清单页 `problem-list/page.tsx`(view: mine/all):后端强制按角色过滤后,"全部"按钮语义变为"我权限范围内的全部"(经理=管辖项目全部;普通人=自己负责的全部)。
- **不在本次做前端改造**,后端过滤生效即满足需求;前端文案/按钮显隐的精细化(如对普通人隐藏"全部")留后续 quick(D-010,非目标)。

## 6. 验收标准(可测试)

- **AC-1**:超管(`is_platform_admin` 或 `super_admin` 角色)GET `/task-plan/page` 与 `/problem-list` 返回全部。
- **AC-2**:经理(A 项目的项目经理)能看到 A 项目的**全部**任务,包括 `user_id` 不是自己的(经理项目集生效)。
- **AC-3**:经理在 B 项目是普通成员(无经理角色)→ B 项目只看到 `user_id==自己` 的任务。
- **AC-4**:无任何经理角色、非超管的用户 → 只看到 `user_id==自己`(任务)/ `duty|audit|now_handle` 含自己(问题)。
- **AC-5**:`role_name` 含"部门经理"的用户 → 同 AC-2 看相关项目全部(部门经理=项目经理逻辑)。
- **AC-6**:开发经理/业务经理(`role_name` 含对应值)→ 同 AC-2。
- **AC-7**:导出接口(`/task-plan/export-excel`、`/problem-list/export-excel`)同步按范围过滤(防绕过)。
- **AC-8**:`project_id` 为 NULL 的任务:仅负责人自己 + 超管可见。
- **AC-9**:多项目并集——用户是 X、Y 两个项目的经理 → 看到 X∪Y 全部任务 + 自己在其他项目负责的。
- **单测**:`data_scope` 覆盖 5 档角色 + 多项目并集 + `now_handle_user` 拆分匹配 + `project_id` NULL 边界;service 覆盖列表/导出 4 查询点的 super/scoped/empty;SQLite/PG 方言兼容(`in_(set)` 两端可用,`now_handle_user` 应用层 split 避免方言差异)。

## 7. 非目标

- **不碰组织/部门表**(`Organization`/`UserOrganization`)——部门经理同项目经理,不引入部门维度(D-004)。
- **不新增 RBAC 角色/不新增数据表/无 migration**——复用现有 `role_name` 文本匹配(D-001)。
- **不覆盖**项目计划(`PsProjectPlan`)/项目维护(`PpmProjectMaintenance`)/看板的数据范围(YAGNI,仅 task + problem)。
- **不纳入** `work_partner`/`TaskExecute.execute_user_id` 到"自己要干的"(用户选"只看自己负责的")。
- **不做前端改造**(仅后端过滤生效;前端"我的/全部"文案优化留 quick,D-010)。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| `role_name` 文本匹配(非 key):拼写变体(如"专案经理")不命中 | 中文角色名与 key 一一对应,DB 实测值稳定;精确匹配 4 个经文名,接受变体不命中 |
| `role_name` 逗号拼接 SQL 匹配易误伤(如 `ilike '%经理%'` 会命中"维保经理") | 应用层 Python 拆分后精确匹配 `MANAGER_ROLE_NAMES`,不用 SQL 模糊 |
| `project_id` 为 NULL 任务被经理过滤漏掉 | 落入"自己负责"分支(`user_id==我`)或超管;默认合理(D-009) |
| `now_handle_user` UUID 字符串 like 子串误匹配 | 应用层 split 精确匹配,不用 like |
| 经理项目集子查询性能 | 当前规模(20 项目)无虞;可加 `ppm_project_member(user_id)` 索引;YAGNI 暂不物化 |
| 导出/区间端点绕过 | 列表/导出/区间三类端点同步注入过滤 |

## 9. 回退

- 代码:revert service 的 scope 注入 + router 的 `user` 透传 → 回到全量(项目未上线,可接受回到无过滤状态)。
- 无 migration / 无数据变更,回退零成本。

## 生命周期契约

本次不涉及 session / lease / agent_run / daemon / lifecycle / claim / heartbeat,无生命周期契约表需求。仅修改 PPM 域只读查询过滤,不影响任何状态机或异步任务。
