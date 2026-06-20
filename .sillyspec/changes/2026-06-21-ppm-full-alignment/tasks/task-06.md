---
author: qinyi
created_at: 2026-06-21T02:37:10+0800
change: 2026-06-21-ppm-full-alignment
id: task-06
title: 收尾(task-execute 详情 / problemchange 多态 / plannodemodule 独立页 / list-by-date-range)
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/task-execute/page.tsx
  - frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx
  - frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
  - backend/app/modules/ppm/problem/router.py
  - backend/app/modules/ppm/problem/service.py
  - backend/app/modules/ppm/problem/tests/
  - frontend/src/lib/ppm/problem.ts
  - frontend/src/lib/ppm/types.ts
---

## 修改文件

- **后端 — `list-by-date-range` 端点(新增,核心后端工作)**
  - `backend/app/modules/ppm/problem/router.py`:在「问题变更 CRUD」段之前、`/problem-list/export-excel` 之后,新增 `GET /problem-list/list-by-date-range`(固定路径,前置于 `/{item_id}`)。查询参数 `start_date` / `end_date`(均为 `datetime`,`Query(...)`),`PPM_PROBLEM_READ` 权限,返回 `list[ProblemListResp]`。
  - `backend/app/modules/ppm/problem/service.py`:新增 `list_problems_by_date_range(start: datetime, end: datetime) -> list[PpmProblemList]`,按 `find_time` 落在 `[start, end]` 区间过滤(`find_time IS NOT NULL AND find_time BETWEEN start AND end`),`order_by(desc(find_time))`。复用 `_changing_resource_ids()` 变更中标记(对齐 `list_problems` 内存态 effective_status 逻辑)。
- **前端 — `task-execute` 详情页(新建)**
  - `frontend/src/app/(dashboard)/ppm/task-execute/page.tsx`:新建独立路由页。复用 `lib/ppm/task.ts` 的 `listTaskExecutes({ plan_task_id })` / `getTaskExecute(executeId)`,展示任务执行详情(关联任务内容、执行状态、工时 `time_spent`、执行说明 `execute_info`、执行人、时间戳)与状态流转按钮(待执行→执行中→待验证→已完成,复用 `taskStatusTag`)。若 `plan_task_id` 缺失则列表态;支持按 `execute_id` 查询单条详情。
- **前端 — problemchange 多态(扩展,优先级最低,可选)**
  - `frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx`:`ChangeDrawer` 内按源 `ProblemList.pro_type`(`bug` / `change` / `demand`)切换字段区段(bug 隐藏「变更原因」、变更强化「变更内容/原因」、需求补充「需求背景」占位)。读取源 problem 类型走 `getProblem(resource_id)`。**当前后端 `pro_type` 仅 `bug`/`change` 两值;多态仅做 UI 字段显隐,不动后端 schema。**
- **前端 — plan-nodes 独立页(已就绪,验收为主)**
  - `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`:现状已是完整 CRUD 独立页(模板表 + 明细子表 `PpmSubTable` 整表行内编辑 + 模块抽屉 `PpmUserSelect`),无需新建。本任务仅做对照源 `plannode/components/*` 的字段对齐与遗漏补全(如明细 `overall_stage` 已覆盖、模块 `duty_user_id` 已覆盖),verify 时核对。
- **前端 — lib client(新增 1 个函数)**
  - `frontend/src/lib/ppm/problem.ts`:新增 `listProblemsByDateRange(start: string, end: string): Promise<ProblemList[]>`,走 `GET /api/ppm/problem-list/list-by-date-range?start_date=&end_date=`。
- **测试**
  - `backend/app/modules/ppm/problem/tests/`:新增 `list-by-date-range` 端点单测(区间过滤 / 反向区间 swap / 无变更中标记 / 空结果)。

## 覆盖来源

- design.md §5 W6、§6 文件变更清单 W6 行、§7;requirements FR-06;plan.md Wave 6 / 任务总表 task-06。无独立决策(D-011~014 均属 W1-W5)。

## 实现要求

1. **`list-by-date-range` 端点**:固定路径 `/problem-list/list-by-date-range` 必须注册在 `/problem-list/{item_id}` 之前(router.py 当前 `/problem-list/{item_id}` 在 :109,新端点插入 :108 之前),否则 FastAPI 会把 `list-by-date-range` 当 item_id 解析导致 422。参数用 `start_date`/`end_date`(对齐前端 work-hour 端点 `start_date`/`end_date` 命名,task-execute 端点用的是 `start`/`end`,本端点跟 work-hour 命名以避免歧义),`Query(..., description="区间起始 ISO datetime")`。
2. **service 方法**:`list_problems_by_date_range` 复用 `_Crud` 不适合(带 find_time 过滤),直接写 `select(PpmProblemList).where(PpmProblemList.find_time != None, PpmProblemList.find_time >= start, PpmProblemList.find_time <= end).order_by(desc(PpmProblemList.find_time))`。`find_time` 为空的问题不返回(对照源 find_time 是发现时间,无发现时间不入区间统计)。返回后跑 `_changing_resource_ids()` 打 effective_status 标记(与 `list_problems` 一致)。
3. **task-execute 详情页**:作为 `task-plans/page.tsx` 的补充独立页(后者用 `ExecuteDialog` 模态框执行;本页是只读详情 + 工时汇总)。页面加载 `listTaskExecutes()` 全量分页,点击行展开/跳详情展示:关联 PlanTask 内容(需 `getPlanTask(plan_task_id)` 反查)、execute_info、time_spent 累计、execute_user、status 流转时间线。工时为 0 也显式展示「0」。
4. **problemchange 多态**:`pro_type` 映射字段区段:
   - `bug`:隐藏「变更原因」(bug 修复无业务变更原因),仅「变更内容」。
   - `change`:「变更内容」+「变更原因」均必填显式标星。
   - `demand`/默认:全字段显示,无必填强制。
   类型读取:编辑态 `getProblem(change.resource_id).pro_type`;新建态若无源问题,默认走 `change` 全字段。
5. **plan-nodes 独立页验收**:确认现有页已含:模板列表(overall_stage/project_type PpmDictSelect/no)、明细子表 7 列整表编辑、模块抽屉(PpmUserSelect 责任人)。对照源 `plannode/components/NodeDetailForm.vue` + `NodeModuleForm.vue`,字段无遗漏即视为完成,不改代码。

## 接口定义

- **list-by-date-range 端点签名**:
  ```python
  @router.get("/problem-list/list-by-date-range", response_model=list[ProblemListResp])
  async def list_problems_by_date_range(
      session: SessionDep,
      user: Annotated[User, Depends(require_permission_any(Permission.PPM_PROBLEM_READ))],
      start_date: datetime = Query(..., description="区间起始 ISO datetime"),
      end_date: datetime = Query(..., description="区间结束 ISO datetime"),
  ) -> list[ProblemListResp]:
      items = await ProblemService(session).list_problems_by_date_range(start_date, end_date)
      return [ProblemListResp.model_validate(i) for i in items]
  ```
- **service 方法**:
  ```python
  async def list_problems_by_date_range(
      self, start: datetime, end: datetime
  ) -> list[PpmProblemList]:
      # 端点层已保证 start <= end(反向 swap 在 service 兜底)
      lo, hi = (start, end) if start <= end else (end, start)
      stmt = (
          select(PpmProblemList)
          .where(PpmProblemList.find_time.is_not(None))
          .where(PpmProblemList.find_time >= lo)
          .where(PpmProblemList.find_time <= hi)
          .order_by(PpmProblemList.find_time.desc())
      )
      items = list((await self._session.execute(stmt)).scalars().all())
      changing_ids = await self._changing_resource_ids()
      for item in items:
          if str(item.id) in changing_ids:
              object.__setattr__(item, "_effective_status", ProblemStatus.CHANGING.value)
      return items
  ```
- **TS client**:`listProblemsByDateRange(start: string, end: string): Promise<ProblemList[]>`,`GET /api/ppm/problem-list/list-by-date-range?start_date=${start}&end_date=${end}`。
- **task-execute 详情组件 props**:页面无 props(路由页);行内 `ExecuteDetailPanel({ execute: TaskExecute })`,内部 `getPlanTask(execute.plan_task_id)` 反查关联任务。
- **多态表单 type→字段映射**:`PROBLEM_CHANGE_FIELDS: Record<ProblemType, { showReason: boolean; reasonRequired: boolean; showDemandCtx: boolean }>`;`ProblemType = "bug" | "change" | "demand" | "other"`。
- **plan-nodes 独立页路由**:已有 `/ppm/plan-nodes`,无新增路由。

## 边界处理

1. **start > end(反向区间)**:service 内自动 swap(`lo, hi = sorted`),不报错,正常返回。
2. **find_time 为空的问题**:不返回(无发现时间,不纳入区间统计)。
3. **区间无数据**:返回 `[]`,前端 task-execute / problem 页空列表态(已有 `locale={{ emptyText }}`)。
4. **task-execute 详情 task 不存在**:`getPlanTask` 抛 404 时 catch 显示「关联任务已删除」,详情面板仍渲染 execute 本身字段(time_spent/execute_info/status)。
5. **工时为 0**:显式展示「工时:0」,不显示「—」(区分「未填报」与「填报 0」)。
6. **pro_type 未识别**:多态默认走全字段表单(`other`),不崩溃。
7. **list-by-date-range 路由顺序**:固定路径必须在 `/{item_id}` 前注册,否则 422。

## 非目标

- problemchange 多态标记为**可选**,优先级最低;若工时紧可只实现 list-by-date-range + task-execute 详情,多态留待后续。
- 不做 list-by-date-range 的导出(导出走现有 `/problem-list/export-excel` 全量)。
- 不动 problem 后端 schema(多态纯前端字段显隐)。
- 不改 task-plans/page.tsx 的 ExecuteDialog(本任务新增独立 task-execute 详情页,两者并存)。
- 不做 plan-nodes 重构(已就绪,仅验收)。

## 参考

- 现有 `frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx`(ChangeDrawer 多态改造基础)
- 现有 `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx`(独立完整页,验收基线)
- 现有 `frontend/src/app/(dashboard)/ppm/task-plans/page.tsx`(ExecuteDialog 模式,task-execute 详情页借鉴)
- 现有 `backend/app/modules/ppm/problem/router.py`(:81 list_problems / :109 get_problem,新端点插入顺序参考)
- 现有 `backend/app/modules/ppm/problem/service.py`(:184 list_problems / :192 `_changing_resource_ids` 变更中标记)
- 现有 `backend/app/modules/ppm/task/router.py`(:349 task_execute_by_date_range,date-range 端点范式)
- 现有 `frontend/src/lib/ppm/problem.ts`(:51 listProblems,client 范式)
- 现有 `backend/app/modules/ppm/problem/tests/test_problem_flow.py`(测试范式)

## TDD 步骤

1. **写测试**(后端优先,`problem/tests/test_list_by_date_range.py`):
   - 构造 3 条 problem(find_time 分别在区间内/外/为空)。
   - `GET /api/ppm/problem-list/list-by-date-range?start_date=...&end_date=...` 只返回区间内 1 条。
   - 反向区间(start>end)自动 swap,同样返回 1 条。
   - find_time 为空的不返回。
   - 区间无数据返回 `[]`。
   - 有未关闭变更的 problem effective_status=7。
2. **确认失败**:端点未注册 → 404。
3. **实现**:router 新增端点(固定路径前置)+ service 新增方法 + 变更中标记复用。
4. **确认通过**:pytest 全绿。
5. **前端实现**:lib client → task-execute 详情页 → problemchange 多态(可选)。
6. **回归**:`ruff format && ruff check && pytest`(后端)+ `tsc --noEmit && next lint`(前端)。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `GET /problem-list/list-by-date-range?start_date=&end_date=` | 200,返回 find_time 落在区间内的 ProblemListResp 列表 |
| AC-02 | 反向区间(start>end) | 自动 swap,正常返回,不报错 |
| AC-03 | find_time 为空的 problem | 不返回 |
| AC-04 | 区间无数据 | 返回 `[]` |
| AC-05 | 端点路由顺序 | `list-by-date-range` 不被 `/{item_id}` 吞(返回 200 非 422) |
| AC-06 | list-by-date-range pytest | 全绿(含 swap/空/变更中标记) |
| AC-07 | task-execute 详情页渲染 | `/ppm/task-execute` 加载,展示 execute 列表 + 行内详情(关联任务/工时/状态) |
| AC-08 | task-execute 关联任务删除 | 显示「关联任务已删除」,execute 字段仍渲染 |
| AC-09 | 工时为 0 | 显式「工时:0」 |
| AC-10 | problemchange 多态(可选) | bug 隐藏变更原因;change 标星必填;demand/默认全字段 |
| AC-11 | plan-nodes 独立页 CRUD | 模板/明细/模块三段 CRUD 可用,字段对齐源(验收基线,已就绪) |
| AC-12 | `lib/ppm/problem.ts` | `listProblemsByDateRange` 导出 + types 正确 |
| AC-13 | 后端 ruff format/check + 前端 tsc --noEmit + next lint | 全通过 |
