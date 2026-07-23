---
author: qinyi
created_at: 2026-07-14 08:59:41
change: 2026-07-13-ppm-personal-workbench-prototype
scale: large
---

# 设计文档（Design）— PPM 个人工作台

## 1. 背景

PPM（项目管理）模块当前只有 `projects / project-plans / milestone-details / problem-list / task-plans / task-execute / work-hours / kanban` 等业务录入页，**没有一个"登录后第一眼看到自己干什么"的入口**。`/ppm` 当前只是 `redirect("/ppm/projects")`（`frontend/src/app/(dashboard)/ppm/page.tsx`）。

原型 `prototype-ppm-personal-workbench.html`（brainstorm 阶段已产出）定义了「个人工作台」页面：三栏布局，把**当前登录人的任务、本月指标、工时、缺陷、待办、工作日历**聚合到一个入口。

原型阶段决策（D-002@原型版）当时明确"只产静态原型不改源码"。本设计进入**真实实现阶段**：接 PPM 现有数据 + 新建聚合接口 + 新建前端页面。

## 2. 设计目标

- 提供 `/ppm/workbench` 页面，作为当前登录人的个人工作台
- 左栏：个人信息卡（姓名/工号/角色/部门）+ 我的待办（派生）+ 消息通知（占位）
- 中栏：5 个本月指标卡（任务量/完成率/延期率/工时/缺陷数）+ 任务操作表（复用 personal-task-plan）
- 右栏：工作日历（每日任务负载+进度预警双圆点）+ 快捷入口 + 规则说明
- 后端新建 `workbench` 聚合子域，复用 PPM 现有 22 张表，**不新建业务表**（除 users 加一列）
- 待办从现有流程在办表派生，消息/绩效考评用占位空状态

## 3. 非目标（明确不做）

- **不做消息通知模块**：系统当前无任何通知表，是独立大模块，本次只做占位空状态，后续单独开变更
- **不做绩效考评模块**：系统无 performance 表，本次快捷入口只挂占位，后续单独开变更
- **不建 todo 待办表**：从 `ppm_problem_list_process_task` / `ppm_problem_change_process_task` + 非终态 `ppm_plan_task` 派生
- **不给 PlanTask 加"平台子系统/计划类型"列**：原型任务表这两列在 PlanTask 无对应字段，用 `module_name` 近似（详见 §10 D-005）
- **不改 `/ppm` redirect 目标**：保留 `/ppm → /ppm/projects`，工作台作为 `/ppm/workbench` 独立入口 + 菜单第一项
- **不引入 react-query**：PPM 域统一用 `apiFetch + useEffect`，工作台沿用
- **不引入日历第三方库**：双圆点日历自研（轻量，全仓无日历组件）

## 4. 拆分判断

本变更是一个**内聚的前端页面 + 配套后端聚合接口**，不与任何在途变更冲突（当前活跃变更仅本一个）。不走批量模式——所有改动围绕"个人工作台"这一个业务诉求，作为一个变更交付。

数据层复用现有 PPM 表（`ppm_plan_task` / `ppm_problem_list` / `ppm_task_execute` / `ppm_problem_list_process_task` 等），仅 `users` 表加一列 `employee_no`。

## 5. 总体方案（分 Wave）

### Wave 0：后端数据层 — 工号字段
- `users` 表加 `employee_no VARCHAR(50) NULL`（alembic migration，down_revision = `20260713_fix_session_zombie`）
- `User` ORM 加字段（`auth/model.py`）
- `UserRead` schema 加 `employee_no`（`auth/schema.py`），MeResponse 自动带上

### Wave 1：后端 workbench 聚合子域
新建 `backend/app/modules/ppm/workbench/`（schema / service / router / tests），挂载到 `/api/ppm`。三个只读聚合接口：
- `GET /api/ppm/workbench/profile` — 个人信息（工号/姓名/部门/角色）
- `GET /api/ppm/workbench/summary?range=week|month|all` — 本月指标 + 待办列表
- `GET /api/ppm/workbench/calendar?year_month=YYYY-MM` — 工作日历每日负载

权限复用 `PPM_TASK_READ`（不新建 workbench 权限，YAGNI）。

### Wave 2：前端页面 + 组件
- 新建 `frontend/src/app/(dashboard)/ppm/workbench/page.tsx`
- 组件：`ProfileSummaryCard` / `PersonalMetricStrip` / `TodoListPanel` / `WorkbenchTaskTable` / `WorkCalendarPanel` / `QuickEntryGrid` / `RuleNotePanel`
- `lib/ppm/workbench.ts`（API client）+ `lib/ppm/types.ts` 加类型
- `app-shell.tsx` 菜单加"个人工作台"项

### Wave 3：占位与收尾
- 消息通知 / 绩效考评用 `EmptyState` 占位
- 任务表「执行」走任务执行表单（共享 ExecuteTaskDialog，填本次耗时 + 执行情况说明 + 勾选提交到已完成，调 execute-plan 携带 execute_info/time_spent/submit）——**reverse sync 2026-07-15**：原型 modal 文案自身写「真实实现阶段应同步工时或执行记录」，真实实现用执行表单取代原简单二次确认（用户决策 A），避免 submit=true 空提交不留记录

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/migrations/versions/20260714_add_user_employee_no.py | users 加 employee_no，down=20260713_fix_session_zombie |
| 修改 | backend/app/modules/auth/model.py | User 加 employee_no 字段（~L50） |
| 修改 | backend/app/modules/auth/schema.py | UserRead 加 employee_no（~L38） |
| 新增 | backend/app/modules/ppm/workbench/__init__.py | 子域包 |
| 新增 | backend/app/modules/ppm/workbench/schema.py | WorkbenchProfile/Summary/Calendar DTO |
| 新增 | backend/app/modules/ppm/workbench/service.py | 聚合查询逻辑 |
| 新增 | backend/app/modules/ppm/workbench/router.py | 3 个 GET 接口 |
| 新增 | backend/app/modules/ppm/workbench/tests/test_workbench_service.py | 聚合逻辑单测 |
| 修改 | backend/app/main.py | import + include_router（~L31, L473 区域） |
| 新增 | frontend/src/app/(dashboard)/ppm/workbench/page.tsx | 工作台页面 |
| 新增 | frontend/src/app/(dashboard)/ppm/workbench/_components/*.tsx | 7 个子组件 |
| 新增 | frontend/src/lib/ppm/workbench.ts | API client |
| 修改 | frontend/src/lib/ppm/types.ts | 加 workbench 类型（~L1200） |
| 修改 | frontend/src/components/app-shell.tsx | 菜单加"个人工作台"（~L86） |

## 7. 接口定义

### 7.1 GET /api/ppm/workbench/profile
```python
class WorkbenchProfile(BaseModel):
    display_name: str | None        # 姓名
    employee_no: str | None         # 工号(users.employee_no)
    department_name: str | None     # 部门(user_organizations→organizations.name,取主部门)
    role_name: str | None           # 角色(workspaces[0].role_name 或 user_roles→roles.name)
    avatar_text: str                # 头像首字(display_name 首字)
```
实现：`get_current_user` 取 user → `employee_no` 直取 → LEFT JOIN `user_organizations`+`organizations` 取部门 → 复用 `list_user_workspace_roles`（auth/rbac.py:115）取首个 role_name。

### 7.2 GET /api/ppm/workbench/summary?range=month
```python
class WorkbenchMetrics(BaseModel):
    task_count: int            # 范围内任务总数(=分母):count(ppm_plan_task where user_id=me AND start_time∈[range])
    completion_rate: float     # 完成率 = count(status="已完成") / task_count;task_count=0 时返回 0.0
    delay_rate: float          # 延期率 = count(end_time<now AND status!="已完成") / task_count
    work_hours: float          # 范围内工时:SUM(task_execute.time_spent) where execute_user_id=me,复用 stat_by_user 口径
    defect_count: int          # 缺陷数:count(ppm_problem_list where duty_user_id=me AND status!="4");不受 range 影响

class WorkbenchTodoItem(BaseModel):
    id: str
    name: str                  # 任务/问题主题
    type: str                  # 任务/缺陷/工时/计划(标签)
    source: str                # plan_task / problem_audit / problem_change

class WorkbenchSummary(BaseModel):
    metrics: WorkbenchMetrics
    todos: list[WorkbenchTodoItem]   # 派生待办,top N
```
range 取值：`week` / `month` / `all`。**统一按 `start_time` 区间过滤**（不依赖 `month` 字段——PlanTask.month 可空，见 task/model.py:63，过滤不可靠）：week=本周一 00:00~周日 23:59（本地）；month=当月 1 日~月末；all=不限。completion_rate/delay_rate 的分母 = task_count（同 range 范围任务总数）。defect_count 不受 range 影响（当前人名下全部未关闭缺陷）。

待办派生（详见 §10 D-006）：
- 问题审批待办：`ppm_problem_list_process_task` / `ppm_problem_change_process_task` 的 `now_handle_user`（逗号分隔字符串）包含当前 user_id
- 任务待办：`ppm_plan_task` where `user_id=me AND status!="已完成"`，取 plan_begin 临近的

### 7.3 GET /api/ppm/workbench/calendar?year_month=2026-07
```python
class CalendarDay(BaseModel):
    date: str               # YYYY-MM-DD
    load_level: str         # none/leisure(有空余)/full(饱和)/over(过载) — 按当日 work_load 工时累加分档(注意事项 2)
    alert_level: str        # none/normal/late(临期)/over(延期) — 按当日任务进度最严重(注意事项 2)
    task_count: int

class WorkbenchCalendar(BaseModel):
    year_month: str
    days: list[CalendarDay]
```
实现（**reverse sync 2026-07-15 注意事项 2**）：统计当月每日以 `start_time` 落在该日的任务 → load_level 按当日 `work_load`（计划工时，解析为小时，1d=8h）累加分档：0→none(灰无计划) / <8→leisure(黄有空余) / 8-10→full(绿饱和) / >10→over(红过载)。alert_level 按当日任务进度取最严重：none(灰无任务) / normal(绿正常) / late(黄临期：周期≤3日→截止前1天，周期>3日→截止前2天，含1日任务) / over(红延期：end_time<now 且未完成)。初版误用任务数分档 + 仅 end_time<now，已按注意事项 2 修正。

### 7.4 任务表（复用，不新增）
`GET /api/ppm/personal-task-plan/page`（task/router.py:242，已有）。原型任务表的「项目编码」PlanTask 无此字段——本设计**不扩 personal-task-plan 返回结构**（避免动已有接口契约），前端任务表「项目编码」列显示 project_name 兼作，或留空（详见 §10 D-005）。状态、项目名、模块、内容、操作列直接用 PlanTaskResponse 现有字段。

## 8. 数据模型

仅一处表结构变更：

```python
# auth/model.py User 表新增(L50 附近)
employee_no: str | None = Field(
    default=None, sa_column=Column(String(50), nullable=True)
)
```
- nullable，老用户为空，工作台显示"—"
- 不加唯一约束（工号唯一性由业务录入保证，避免迁移期冲突）

**不新建任何业务表**。聚合查询直接读：
- `ppm_plan_task`（status 枚举：`未开始`/`进行中`/`已完成`，含 month/year/start_time/end_time/user_id）
- `ppm_problem_list`（duty_user_id/is_delay_plan/status 1-7,4=已关闭）
- `ppm_task_execute`（time_spent，工时实际数据源）
- `ppm_problem_list_process_task` + `ppm_problem_change_process_task`（now_handle_user 待处理人）
- `user_organizations` + `organizations`（部门）

## 9. 兼容策略（brownfield）

- **employee_no nullable**：未录入工号的老用户，工作台显示"—"，不影响登录/其他流程
- **新接口只读**：workbench 三个 GET 不写任何表，不影响现有 PPM 录入流程
- **personal-task-plan 不改**：任务表复用原接口原返回，不动契约
- **MeResponse 加字段**：UserRead 加 `employee_no` 是**可选字段新增**，前端旧逻辑不读该字段不受影响；类型需重新生成（`gen-api-types.mjs`）
- **菜单新增项**：app-shell 加菜单项不删改现有项
- **/ppm redirect 不变**：不破坏现有 `/ppm → /ppm/projects` 习惯
- **回退**：若 workbench 接口异常，前端各区块独立 try/catch + EmptyState，不整页崩

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | PlanTask 无 project_code/plan_type 字段，原型任务表这两列无法直接填充 | P1 | D-005：project_code 不扩接口，前端用 project_name 兼作或留空；plan_type 列用 module_name 近似 |
| R-02 | `now_handle_user` 是逗号分隔字符串，匹配当前人需 like/split，跨数据库方言（SQLite 测试/PG 生产）行为差异 | P1 | service 层读出后 Python 端 split 过滤，不依赖 SQL like；单测 SQLite + 注意 PG（参照 [[backend-test-sqlite-vs-pg]]） |
| R-03 | `ppm_work_hour` 表实际为空，工时走 task_execute.time_spent，但 task_execute 也可能稀疏 | P2 | work_hours 指标允许为 0，UI 显示"0 天"非报错；D-008 明确数据源 |
| R-04 | organizations/user_organizations 表存在但**是否有实际组织数据未确认**，可能查不到部门 | P2 | department_name nullable，查不到显示"—"；实现时先 `SELECT count(*) FROM organizations` 确认 |
| R-05 | 延期判定口径（end_time<now vs is_delay_plan）plan_task 和 problem 不一致 | P2 | D-010：plan_task 用 `end_time<now AND status!="已完成"` 算；problem 直接用 `is_delay_plan` 字段 |
| R-06 | 迁移链新增 migration 必须接 `20260713_fix_session_zombie` 单 head，revision id ≤32 字符 | P1 | 实现时 `alembic heads` 确认单 head（参照 [[migration-chain-fragmentation-pattern]] [[alembic-heads-subagent-misreport]]） |
| R-07 | range=week 的"本周"起止（周一/周日）与 PlanTask.week 字段语义可能不一致 | P2 | week 统一按 start_time 区间过滤（本周一 00:00 ~ 本周日 23:59），不依赖 week 字符串字段 |
| R-08 | UserRead 加字段后前端 api-types 未重新生成导致类型缺失 | P2 | Wave 2 前端开发前先跑 gen-api-types.mjs |

## 11. 决策追踪

本次实现方案决策见 `decisions.md`（D-001@v1 ~ D-010@v1），全部被 requirements.md FR 覆盖。design 章节映射：
- D-001（路由 /ppm/workbench 独立子路径）→ §3 非目标（不改 /ppm redirect）/ §6 前端文件
- D-002（工号=User 加列）→ §5 Wave 0 / §8 数据模型
- D-003（部门=user_organizations 关联）→ §7.1 profile / §10 R-04
- D-004（角色=workspaces[0].role_name）→ §7.1 profile
- D-005（任务表字段缺口不扩接口）→ §7.4 / §10 R-01
- D-006（待办派生 now_handle_user）→ §7.2 / §10 R-02
- D-007（消息/绩效占位）→ §3 非目标
- D-008（工时源=task_execute.time_spent）→ §7.2 / §10 R-03
- D-009（权限复用 PPM_TASK_READ）→ §5 Wave 1 / §7 接口
- D-010（延期口径）→ §7.2 / §10 R-05

原型阶段旧决策演进：原型版 D-001（现代明亮样式）沿用；原型版 D-002（只做原型不改源码）→ 本设计 D-impl 推翻为"真实实现"；原型版 D-003（样例数据）→ 推翻为"接真实接口"。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖 | ✅ 原型 9 区块全覆盖：个人信息(D-002/003/004) / 待办(D-006) / 消息(D-007 占位) / 指标(§7.2) / 任务表(§7.4) / 日历(§7.3) / 快捷入口(Wave3) / 规则说明(静态) |
| Grill/决策覆盖 | ✅ 用户 2 轮确认（范围=核心工作台 / 工号补字段 / 部门用现有表）→ D-001~D-010 |
| 约束一致性 | ✅ PPM 平台级无 workspace_id、UUID 主键、apiFetch+useEffect、Tailwind+antd 双库、tokens.ts 样式——均沿用 |
| 真实性 | ✅ 表名(ppm_plan_task 等)/字段(status 枚举中文/duty_user_id/is_delay_plan/now_handle_user)/类名(get_current_user/require_permission_any/list_user_workspace_roles)/挂载点(main.py:473)均来自真实代码 |
| YAGNI | ✅ 不建 todo/notification/performance 表、不新建权限、不引日历库、不接 react-query |
| 验收标准 | ✅ 具体可测：summary 返回 5 指标非负、todos 来自 process_task+plan_task、calendar 每日 load/alert、profile 含工号部门、employee_no nullable |
| 非目标清晰 | ✅ §3 明确 7 项不做 |
| 兼容策略 | ✅ §9 employee_no nullable / 新接口只读 / personal-task-plan 不改 / 加字段可选 |
| 风险识别 | ✅ §10 八条 R-01~R-08 含 P 级与对策 |
| 生命周期契约表 | ⬜ 不适用：本变更不涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat 关键词，纯 PPM 业务只读聚合，无需此表 |

**自审结论：通过。** 进入 Step 12 Design Grill 交叉审查。

## 13. Design Grill 交叉审查结果（Step 12）

status: **passed**（所有发现项均为 immediately_answered，无 P0/P1 unresolved blocker）

### Cross-Check Matrix
| ID | 层级 | 交叉点 | 证据 | 结论 | 决策 |
|---|---|---|---|---|---|
| X-001 | consistency | range 过滤口径：§7.2 原写 month 字段 vs start_time 区间 | PlanTask.month 可空(task/model.py:63) | month 不可靠，统一改 start_time 区间 | 已修正 §7.2 |
| X-002 | definition | completion_rate/delay_rate 分母未定义 | design §7.2 原文"/ total"模糊 | 分母 = task_count(同范围);task_count=0 返回 0.0 | 已修正 §7.2 |
| X-003 | definition | calendar load_level 分档阈值未定义 | design §7.3 | 初版给默认分档 0/1-2/3-4/≥5(任务数);**reverse sync 2026-07-15 改按 work_load 工时分档 none/leisure/full/over(注意事项2)** | 已修正 §7.3 |
| X-004 | definition | calendar 跨多日任务计哪几天 | design §7.3 原"start_time~end_time 落到各日"会虚高 | 只计 start_time 当日,不展开区间 | 已修正 §7.3 |
| X-005 | feasibility | now_handle_user 是否平台 user.id(待办派生可行性) | problem/service.py:433/459/610/703 均为 str(user.id) | 可行,D-006 成立;可简化用 problem_list 主表 now_handle_user | 确认 D-006 |
| X-006 | feasibility | organizations 表是否有实际数据(部门查询) | 未确认 | department_name nullable 兜底,实现时 SELECT count 确认 | R-04 已记,P2 不阻塞 |

### Question Distribution
| 分类 | 数量 |
|---|---|
| immediately_answered | 6 |
| needs_thinking | 0 |
| unresolved | 0 |

### Unresolved Blockers
无。design.md §7.2/§7.3 已按 X-001~X-004 修正。进入 Step 13 用户确认并生成规范文件。
