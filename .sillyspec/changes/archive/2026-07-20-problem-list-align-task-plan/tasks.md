---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
status: draft
---

# 任务（Tasks）— 问题清单对齐任务计划

> 粗框架，详细 TaskCard 由后续 `sillyspec run plan` 阶段拆解（含依赖、验收标准、测试点）。

## Wave 1：后端状态机简化 + 两段式端点

- **task-01** fsm 重写：`ProblemStatus` 3 态中文（新建 / 进行中 / 已完成）+ `TRANSITIONS` 重写（删 AUDITING / BACK / WAIT_CHECK 分支）；删**主流审批专用**推进逻辑 `NODE_NAMES` / `NODE_TO_ROLE` / `NODE_NEXT` / `compute_next_node` / `is_audit_node`；**保留 `ProblemNode` 枚举**（变更流 `CHANGE_NODE_NEXT` / `compute_change_next_node` / `is_change_audit_node` 依赖，D-005 problem_change deprecated 模块仍引用）+ `ProblemChangeStatus` / `CHANGE_*` / `BUG_TYPE` / `CHANGE_TYPE`。
- **task-02** model：`PpmProblemList.status` 默认 `"新建"` + 列宽 `String(30)`；`effective_status` property 简化为直接返回 `status`（删 `_effective_status` 7 覆盖）；废弃字段 `now_node` / `check_*` / `audit_*` / `handle_info` 保留不删。
- **task-03** service：删 `next_process` / `submit_problem` / `reject_process` / `done_task` / `close_task` / `list_list_tasks` / `list_list_logs`（先改 `create_problem` 去 `submit` 触发 `next_process` 调用链，新建统一 status=新建，G5 链式顺序）；新增 `start`（建 in-flight `TaskExecute(problem_task_id, plan_task_id=None, status=30)` + 校验仅新建态 + status→进行中 + 返回 `TaskExecute`）+ `execute_problem`（收口 status=90 + 跨天校验 + action submit 回新建 / complete 进已完成 + in-flight 互斥校验 D-002）；`list_problems` 删 `_effective_status=7` 覆盖。
- **task-04** router：删 `/{id}/next` / `/submit` / `/reject` / `/done` / `/close` / `/tasks` / `/logs`；新增 `POST /{id}/start` + `PUT /{id}/execute`；`problem-change` 全部端点保留。
- **task-05** schema：删 `NextProcessReq` / `RejectProcessReq` / `DoneTaskReq` / `CloseTaskReq` / `ProcessTaskResp` / `ProcessLogResp`；删 `ProblemListCreate.submit` 字段（G2）；新增 `StartReq` + `ExecuteProblemReq`（`action: Literal["submit","complete"]`）；`ProblemListResp.effective_status` 保留（=status，G3）。
- **task-06** migration：新增 `20260720_problem_status_3state.py`（`down_revision="20260718_project_org_id"`）：`ALTER ppm_problem_list.status` 列宽 → 30；`UPDATE` 值映射 `1→新建, 3→进行中, 4→已完成, 2/5/6/7→新建`；不删废弃列。
- **task-07** 后端测试：新增 `start` / `execute_problem` 单测（跨天校验 / 重复执行 submit 回新建 / complete 终态 / in-flight 互斥 / 仅新建可启动）；删 / 改现有 problem 审批流测试。

## Wave 2：前端统一弹窗 + 列表操作列

- **task-08** 新建 `problem-detail-modal.tsx`：复刻 `task-detail-modal` 结构（信息卡 + 处置记录表 + 跨天填报区 + 提交回新建 / 完成两按钮）；信息卡字段用问题清单模型；`listTaskExecutes({problem_task_id})` 拉记录；in-flight 识别 `status==="30"`。
- **task-09** `problem-list/page.tsx`：操作列重构（开始 / 执行 / 详情 / 编辑 / 删除）；删内联只读详情 Modal + 处置 Drawer 入口；详情 / 执行统一走 `ProblemDetailModal`；新建 / 编辑仍走 Drawer；删 problem-change 入口。
- **task-10** `_problem-drawer.tsx` + `_forms.tsx`：drawer 仅保留 `create` / `edit` mode；forms 删 `ProblemStartForm` / `ProblemAuditForm` / `ProblemDoneForm` / `ProblemCloseForm` / `ProblemDetailForm`，保留 `ProblemCreateForm`。
- **task-11** `lib/ppm/problem.ts` + `types.ts`：删审批流 API（`nextProcessProblem` / `submitProblem` / `rejectProcessProblem` / `doneTaskProblem` / `closeTaskProblem` / `listProblemTasks` / `listProblemLogs`）+ 类型；新增 `startProblem` / `executeProblem` + `ProblemStartReq` / `ProblemExecuteReq`；`ProblemList.status` 注释中文。
- **task-12** `components/ppm-status-actions.tsx`：`PROBLEM_STATUS_TEXT` / `PROBLEM_STATUS_COLOR` 3 态中文；`shared.tsx` 确认 `taskStatusTag` 复用。
- **task-13** 前端测试：`problem-detail-modal` 组件测试（detail / execute 双模式 + 跨天拆分 + 提交 / 完成）；`problem-list/page` 操作列测试改。

## Wave 3：验证

- **task-14** verify：backend pytest（problem 子域）+ frontend vitest（problem-list + problem-detail-modal）+ `alembic upgrade head` migration 验证 + 端到端 AC-1 ~ AC-8 手动核对；ruff / mypy / lint / typecheck 全绿。

## 依赖

- task-01 → task-02 → task-03 → task-04 / task-05（后端链式）
- task-06 独立（migration），verify 前必须 apply
- task-11（前端 API）→ task-08（弹窗）/ task-09（页面）依赖
- task-07 / task-13 依赖对应实现 task
- task-14 依赖全部

## 执行契约提醒（给 plan 阶段）

- 遵循 CLAUDE.md 执行顺序：文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档。
- backend 改 router 必跑 `test_router`（MEMORY `backend-router-change-run-router-tests`）。
- migration 用官方 `alembic heads` 核实单 head，不信手算（MEMORY `alembic-heads-subagent-misreport`）。
- 前端 prod 验证改代码须 `docker compose -p multi-agent-platform -f deploy/docker-compose.yml up -d --build frontend`（MEMORY `ppm-status-dual-track-and-workbench-verify`）。
