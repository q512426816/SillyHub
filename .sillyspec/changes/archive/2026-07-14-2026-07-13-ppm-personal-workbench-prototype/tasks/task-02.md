---
id: task-02
title: "workbench 子域骨架（schema DTO + service 空类 + router 3 接口 + main.py 挂载到 /api/ppm，权限 PPM_TASK_READ）（覆盖：FR-01, FR-12, D-001@v1, D-009@v1）"
title_zh: 工作台聚合子域骨架搭建
author: qinyi
created_at: 2026-07-14 09:27:18
priority: P0
depends_on: []
blocks: [task-03, task-04, task-05, task-07]
requirement_ids: [FR-01, FR-12]
decision_ids: [D-001@v1, D-009@v1]
allowed_paths:
  - backend/app/modules/ppm/workbench/__init__.py
  - backend/app/modules/ppm/workbench/schema.py
  - backend/app/modules/ppm/workbench/service.py
  - backend/app/modules/ppm/workbench/router.py
  - backend/app/main.py
provides:
  - contract: WorkbenchProfile
    fields: [display_name, employee_no, department_name, role_name, avatar_text]
  - contract: WorkbenchMetrics
    fields: [task_count, completion_rate, delay_rate, work_hours, defect_count]
  - contract: WorkbenchTodoItem
    fields: [id, name, type, source]
  - contract: WorkbenchSummary
    fields: [metrics, todos]
  - contract: WorkbenchCalendar
    fields: [year_month, days]
  - contract: CalendarDay
    fields: [date, load_level, alert_level, task_count]
expects_from:
  - contract: UserRead
    needs: [employee_no]
goal: >
  搭建 workbench 子域骨架，定义全部 DTO 与 3 个 GET 接口路由并挂载到 /api/ppm，service 方法体留空 NotImplementedError 待 task-03/04/05 实现。
implementation:
  - "新建 backend/app/modules/ppm/workbench/ 包（含空 __init__.py）"
  - "schema.py 定义 6 个 Pydantic BaseModel：WorkbenchProfile{display_name:str|None, employee_no:str|None, department_name:str|None, role_name:str|None, avatar_text:str}；WorkbenchMetrics{task_count:int, completion_rate:float, delay_rate:float, work_hours:float, defect_count:int}；WorkbenchTodoItem{id:str, name:str, type:str, source:str}；WorkbenchSummary{metrics:WorkbenchMetrics, todos:list[WorkbenchTodoItem]}；CalendarDay{date:str, load_level:str, alert_level:str, task_count:int}；WorkbenchCalendar{year_month:str, days:list[CalendarDay]}"
  - "service.py 定义 WorkbenchService 类，含 async get_profile(session, user)、async get_summary(session, user)、async get_calendar(session, user, year_month) 三方法，方法体统一 raise NotImplementedError"
  - "router.py: router = APIRouter(tags=['ppm-workbench'])，沿用 task/router.py L55-63 Annotated+Depends 模式定义 SessionDep/CurrentUser 别名；权限统一 require_permission_any(Permission.PPM_TASK_READ)；@router.get('/workbench/profile')、'/workbench/summary'、'/workbench/calendar'（query 参数 year_month:str）三端点，实例化 WorkbenchService 调对应方法返回"
  - "main.py: 顶部 import 段（L35 ppm_task_router 旁）加 'from app.modules.ppm.workbench.router import router as ppm_workbench_router'；挂载段（L477 ppm_kanban_router 后）加 app.include_router(ppm_workbench_router, prefix='/api/ppm')"
acceptance:
  - "from app.main import app 无 ImportError；OpenAPI 含 /api/ppm/workbench/profile、/api/ppm/workbench/summary、/api/ppm/workbench/calendar 三条路由"
  - "6 个 schema DTO 可独立实例化（传必填字段不报错）"
  - "WorkbenchService 三方法调用抛 NotImplementedError（证明骨架已接通但未实现）"
verify:
  - "cd backend && uv run python -c \"from app.main import app; print([r.path for r in app.routes if 'workbench' in r.path])\""
constraints:
  - "三个接口权限统一 PPM_TASK_READ（D-009@v1，复用现有权限不新建）"
  - "service 方法 NotImplementedError，不在 task-02 实现业务逻辑（留给 task-03/04/05）"
  - "不建新表、不写 migration（本任务纯骨架）"
  - "router 自身不带 prefix，统一由 main 挂载 prefix='/api/ppm'（与 ppm 其他子域一致）"
---
