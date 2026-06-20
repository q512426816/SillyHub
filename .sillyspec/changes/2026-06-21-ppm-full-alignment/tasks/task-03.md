---
id: task-03
title: projectplan 三联表 + 成本派生 + 17字段表单
priority: P0
estimated_hours: 6
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-014@v1]
allowed_paths:
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/service.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/router.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/schema.py
  - /Users/qinyi/SillyHub/backend/tests/modules/ppm/plan/test_three_level_query.py
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/project-plans/page.tsx
  - /Users/qinyi/SillyHub/frontend/src/components/ppm-project-plan-detail.tsx
  - /Users/qinyi/SillyHub/frontend/src/components/ppm-project-plan-form.tsx
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/plan.ts
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/types.ts
author: qinyi
created_at: 2026-06-21T02:37:10+0800
---

# task-03 蓝图：projectplan 三联表 + 成本派生 + 17字段表单

## 修改文件

| 层 | 文件 | 改动 |
|---|---|---|
| 后端 service | `backend/app/modules/ppm/plan/service.py` | 新增 `get_project_plan_three_level(plan_id)` 方法：联表 `PsProjectPlan → PsPlanNode → PsPlanNodeDetail`，聚合任务 `PlanTask`（经 `ps_plan_node_detail_id`），并在 service 层注入成本派生 `remaining_available_person_days` / `remaining_cost` |
| 后端 schema | `backend/app/modules/ppm/plan/schema.py` | 新增 `ProjectPlanThreeLevelResp`（含 `plan: PsProjectPlanResp` + `nodes: list[PsPlanNodeWithDetail]`，每节点挂 `details + tasks`），在 `PsProjectPlanResp` 上追加派生只读字段（`remaining_available_person_days` / `remaining_cost`） |
| 后端 router | `backend/app/modules/ppm/plan/router.py` | 新增 `GET /project-plan/{plan_id}/three-level`，权限 `PPM_PLAN_READ`，返回 `ProjectPlanThreeLevelResp` |
| 后端 test | `backend/tests/modules/ppm/plan/test_three_level_query.py` | 新建：三联表结构 / remaining 计算 / null 处理 / 空任务 / 嵌套层级 5 用例 |
| 前端组件 | `frontend/src/components/ppm-project-plan-detail.tsx` | 新建：三联表展示组件（复用 `PpmSubTable` 展开行模式，plan→node→detail→task 嵌套） |
| 前端组件 | `frontend/src/components/ppm-project-plan-form.tsx` | 新建：17 字段表单抽屉（从 `project-plans/page.tsx` 的内联 `PlanFormDrawer` 抽出并补齐字段） |
| 前端 page | `frontend/src/app/(dashboard)/ppm/project-plans/page.tsx` | 行操作新增「详情」按钮 → 展开三联表（侧抽屉或行内 expand）；表单改用新 17 字段组件 |
| 前端 lib | `frontend/src/lib/ppm/plan.ts` | 新增 `getProjectPlanThreeLevel(planId)` TS client |
| 前端 types | `frontend/src/lib/ppm/types.ts` | 新增 `ProjectPlanThreeLevel` / `PsPlanNodeWithDetail` / `PlanTaskSimple` 类型 |

## 覆盖来源

- **FR-03** projectplan 三联表 + 成本派生 + 17 字段表单
- **D-014@v1** 成本字段派生计算（remaining = budget − actual），后端 model 已有字段，补计算派生 + 前端 17 字段表单

## 实现要求

### 三联表联表语义

```
PsProjectPlan (项目计划 ppm_ps_project_plan)
  └── PsPlanNode (PS节点 ppm_ps_plan_node, FK: ps_project_plan_id)
        └── PsPlanNodeDetail (里程碑明细 ppm_ps_plan_node_detail, FK: plan_node_id)
              └── PlanTask (任务 ppm_plan_task, FK: ps_plan_node_detail_id)
```

- 三层 + 任务挂载：`project_plan → ps_plan_node → ps_plan_node_detail → plan_task`
- 字符串外键沿用现有约定（`ps_project_plan_id` / `plan_node_id` 为 `String(64)`，`PlanTask.ps_plan_node_detail_id` 为 UUID；join 时把 detail.id 字符串化匹配）
- `PsPlanNodeDetail` 仅取「最新有效」版本（排除 `status='archived'`，复用 `list_details_by_node` 的过滤）
- service 层一次性 N+1 友好查询：先取 plan，再批量取 nodes（按 `ps_project_plan_id`）、details（按 `plan_node_id IN (...)`）、tasks（按 `ps_plan_node_detail_id IN (...)`），在内存里组装嵌套结构，避免逐行 lazy load

### 成本派生（D-014@v1）

在 `PlanService.get_project_plan_three_level` 计算后注入到 plan VO 的只读派生字段（不落库，纯查询时计算）：

- `remaining_available_person_days = budget_person_days − actual_consumption_person_days`（人天）
- `remaining_cost = total_cost − labor_cost`（成本）
- 源 model 字段为 `String`（源前端直接传字符串），计算时 `Decimal` 解析；任一操作数为 null / 非数值 → 派生结果 `None`（不 clamp，见边界处理）

### 17 字段表单

对照源 Vue `ProjectPlanTaskTable.vue` + 后端 `PsProjectPlanBase`，表单录入字段 17 个（派生字段 `remaining_*` 与系统字段 `id/created_at/updated_at/create_name` 不进表单）：

| # | 字段名 | 中文标签 | 控件 |
|---|---|---|---|
| 1 | `project_id` | 项目 ID | text（必填，编辑态只读） |
| 2 | `project_name` | 项目名称 | text |
| 3 | `project_manager_id` | 项目经理 ID | text |
| 4 | `project_manager_name` | 项目经理 | text |
| 5 | `project_start_time` | 项目开始时间 | date |
| 6 | `project_plan_end_time` | 计划结束时间 | date |
| 7 | `contract_sign_time` | 合同签订时间 | date |
| 8 | `contract_name` | 合同名称 | text |
| 9 | `contract_amount` | 合同金额 | text（源 String 语义，不强制数值） |
| 10 | `profit_margin` | 利润率 | text |
| 11 | `profit_amount` | 利润金额 | text |
| 12 | `module` | 模块 | textarea |
| 13 | `budget_amount` | 预算金额 | text |
| 14 | `budget_person_days` | 预算人天 | text |
| 15 | `actual_consumption_person_days` | 实际消耗人天 | text |
| 16 | `status` | 状态 | select（draft / approving / done） |
| 17 | `company_name` | 公司名称 | text |

> 注：`adjustment_person_days` / `total_cost` / `labor_cost` / `cost_adjustment` 为可选成本扩展字段，归入「成本区」同一表单分组但非强制 17 项；若计入则超出 17，按源 Vue 主表分组「基本信息 / 合同信息 / 成本信息」三段渲染。本任务以 17 录入字段为准。

## 接口定义

### service 联表查询方法签名

```python
class PlanService:
    async def get_project_plan_three_level(
        self, plan_id: uuid.UUID
    ) -> PsProjectPlan:
        """三联表查询 + 成本派生注入。

        返回一个 PsProjectPlan ORM 对象，其上挂载动态属性：
        - ``._nodes: list[PsPlanNode]``（已按 no 排序）
        - 每个 PsPlanNode 挂 ``._details: list[PsPlanNodeDetail]``
        - 每个 PsPlanNodeDetail 挂 ``._tasks: list[PlanTask]``
        - plan 对象的 remaining_available_person_days /
          remaining_cost 已被 service 层覆写为计算值（原 String 字段
          保留不动，派生值经 schema 单独字段返回，见下）。
        """
```

> 实现细节：为避免污染 ORM，service 返回一个轻量 dataclass / dict 组装结果，由 router 转 `ProjectPlanThreeLevelResp`。不强制挂动态属性。

### Pydantic schema（全字段）

```python
class PlanTaskSimple(PydanticModel):
    """三联表叶子节点 — 任务精简视图。"""
    id: uuid.UUID
    content: str | None = None
    status: str | None = None
    work_load: str | None = None
    time_spent: float | None = None
    user_name: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    model_config = {"from_attributes": True}


class PsPlanNodeDetailWithTasks(PsPlanNodeDetailResp):
    """明细 + 其下挂载的任务列表。"""
    tasks: list[PlanTaskSimple] = Field(default_factory=list)


class PsPlanNodeWithDetail(PsPlanNodeResp):
    """PS 节点 + 其下挂载的明细（含任务）。"""
    details: list[PsPlanNodeDetailWithTasks] = Field(default_factory=list)


class ProjectPlanThreeLevelResp(PsProjectPlanResp):
    """项目计划三联表响应（顶层）。"""
    # 派生成本字段（service 层计算注入，不落库）
    remaining_available_person_days: str | None = None
    remaining_cost: str | None = None
    nodes: list[PsPlanNodeWithDetail] = Field(default_factory=list)
```

### 成本计算伪代码

```python
from decimal import Decimal, InvalidOperation

def _to_decimal(s: str | None) -> Decimal | None:
    if s is None or str(s).strip() == "":
        return None
    try:
        return Decimal(str(s).strip())
    except (InvalidOperation, ValueError):
        return None

def _derive_remaining(budget_s: str | None, actual_s: str | None) -> str | None:
    b = _to_decimal(budget_s)
    a = _to_decimal(actual_s)
    if b is None or a is None:
        return None  # 任一为空 → 不计算（不 clamp 到 0）
    r = b - a  # 允许负值（超支），见边界处理
    # 规整：去掉无意义尾零，但保留 Decimal 精度语义
    return str(r.normalize() if r == r.to_integral_value() else r)
```

注入点（service 内）：

```python
plan.remaining_available_person_days = _derive_remaining(
    plan.budget_person_days, plan.actual_consumption_person_days
)
plan.remaining_cost = _derive_remaining(
    plan.total_cost, plan.labor_cost
)
```

### router 端点

```python
@router.get(
    "/project-plan/{plan_id}/three-level",
    response_model=ProjectPlanThreeLevelResp,
)
async def get_project_plan_three_level(
    plan_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.PPM_PLAN_READ))],
) -> ProjectPlanThreeLevelResp:
    return await PlanService(session).get_project_plan_three_level(plan_id)
    # service 内部组装 ProjectPlanThreeLevelResp 并返回（或 router 转）
```

### TS client

```typescript
// lib/ppm/plan.ts
export async function getProjectPlanThreeLevel(
  planId: string,
): Promise<ProjectPlanThreeLevel> {
  return apiFetch<ProjectPlanThreeLevel>(
    `/api/ppm/project-plan/${planId}/three-level`,
  );
}
```

### TS 类型（lib/ppm/types.ts 新增）

```typescript
export interface PlanTaskSimple {
  id: string;
  content: string | null;
  status: string | null;
  work_load: string | null;
  time_spent: number | null;
  user_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface PsPlanNodeDetailWithTasks extends PsPlanNodeDetail {
  tasks: PlanTaskSimple[];
}

export interface PsPlanNodeWithDetail extends PsPlanNode {
  details: PsPlanNodeDetailWithTasks[];
}

export interface ProjectPlanThreeLevel extends PsProjectPlan {
  remaining_available_person_days: string | null;
  remaining_cost: string | null;
  nodes: PsPlanNodeWithDetail[];
}
```

## 边界处理

1. **budget / actual 为 null → remaining=None**：`_derive_remaining` 任一操作数无法解析为 Decimal 即返回 `None`，前端展示「—」，不默认 0、不 clamp。
2. **无关联 PS 节点 → nodes 返回空数组**：plan 存在但无子节点时 `nodes=[]`，三联表展示组件渲染「暂无里程碑」占位。
3. **节点无明细 / 明细无任务 → 空数组**：`details=[]` / `tasks=[]`，嵌套层级保留（结构不塌缩），前端表格显式空态。
4. **三联表层级 null**：若 `PlanTask.ps_plan_node_detail_id` 为 null（孤儿任务）则不挂到任何 detail 下（不强行归并），保持层级纯净。
5. **成本负值（超支）允许**：`remaining = budget − actual` 允许负数，前端用红色文字标注「超支」，**不 clamp 到 0**（源语义：如实反映超支）。
6. **非数值字符串**：`budget_person_days="N/A"` 之类 → `_to_decimal` 返回 None → remaining=None，不抛异常。
7. **分页**：三联表查询为「单个 plan 的完整树」，**不分页**（单计划数据量可控）；项目计划列表 `GET /project-plan` 仍走现有分页。
8. **archived 版本过滤**：明细层复用 `list_details_by_node` 的 `status != 'archived'` 过滤，变更归档旧版本不进三联表。

## 非目标

- 不做成本历史趋势（remaining 随时间变化曲线）
- 不做预算审批流（budget 变更走 PsProjectPlan 普通更新，不引入状态机）
- 不做金额单位换算 / 币种（源为字符串直传，本任务保留）
- 不做三联表导出 Excel（导出复用现有 `/plan-node/export-excel`，超出本任务）
- 不做前端图表（W5 task-05 负责 remaining 条形图）

## 参考

- 后端现有查询：`backend/app/modules/ppm/plan/service.py` 的 `list_ps_plan_nodes_by_plan` / `list_details_by_node`（三联表的逐层查询骨架）
- 任务关联：`backend/app/modules/ppm/task/model.py` `PlanTask.ps_plan_node_detail_id`（UUID 软关联，无 FK 约束）
- 前端组件：`frontend/src/components/ppm-sub-table.tsx`（展开行模式 `expandRender`，三联表复用嵌套）
- 前端现页：`frontend/src/app/(dashboard)/ppm/project-plans/page.tsx` 内联 `PlanFormDrawer`（抽出补 17 字段）
- 源：`dept_project_back/front/.../ProjectPlanTaskTable.vue`（17 字段表单 + 三联表展开行，源不在本机时按 model 反推）

## TDD 步骤

1. **先写测试** `backend/tests/modules/ppm/plan/test_three_level_query.py`：
   - `test_three_level_basic_structure`：构造 plan + 1 node + 2 detail + 3 task，断言嵌套结构（plan.nodes[0].details[*].tasks[*]）正确
   - `test_remaining_person_days_calc`：`budget_person_days="100"` / `actual_consumption_person_days="30"` → `remaining_available_person_days="70"`
   - `test_remaining_cost_calc`：`total_cost="5000"` / `labor_cost="1200"` → `remaining_cost="3800"`
   - `test_remaining_null_when_operand_missing`：budget=None → remaining=None（不 clamp 0）
   - `test_remaining_negative_allowed`：budget="50" / actual="80" → remaining="−30"（超支，允许负值）
   - `test_empty_nodes_returns_empty_array`：plan 无子节点 → `nodes=[]`
   - `test_archived_detail_excluded`：明细 status='archived' 不出现在 details
   - `test_orphan_task_not_attached`：PlanTask.ps_plan_node_detail_id 指向不存在 detail → 不挂载
2. **跑测试**（应全红）：`cd backend && pytest tests/modules/ppm/plan/test_three_level_query.py -q`
3. **写 service**：实现 `get_project_plan_three_level` + `_derive_remaining` helper
4. **写 schema**：新增 4 个 Pydantic 类
5. **写 router**：新增端点
6. **跑测试**（应全绿）：重跑 pytest
7. **写前端**：types → plan.ts client → form 组件 → detail 组件 → page 接入
8. **前端验证**：`cd frontend && npx tsc --noEmit && npm run lint`
9. **手测**：启动后端 + 前端，打开 `/ppm/project-plans`，点「详情」看三联表展开，编辑看 17 字段表单

## 验收标准

| AC # | 验收项 | 验证方式 | 通过判据 |
|---|---|---|---|
| AC-1 | 三联表查询返回正确嵌套结构 | `pytest test_three_level_query.py::test_three_level_basic_structure` | plan.nodes[*].details[*].tasks[*] 层级与数据匹配构造数据 |
| AC-2 | remaining_person_days 计算正确 | `pytest ::test_remaining_person_days_calc` | "100"−"30"="70" |
| AC-3 | remaining_cost 计算正确 | `pytest ::test_remaining_cost_calc` | "5000"−"1200"="3800" |
| AC-4 | null 操作数 → remaining=None | `pytest ::test_remaining_null_when_operand_missing` | 返回 None（非 "0"） |
| AC-5 | 超支允许负值（不 clamp） | `pytest ::test_remaining_negative_allowed` | "50"−"80"="−30" |
| AC-6 | archived 明细被排除 | `pytest ::test_archived_detail_excluded` | details 不含 status='archived' 行 |
| AC-7 | 后端 ruff format + ruff check | `cd backend && ruff format && ruff check` | 0 error |
| AC-8 | 后端全量 pytest 不回归 | `cd backend && pytest -q` | 新增测试绿 + 原有不红 |
| AC-9 | 前端 tsc --noEmit | `cd frontend && npx tsc --noEmit` | 0 error |
| AC-10 | 前端 next lint | `cd frontend && npm run lint` | 0 error |
| AC-11 | 17 字段表单渲染 | 手测：编辑项目计划 | 17 个字段控件全部可见可填可提交 |
| AC-12 | 17 字段表单提交落库 | 手测：填值保存 | 后端 PUT 成功，再打开表单值回显 |
| AC-13 | 三联表前端嵌套展示 | 手测：点「详情」 | plan → node → detail → task 四层展开正常，空态「—」 |
| AC-14 | 前端 remaining 派生展示 | 手测 | remaining_person_days / remaining_cost 在三联表顶部或详情区显示（含负值红色） |
| AC-15 | 对照源逐项 verify | 读源 ProjectPlanTaskTable.vue 字段 | 17 字段名与源一致（源不可达时按 model 反推，verify 时核对） |
