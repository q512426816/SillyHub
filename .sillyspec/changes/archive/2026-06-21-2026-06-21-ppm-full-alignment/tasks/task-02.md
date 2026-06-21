---
id: task-02
title: 变更流4节点 + submitDetail + nextProcess/rejectProcess + 通知(覆盖:FR-02, D-012)
priority: P0
estimated_hours: 6
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-012@v1]
allowed_paths:
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/problem/service.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/problem/fsm.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/problem/router.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/problem/schema.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/router.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/service.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/schema.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/problem/tests/test_problem_flow.py
  - /Users/qinyi/SillyHub/backend/app/modules/ppm/plan/tests/test_plan_submit_detail.py
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/problem.ts
  - /Users/qinyi/SillyHub/frontend/src/lib/ppm/types.ts
  - /Users/qinyi/SillyHub/frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx
author: qinyi
created_at: 2026-06-21T02:37:10+0800
change: 2026-06-21-ppm-full-alignment
---

# task-02 变更流4节点 + submitDetail + nextProcess/rejectProcess + 通知

## 修改文件

### 后端
- `backend/app/modules/ppm/problem/service.py` — 新增 `ProChangeProcesssExecutor` 类(复用 problem 流骨架):变更流 `next_process` / `reject_process` / `done_change` / `close_change`,驱动 `ppm_problem_change` 走 4 节点(申请→开发经理→项目经理→部门经理→验证)。bug 跳过部门经理 40。每次流转写 `PpmProblemChangeProcessLog` + 删旧插新 `PpmProblemChangeProcessTask`,并通过 `session.info["audit_context"]` 触发 `audit_logs`(延续 D-006,无站内信)。
- `backend/app/modules/ppm/problem/fsm.py` — 扩展变更流状态:新增 `ProblemChangeNode`(IntEnum 10/20/30/40,复用 `ProblemNode` 数值或独立定义)与 `CHANGE_NODE_NEXT` / `compute_change_next_node`(bug 跳过 40),`is_change_audit_node`。
- `backend/app/modules/ppm/problem/router.py` — 在 `/problem-change` CRUD 组下新增流转端点:
  - `POST /problem-change/{id}/next` nextProcess
  - `POST /problem-change/{id}/reject` rejectProcess
  - `GET  /problem-change/{id}/tasks` 在办任务
  - `GET  /problem-change/{id}/logs` 流程履历
  权限 `PPM_PROBLEM_WRITE` / `PPM_PROBLEM_READ`。
- `backend/app/modules/ppm/problem/schema.py` — 新增 `ChangeNextProcessReq` / `ChangeRejectProcessReq`(带 `comment`)。
- `backend/app/modules/ppm/plan/router.py` — 新增 `POST /plan-node-detail/{id}/submit-detail`:接收 `detail: dict` JSON,落库到 `PpmPsPlanNodeDetail`(更新明细字段)。权限 `PPM_PLAN_WRITE`。
- `backend/app/modules/ppm/plan/service.py` — 新增 `submit_detail(item_id, detail, actor)` 方法:校验明细存在,merge detail dict 到明细字段,写一行 `PsPlanNodeDetailProcess`(node_key="submit_detail"),触发 audit。
- `backend/app/modules/ppm/plan/schema.py` — 新增 `SubmitDetailReq { detail: dict }`。

### 前端
- `frontend/src/lib/ppm/problem.ts` — 新增 `nextProcessProblemChange` / `rejectProcessProblemChange` / `listProblemChangeTasks` / `listProblemChangeLogs` client 函数。
- `frontend/src/lib/ppm/types.ts` — 新增 `ProblemChangeNextProcessReq` / `ProblemChangeRejectProcessReq` 类型。
- `frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx` — 列表行操作区加「推进」「驳回」按钮(仅 `status=1` 审核中可点),点击调 next/reject client,带 comment 输入框(popup 或行内)。流转后刷新列表。

### 审计日志调用点
- 复用现有 `app/core/audit_hooks.py` 的 SQLAlchemy after_insert/update 钩子:流转方法内通过 `session.info["audit_context"] = {"actor_id": ..., "workspace_id": None}` 注入 actor,钩子自动写 `audit_logs`(`action="ppm_problem_change.update"`)。无需手动调用,延续 D-006。

## 覆盖来源
- FR-02:变更流4节点 + submitDetail + nextProcess/rejectProcess + 审计日志通知
- D-012@v1:通知延续审计日志(不建站内信)

## 实现要求

### 1. ProChangeProcesssExecutor 4 节点状态机(problem/service.py)
对照源 `ProChangeProcesssExecutor` + problem 流骨架(`ProblemService.next_process`),驱动 `PpmProblemChange`:
- 节点链:`申请(10) → 开发经理(20) → 项目经理(30) → 部门经理(40) → 验证(结束)`
- `next_process(change_id, actor, comment)`:
  - 读 change,取 `now_node`(默认 10),`compute_change_next_node(now_node, pro_type)` 算下一节点
  - 下一节点为 None(结束):change.status=`ProblemChangeStatus.CLOSED`(2 已完成),`now_node=None`,`now_handle_user=change.audit_user_id`(验证人)
  - 审核节点(20/30/40):按 `NODE_TO_ROLE` 查 `PpmProjectMember`(change.project_id)找处理人,缺失则 `now_handle_user=None` + 抛 `ProblemPendingAssignment`(挂起)
  - bug 类型:Node30 直接结束,跳过部门经理 40
  - 每次:写 `PpmProblemChangeProcessLog` + 删旧插新 `PpmProblemChangeProcessTask` + `session.info["audit_context"]` 注入
- `reject_process(change_id, actor, comment)`:
  - 仅审核节点(20/30/40)可驳回
  - change.status=`ProblemChangeStatus.BACK`(3 已作废),`now_node=None`,`now_handle_user=None`
  - 清空所有在办 `PpmProblemChangeProcessTask`,写一行 log
- 非法状态迁移(如终态再推进)抛 `InvalidTransition`(422)

### 2. submitDetail(plan/router.py + service.py)
- `POST /plan-node-detail/{id}/submit-detail`,body `{ detail: dict }`
- `submit_detail(item_id, detail, actor)`:
  - 读 `PsPlanNodeDetail`,将 `detail` 中非 None 的键 merge 到明细字段(白名单字段:`task_theme` / `task_description` / `requirements` / `role_name` / `achievement` / `plan_workload` / `plan_begin_time` / `plan_complete_time` / `execute_user_id` / `module_id` / `file_urls`),未知键忽略
  - 写一行 `PsPlanNodeDetailProcess`(node_key="submit_detail",business_type=PROCESS_BUSINESS_TYPE)
  - 注入 `audit_context` → audit_hooks 自动记录

### 3. 路由签名(router.py)
```python
@router.post("/problem-change/{item_id}/next", response_model=ProblemChangeResp)
async def next_change(item_id, body: ChangeNextProcessReq, session, user=Depends(require_permission_any(PPM_PROBLEM_WRITE)))

@router.post("/problem-change/{item_id}/reject", response_model=ProblemChangeResp)
async def reject_change(item_id, body: ChangeRejectProcessReq, session, user=Depends(require_permission_any(PPM_PROBLEM_WRITE)))

@router.get("/problem-change/{item_id}/tasks", response_model=list[ProcessTaskResp])
@router.get("/problem-change/{item_id}/logs", response_model=list[ProcessLogResp])

@router.post("/plan-node-detail/{item_id}/submit-detail", response_model=PsPlanNodeDetailResp)
async def submit_detail(item_id, body: SubmitDetailReq, session, user=Depends(require_permission_any(PPM_PLAN_WRITE)))
```

### 4. Executor 类方法签名(problem/service.py)
```python
class ProblemService:  # 复用现有 service 类,内嵌变更流方法(不单独建类,与现有 next_process 同层)
    async def next_change(self, change_id: uuid.UUID, *, actor_id: str, actor_name: str | None, comment: str | None = None) -> PpmProblemChange
    async def reject_change(self, change_id: uuid.UUID, *, actor_id: str, actor_name: str | None, comment: str | None = None) -> PpmProblemChange
    async def list_change_tasks(self, business_id: str) -> list[PpmProblemChangeProcessTask]
    # list_change_logs 已存在
```
> 注:设计稿提 `ProChangeProcesssExecutor` 独立类,但现有 `ProblemService` 已内聚 problem+change 逻辑(`list_changes`/`create_change` 已在 ProblemService),为保持一致性,变更流方法也挂在 `ProblemService` 内,类名在 docstring/注释中标明「对应源 ProChangeProcesssExecutor」。

### 5. fsm 状态迁移表(problem/fsm.py)
```python
class ProblemChangeNode(IntEnum):  # 复用 ProblemNode 数值
    APPLY = 10
    DEVELOP_MGR = 20
    PM_MGR = 30
    DEPT_MGR = 40

CHANGE_NODE_NEXT = {10: 20, 20: 30, 30: 40, 40: None}
def compute_change_next_node(now_node: int, pro_type: str | None) -> int | None:
    # bug 在 30 直接结束,跳过 40
    if now_node == 30 and pro_type == BUG_TYPE:
        return None
    return CHANGE_NODE_NEXT.get(now_node)
```
> 变更流复用 `NODE_TO_ROLE` / `NODE_NAMES` / `BUG_TYPE`,不重复定义角色映射。

### 6. audit_log 调用
流转方法内:
```python
self._session.info["audit_context"] = {"actor_id": uuid.UUID(actor_id), "workspace_id": None}
```
钩子在 `commit()` 时自动写 `audit_logs`。变更完成后清理 `session.info["audit_context"]` 避免污染后续同会话操作。

### 7. TS client(lib/ppm/problem.ts)
```typescript
export async function nextProcessProblemChange(changeId: string, body?: ProblemChangeNextProcessReq): Promise<ProblemChange>
export async function rejectProcessProblemChange(changeId: string, body?: ProblemChangeRejectProcessReq): Promise<ProblemChange>
export async function listProblemChangeTasks(changeId: string): Promise<ProblemProcessTask[]>
export async function listProblemChangeLogs(changeId: string): Promise<ProblemProcessLog[]>
```

## 边界处理
1. **无下一处理人挂起**:审核节点找不到对应角色 `PpmProjectMember` → `now_node` 仍推进,`now_handle_user=None`,抛 `ProblemPendingAssignment`(http 200,业务成功待指派),前端提示「项目缺少 XX 角色,待指派」。
2. **非法状态迁移**:终态(2 已完成 / 3 已作废)再 `next_process` → 抛 `ProblemError`(400);非法 fsm 迁移抛 `InvalidTransition`(422)。
3. **reject 限制**:仅审核节点(20/30/40)可 reject;申请节点(10)reject 抛 `ProblemError`(400)。
4. **权限校验**:next/reject 需 `PPM_PROBLEM_WRITE`;tasks/logs 查询需 `PPM_PROBLEM_READ`;submit-detail 需 `PPM_PLAN_WRITE`。无权限 403。
5. **幂等 next_process**:同一 change 连续两次 next_process 第二次(若仍在审核节点)正常推进到再下一节点;若已到结束态,第二次抛 `ProblemError`(幂等失败而非静默)。
6. **submitDetail 未知字段**:白名单外字段忽略,不报错不落库,返回更新后明细。
7. **bug 跳过部门经理**:`pro_type == "bug"` 时 Node30 next 直接返回 None(结束),不查部门经理,即使项目无部门经理也不挂起。

## 非目标
- 不做站内信/消息推送(D-012 决定用审计日志 + 前端轮询,延续 D-006)。
- 不做文件附件上传(D-007),变更/明细附件仍走 `file_urls` JSON 数组,前端只传 URL。
- 不做工作流 silly 引擎(D-002,状态机替代)。
- 不重写 problem 主流(已就绪),仅复用其骨架扩展变更流。
- 不做变更 done/close 子状态(变更结束即 status=2,无独立待验证/处置环节,简化于源)。

## 参考
- `backend/app/modules/ppm/problem/fsm.py` — 现有 problem 流骨架(`TRANSITIONS` / `NODE_NEXT` / `compute_next_node` / `is_audit_node`)
- `backend/app/modules/ppm/problem/service.py` — `ProblemService.next_process` / `reject_process`(变更流照此模式实现)
- `backend/app/modules/ppm/problem/tests/test_problem_flow.py` — 测试模式(`_make_project` / `_make_problem` / `TestFullFlow` / `TestFallback`)
- `backend/app/modules/ppm/plan/service.py` — `PlanService.change_process` / `_write_process`(submitDetail 履历写入参考)
- `backend/app/core/audit_hooks.py` — audit_context 注入 + 自动写 audit_logs
- 源 `change.TRANSITIONS` / `ProChangeProcesssExecutor`(dept_project_back/ppdmq-module-ppm)
- `frontend/src/app/(dashboard)/ppm/problem-changes/page.tsx` — 现有列表页结构(加按钮)

## TDD 步骤
1. **写测试先行**:
   - `backend/app/modules/ppm/problem/tests/test_problem_flow.py` 新增 `TestChangeFlow` 类:
     - `test_change_full_flow_non_bug`:10→20→30→40→结束,每步 now_node + 处理人 + status 断言
     - `test_change_bug_skips_dept`:bug 在 30 直接结束
     - `test_change_reject_to_back`:20 节点 reject → status=3
     - `test_change_reject_on_apply_rejected`:10 节点 reject 抛 ProblemError
     - `test_change_missing_role_pending`:无项目经理 → 抛 ProblemPendingAssignment,now_node 已推进
     - `test_change_each_step_writes_log`:每次 next 写一行 PpmProblemChangeProcessLog + 删旧插新 ProcessTask
   - `backend/app/modules/ppm/plan/tests/test_plan_submit_detail.py` 新增:
     - `test_submit_detail_updates_fields`:submit-detail 后 task_theme/requirements 等白名单字段更新
     - `test_submit_detail_ignores_unknown_keys`:未知字段忽略
     - `test_submit_detail_writes_process`:写一行 PsPlanNodeDetailProcess(node_key="submit_detail")
2. **跑测试确认全红**:`pytest backend/app/modules/ppm/problem/tests/test_problem_flow.py::TestChangeFlow backend/app/modules/ppm/plan/tests/test_plan_submit_detail.py` 全失败。
3. **实现 fsm 扩展**(ProblemChangeNode / compute_change_next_node)。
4. **实现 service 方法**(next_change / reject_change / list_change_tasks + submit_detail)。
5. **实现 router 端点** + schema DTO。
6. **实现前端 client + 按钮区**。
7. **跑测试全绿** + ruff format/check + tsc --noEmit。

## 验收标准

| AC | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | 变更流 nextProcess 4 节点流转(非 bug:10→20→30→40→结束)正确,now_node / now_handle_user / status 每步符合预期 | `pytest test_problem_flow.py::TestChangeFlow::test_change_full_flow_non_bug` 通过 |
| AC-2 | bug 类型在 Node30 直接结束(跳过部门经理 40) | `test_change_bug_skips_dept` 通过 |
| AC-3 | rejectProcess 仅审核节点可驳回,驳回后 status=3 已作废,清空在办任务 | `test_change_reject_to_back` + `test_change_reject_on_apply_rejected` 通过 |
| AC-4 | 项目缺角色成员 → ProblemPendingAssignment 挂起,now_node 已推进,now_handle_user 为空 | `test_change_missing_role_pending` 通过 |
| AC-5 | 每次流转写一行 PpmProblemChangeProcessLog + 删旧插新 ProcessTask | `test_change_each_step_writes_log` 通过 |
| AC-6 | submitDetail 落库 detail JSON 到明细白名单字段,未知键忽略,写一行履历 | `test_plan_submit_detail.py` 3 测试通过 |
| AC-7 | 审计日志:每次流转 audit_logs 表有对应 `ppm_problem_change.update` 记录(D-012,无站内信) | 测试中检查 `session.info["audit_context"]` 注入 + 手动验证 audit_hooks 触发 |
| AC-8 | 权限:next/reject 需 PPM_PROBLEM_WRITE,submit-detail 需 PPM_PLAN_WRITE,无权限 403 | router 层 `require_permission_any` 装饰(复用现有模式,同 problem-list/next) |
| AC-9 | 后端 ruff format + ruff check + pytest 全绿 | `cd backend && ruff format app/modules/ppm && ruff check app/modules/ppm && pytest app/modules/ppm/problem/tests app/modules/ppm/plan/tests` |
| AC-10 | 前端 tsc --noEmit + next lint 通过,problem-changes 页有推进/驳回按钮 | `cd frontend && npx tsc --noEmit && npm run lint` |
