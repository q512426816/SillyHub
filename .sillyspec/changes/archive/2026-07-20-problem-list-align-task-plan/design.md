---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
status: draft
scale: large
---

# 设计文档（Design）— 问题清单对齐任务计划

## 1. 背景

PPM 模块里「任务计划」(`/ppm/task-plans`) 和「问题清单」(`/ppm/problem-list`) 是两条并行的工时填报业务。任务计划在 `2026-07-16-workbench-load-crossday`（已归档）+ `2026-07-20-workbench-task-modal-align`（活跃，代码未 commit）两次变更后，已经形成一套成熟的执行模式：

- **统一弹窗** `task-detail-modal.tsx`：detail（只读信息卡 + 执行记录表）/ execute（跨天填报区）双模式。
- **两段式执行**：列表「启动」→ 后端建一条 in-flight `TaskExecute`（status=30）+ 任务状态「未开始→进行中」；列表「执行」→ 弹窗跨天填报，「提交」回未开始（可再次启动 = **重复执行**）/「完成」进已完成。
- **3 态状态机**：`PlanTask.status` 中文「未开始 / 进行中 / 已完成」。

问题清单现状（`backend/app/modules/ppm/problem/` + `frontend/.../ppm/problem-list/`）则是另一套较旧的交互：

- **两套入口**：详情是内联在 `page.tsx` 的只读 `Modal`，处置是独立的右侧 `_problem-drawer`（`mode=done`）。
- **一步到位的处置**：`POST /problem-list/{id}/done`（`done_task` service）单次填一段，无 in-flight、无跨天、不可重复执行（`completed=false` 只是累加 `handle_info` 留在执行中）。
- **7 态状态机残留**：`PpmProblemList.status` 数字 1-7（已保存/审核中/执行中/已完成/已作废/待验证/变更中）。`2026-07-17` 起 `submit` 已精简为直接生效（1→3），但 `fsm.py` 仍保留 `ProblemNode` 4 节点审批链、`next/reject/close` 端点、问题变更（`problem_change`）审批流、`effective_status` 的「7 变更中」内存覆盖等大量遗留。

两条业务线交互不一致，用户认知割裂；问题清单缺失「跨天填报」「重复执行」能力。

## 2. 设计目标

把问题清单的**详情弹窗**和**执行流程**整体对齐成任务计划那套：

1. **统一弹窗**：新建 `problem-detail-modal.tsx`，detail / execute 双模式，结构复刻 `task-detail-modal`。
2. **两段式执行**：新增 `POST /problem-list/{id}/start` + `PUT /problem-list/{id}/execute`，仿 `task/service.py` 的 `start` / `execute_plan`，支持跨天填报 + 重复执行。
3. **3 态状态机**：`PpmProblemList.status` 数字 1-7 → 中文「新建 / 进行中 / 已完成」，删审核 / 验证 / 驳回流程及残留端点。
4. **列表操作列对齐**：新建态→「开始」、进行中→「执行」、任意态→「详情 / 编辑 / 删除（本人或管理员）」。
5. 复用任务计划已验证的跨天拆分算法与 `TaskExecute` 记录模型，保证两条线工时填报语义一致。

## 3. 非目标（明确不做）

- **不泛化 `task-detail-modal` 成通用组件**：task 与 problem 字段差异大，泛化条件分支丑；且该组件来自未 commit 的 `workbench-task-modal-align` 变更，泛化会把两个变更绑死（决策 D-006，方案 B）。跨天拆分算法在 problem-detail-modal 内重新实现（~150 行，可接受重复）。
- **不删问题变更（`problem_change`）模块的后端代码与表**：该模块独立，爆炸半径大；本变更只停用其前端入口 + 删 `effective_status` 的「7 变更中」覆盖逻辑，保证 status 3 态。后端 `problem_change` 端点/表保留并标注 deprecated（决策 D-005）。
- **不改任务计划任何代码**：`task` 子域、`task-detail-modal.tsx`、`task-plans/page.tsx` 只读参照，不触碰。
- **不做数据历史兼容**：项目未上线，开发/测试数据可清空（CLAUDE.md 规则 11），migration 直接改 `status` 值映射，不保留旧数字。
- **不引入新权限**：复用现有 `PPM_PROBLEM_READ/WRITE/DELETE` + 已 merge 的数据范围注入（`c2d1e10b`）。

## 4. 拆分判断

单变更可承载，不拆分、不走批量模式（详见 brainstorm Step 5 评估）：前端弹窗 + 后端两段式 + 状态机清理三者紧密耦合于「问题清单单一执行流」，不可独立交付；无多角色视图；状态流转在单页内不跨页；任务数 < 10 无重复模式。

## 5. 总体方案

分 3 个 Wave（plan 阶段细化任务卡）：

### Wave 1：后端状态机简化 + 两段式端点

1. `fsm.py` 重写：`ProblemStatus` 3 态中文（新建 / 进行中 / 已完成）+ `TRANSITIONS`（删 AUDITING / BACK / WAIT_CHECK 分支）；删**主流审批专用**推进逻辑 `NODE_NAMES` / `NODE_TO_ROLE` / `NODE_NEXT` / `compute_next_node` / `is_audit_node`；**保留 `ProblemNode` 枚举**（变更流 `CHANGE_NODE_NEXT` / `compute_change_next_node` / `is_change_audit_node` 依赖，D-005 problem_change deprecated 模块仍引用）+ `ProblemChangeStatus` / `CHANGE_*` / `BUG_TYPE` / `CHANGE_TYPE`，避免连锁断裂。
2. `model.py`：`PpmProblemList.status` 默认值 `"1"`→`"新建"`，列宽 `String(8)`→`String(30)`（对齐 `PlanTask.status String(30)`）；`effective_status` property 简化为直接返回 `status`（删 `_effective_status` 内存覆盖）；`now_node` / `check_*` / `audit_*` / `handle_info` 字段**保留不删**（减少 migration + 无害），service 不再写入。
3. `service.py`：删 `next_process` / `submit_problem` / `reject_process` / `done_task` / `close_task` / `list_list_tasks` / `list_list_logs`（删 `next_process` 前先改 `create_problem`：去掉 `submit` 触发 `next_process` 的调用链，新建统一 `status=新建`，G5 链式顺序）；新增 `start`（建 in-flight `TaskExecute(problem_task_id, plan_task_id=None, status=30)` + 问题状态「新建→进行中」+ 校验仅新建态可启动 + 返回 `TaskExecute`）+ `execute_problem`（收口 in-flight → status=90 + 跨天校验 + in-flight 互斥校验 D-002 + `action=submit` 回新建 / `action=complete` 进已完成）；`list_problems` 删 `_effective_status=7` 覆盖。
4. `router.py`（D-003）：删 `/{id}/next` / `/submit` / `/reject` / `/done` / `/close` / `/tasks` / `/logs`；新增 `POST /{id}/start` + `PUT /{id}/execute`；`problem-change` 全部端点保留（deprecated）。
5. `schema.py`：删 `NextProcessReq` / `RejectProcessReq` / `DoneTaskReq` / `CloseTaskReq` / `ProcessTaskResp` / `ProcessLogResp`；删 `ProblemListCreate.submit` 字段（G2，create 不再按 submit 触发审批）；新增 `StartReq`（`problem_id` + 可选 `actual_start_time`）+ `ExecuteProblemReq`（`problem_id` + `task_execute_id` + `action: Literal["submit","complete"]` + `execute_info` / `time_spent` / `actual_end_time`）；`ProblemListResp.effective_status` 字段**保留**（简化后恒等于 `status`，前端读法不变、值改中文 3 态，G3）。
6. 新增 alembic migration `20260720_problem_status_3state.py`（`down_revision = "20260718_project_org_id"`）：`ALTER ppm_problem_list.status` 列宽 → String(30)；`UPDATE` 值映射 `1→新建, 3→进行中, 4→已完成, 2/5/6/7→新建`；保留 `now_node` / `check_*` 等列不删。

### Wave 2：前端统一弹窗 + 列表操作列

1. 新建 `frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx`：结构复刻 `task-detail-modal.tsx`（任务信息卡 + 处置记录表 + 跨天填报区 + 提交回新建 / 完成两按钮），信息卡字段换成问题清单模型（项目 / 模块 / 功能名称 / 问题类型 / 紧急度 / 责任人 / 发现人 / 发现日期 / 计划起止 / 已消耗 / 问题描述）；`listTaskExecutes({ problem_task_id })` 拉处置记录；in-flight 识别 `status==="30"`。
2. `problem-list/page.tsx`：操作列重构为「开始（新建态）/ 执行（进行中）/ 详情 / 编辑（任意态可改基本信息，D-004）/ 删除」；删内联只读详情 `Modal` 与处置 `_problem-drawer`（`done` / `change`）入口；详情/执行统一走 `ProblemDetailModal`；新建/编辑仍走 `_problem-drawer`（`create` / `edit`）；删 problem-change 入口。
3. `_problem-drawer.tsx`：删 `done` / `change` / `start` / `audit` / `close` mode 分发，仅保留 `create` / `edit`。
4. `_forms.tsx`：删 `ProblemStartForm` / `ProblemAuditForm` / `ProblemDoneForm` / `ProblemCloseForm` / `ProblemDetailForm`（并入 `ProblemDetailModal`）；保留 `ProblemCreateForm`（新建 + 编辑共用）。
5. `lib/ppm/problem.ts`：删 `nextProcessProblem` / `submitProblem` / `rejectProcessProblem` / `doneTaskProblem` / `closeTaskProblem` / `listProblemTasks` / `listProblemLogs`；新增 `startProblem` / `executeProblem`；`problem-change` 相关函数保留（deprecated）。
6. `lib/ppm/types.ts`：删 `ProblemNextProcessReq` / `ProblemRejectProcessReq` / `ProblemDoneTaskReq` / `ProblemCloseTaskReq` / `ProblemProcessTask` / `ProblemProcessLog`；新增 `ProblemStartReq` / `ProblemExecuteReq`；`ProblemList.status` 注释改中文 3 态。
7. `components/ppm-status-actions.tsx`：`PROBLEM_STATUS_TEXT` / `PROBLEM_STATUS_COLOR` 改 3 态中文（新建 / 进行中 / 已完成）。
8. `shared.tsx`：`taskStatusTag` 已支持中文 3 态，problem 直接复用（问题清单 status 文案与任务计划一致）。

### Wave 3：测试 + 验证

1. 后端：新增 problem `start` / `execute_problem` 单测（含跨天校验、重复执行 submit 回新建、complete 进已完成、in-flight 互斥）；删/改现有 problem 审批流测试（`next` / `reject` / `close` / `done`）。
2. 前端：`problem-detail-modal` 组件测试（detail / execute 双模式、跨天拆分、提交/完成）；`problem-list/page` 操作列测试改。
3. verify：backend pytest（problem 子域）+ frontend vitest（problem-list + problem-detail-modal）+ alembic upgrade head 验证 migration。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/ppm/problem/fsm.py | ProblemStatus 3 态中文 + TRANSITIONS 重写；删主流审批推进逻辑（NODE_NEXT/compute_next_node/is_audit_node 等）；保留 ProblemNode 枚举 + ProblemChangeStatus（变更流依赖） |
| 修改 | backend/app/modules/ppm/problem/model.py | status 默认值 + 列宽 String(30)；effective_status 简化 |
| 修改 | backend/app/modules/ppm/problem/service.py | 删审批/处置旧方法；新增 start + execute_problem；list_problems 删 7 覆盖；create 不再 next_process |
| 修改 | backend/app/modules/ppm/problem/router.py | 删 next/submit/reject/done/close/tasks/logs；新增 start + execute；problem-change 保留 |
| 修改 | backend/app/modules/ppm/problem/schema.py | 删审批 schema；新增 StartReq + ExecuteProblemReq |
| 新增 | backend/app/modules/ppm/migrations/versions/20260720_problem_status_3state.py | status 列宽 + 值映射；down_revision=20260718_project_org_id |
| 新增 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx | 统一详情/执行弹窗（复刻 task-detail-modal + 问题字段） |
| 修改 | frontend/src/app/(dashboard)/ppm/problem-list/page.tsx | 操作列重构；删内联 Modal + 处置 Drawer；接入 ProblemDetailModal |
| 修改 | frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx | 仅保留 create / edit mode |
| 修改 | frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx | 删 Start/Audit/Done/Close/Detail Form；保留 Create Form |
| 修改 | frontend/src/lib/ppm/problem.ts | 删审批流 API；新增 startProblem + executeProblem |
| 修改 | frontend/src/lib/ppm/types.ts | 删审批类型；新增 ProblemStartReq + ProblemExecuteReq；status 注释中文 |
| 修改 | frontend/src/components/ppm-status-actions.tsx | PROBLEM_STATUS_TEXT/COLOR 3 态中文 |
| 修改 | backend/tests/...（problem 子域测试） | 新增 start/execute 测试；删审批流测试 |
| 修改 | frontend/...（problem-list 测试） | problem-detail-modal + 操作列测试 |

## 7. 接口定义

### 7.1 POST `/api/ppm/problem-list/{id}/start`

新建态问题「开始」：建一条 in-flight `TaskExecute` 并把问题推进到「进行中」。

请求体（`StartReq`）：

```python
class StartReq(BaseModel):
    problem_id: uuid.UUID          # 路径参数注入
    execute_user_id: uuid.UUID | None = None   # 默认取当前登录用户
    actual_start_time: datetime | None = None  # 跨天补填时传指定日期,默认 now
```

响应：`TaskExecute`（含 `id`，供后续 `execute` 的 `task_execute_id` 使用；对齐 `task/service.py:248 start` 返回 in-flight 记录）。前端列表点「开始」后刷新列表；弹窗通过 `listTaskExecutes({problem_task_id})` 识别 in-flight（`status==="30"`）记录的 id；跨天填报的后续天逐天调 `start` 取新 `TaskExecute.id`。

后置条件：新建 `TaskExecute(problem_task_id=problem.id, plan_task_id=None, status="30", actual_start_time, execute_user_id)`；`PpmProblemList.status = "进行中"`。校验：仅 `status == "新建"` 可启动，否则 400。

### 7.2 PUT `/api/ppm/problem-list/{id}/execute`

收口 in-flight 处置记录 + 跨天校验 + 按 action 推进状态机（对齐 `task/service.py:292 execute_plan`）。

请求体（`ExecuteProblemReq`）：

```python
class ExecuteProblemReq(BaseModel):
    problem_id: uuid.UUID
    task_execute_id: uuid.UUID                 # start 返回的 in-flight 记录 id
    action: Literal["submit", "complete"]      # submit=回新建可再开始; complete=进已完成
    execute_info: str | None = None
    time_spent: float | None = None
    actual_end_time: datetime | None = None    # 默认 now
    execute_user_id: uuid.UUID | None = None
```

响应：`ProblemListResp`。

后置条件：`TaskExecute.status = "90"` + 回填 `actual_end_time` / `execute_info` / `time_spent`；跨天校验（`actual_start_time.date() != actual_end_time.date()` → 422，前端跨天拆分绕过）；`action="complete"` → `problem.status = "已完成"` + `real_end_time`；`action="submit"` → `problem.status = "新建"`（可再次 start = 重复执行）。

### 7.3 数据结构

`TaskExecute`（已存在，`backend/app/modules/ppm/task/model.py:128`）复用，problem 通过 `problem_task_id` 关联，`plan_task_id` / `problem_task_id` 二选一（model 注释已明确）。in-flight 标记 `status="30"`，收口 `"90"`（常量 `STATUS_DOING` / `STATUS_END` 见 `task/service.py:45-49`）。

## 7.5 生命周期契约表（问题状态流转，业务态）

> 本变更涉及「状态流转 / 完成」关键词，但属于 **PPM 业务状态机**（问题 lifecycle），**不涉及 daemon / lease / agent_run / session 运行时生命周期**（纯 HTTP CRUD + DB 状态字段，无 WS / lease / claim）。下表为业务状态流转契约。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 新建问题 | 前端 | POST /problem-list | project_id, pro_desc, duty_user_id... | (无) → 新建 |
| 开始 | 前端 | POST /problem-list/{id}/start | problem_id | 新建 → 进行中（建 in-flight TaskExecute status=30） |
| 执行-提交 | 前端 | PUT /problem-list/{id}/execute action=submit | problem_id, task_execute_id | 进行中 → 新建（in-flight 收口 status=90，可再次开始 = 重复执行） |
| 执行-完成 | 前端 | PUT /problem-list/{id}/execute action=complete | problem_id, task_execute_id | 进行中 → 已完成（终态） |
| 编辑 | 前端 | PUT /problem-list/{id} | 基本信息字段 | 状态不变（任意态可编辑基本信息） |
| 删除 | 前端 | DELETE /problem-list/{id} | — | 任意态 → 删除（本人 / 管理员） |

状态流转图：`新建 ──开始──▶ 进行中 ──提交──▶ 新建(可重复) · 进行中 ──完成──▶ 已完成(终态)`。

风险登记：不涉及 daemon / lease / session 运行时事件，故无对应运行时契约表；问题状态机不与 agent_run / lease 生命周期耦合。

## 8. 数据模型

`PpmProblemList.status`：`String(8)` 默认 `"1"` → `String(30)` 默认 `"新建"`，取值 `{新建, 进行中, 已完成}`。migration 做 UPDATE 值映射，老数据 `2/5/6/7`（废弃的审核 / 作废 / 待验证 / 变更中）一律归并 `"新建"`（数据可清空，无生产数据）。

保留不删的列（减少 migration 爆炸半径，service 不再写入）：`now_node`、`now_handle_user(_name)`、`handle_info`、`check_info`、`check_result`、`check_time`、`audit_user_id(_name/_time)`。

`TaskExecute` 表无结构变更（已有 `problem_task_id` 列 + 索引 `ix_ppm_task_execute_problem`，`task/model.py:138-151`）。

`ppm_problem_change` / `ppm_problem_change_process_task` / `ppm_problem_change_process_log` 三表保留不删（D-005，deprecated）。

## 9. 兼容策略

- **brownfield，但不做历史数据兼容**：项目未上线，CLAUDE.md 规则 11 允许重置开发 / 测试数据。migration 直接改 `status` 列宽 + UPDATE 值映射；部署时 `docker compose down -v` 重置 DB 后 `alembic upgrade head` 即可（参照 MEMORY `worktree-migration-pollutes-deploy` 教训：不 stamp，直接重置）。
- **alembic head 链**：当前唯一 head `20260718_project_org_id`，新 migration `down_revision = "20260718_project_org_id"`，避免多 head（参照 MEMORY `migration-chain-fragmentation-pattern`）。
- **问题变更模块**：后端端点 / 表保留（deprecated），前端停用入口；若 DB 残留 `problem_change` 数据，`effective_status` 不再覆盖 status，列表只显示 3 态。
- **未配置 / 未迁移时**：不适用（schema 变更强制 migration）。

## 10. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| `task-detail-modal.tsx` 来自未 commit 的 `workbench-task-modal-align` 变更 | 本变更复刻其结构，若该组件回滚 / 大改，problem 版需跟改 | 建议用户先 commit `workbench-task-modal-align` 再做本变更；problem-detail-modal 独立文件，互不引用，漂移风险可控 |
| `TaskExecute` 表 plan / problem 共用，in-flight 区分 | 误把 plan 的 in-flight 当 problem 的操作 | service 层校验 `problem_task_id == problem.id` 且 `plan_task_id is None`（D-002 互斥） |
| 跨天拆分算法两处实现（task + problem） | 未来 task 改了 problem 要跟 | 接受重复（YAGNI）；若需 DRY 后续抽 hook（方案 C），不在本变更做 |
| problem 现有审批流测试失败 | verify 阶段大量测试红 | Wave 3 同步删 / 改 problem 审批流测试，重写为 start / execute 测试 |
| `local.yaml` 全量 test ~12min > gate timeout | verify gate 可能超时 | test_strategy=module，verify 只跑 problem 子域测试（参照 MEMORY `backend-test-sqlite-vs-pg` + local.yaml 坑 2） |

## 11. 自审记录（Step 11 自审 + Step 12 Design Grill）

### Step 11 自审发现（已修）
- **ProblemNode 枚举依赖矛盾**：原 task-01 写「删 ProblemNode」，但 `ProblemNode` 被 `CHANGE_NODE_NEXT` / `compute_change_next_node` / `is_change_audit_node` 引用，而 D-005 决定 problem_change 模块保留 → `ProblemNode` 不能删。已修正为「只删主流审批推进逻辑（NODE_NEXT / compute_next_node / is_audit_node / NODE_NAMES / NODE_TO_ROLE），保留 ProblemNode 枚举」，同步 design §5/§6 + tasks task-01 + decisions D-003。

### Step 12 Design Grill 三层 cross-check matrix（已修 / 已确认）
- **G1 一致性（必修）**：§7.1 start 响应原写 `ProblemListResp`，但前端 execute 必须拿 `task_execute_id`（跨天逐天 start 取新 id + 识别 in-flight）→ 改为返回 `TaskExecute`，对齐 `task/service.py:248`。
- **G2 一致性（已补）**：`ProblemListCreate.submit` 字段（schema:51 触发 next_process）删审批后成死参数 → task-05 删该字段 + task-03 create_problem 去 submit 触发链。
- **G3 一致性（已补）**：`ProblemListResp.effective_status` 字段去留 → 保留 = status（前端读法不变、值改中文 3 态）。
- **G4 可行性（无矛盾）**：`ProblemListUpdate` 不含 status / real_end_time / now_node → D-004「编辑不改状态」天然满足。
- **G5 可行性（执行提醒）**：`create_problem:286` 内部调 `next_process:519` → 删 next_process 前先改 create_problem，已写入 task-03 链式顺序。
- **G6 定义层（无矛盾）**：重复执行 / 跨天 / 编辑均有可测试 FR + AC。

## 12. 依据

- 目标模式：`frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx`（全文）、`backend/app/modules/ppm/task/service.py:248 start` / `:292 execute_plan`、`task/router.py:213 /task-plan/start` / `:201 /task-plan/execute`。
- 现状：`backend/app/modules/ppm/problem/{fsm,model,router,service,schema}.py`、`frontend/.../ppm/problem-list/{page,_problem-drawer,_forms}.tsx`、`frontend/src/lib/ppm/{problem.ts,types.ts}`。
- 决策：见 `decisions.md`（D-001 ~ D-006）。
- 项目约定：`.claude/CLAUDE.md` 规则 11（数据可清空）/ 17（前端样式参考 archived prototype-frontend-style-system）。
