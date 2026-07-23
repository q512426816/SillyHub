---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
status: draft
---

# 决策记录（Decisions）— 问题清单对齐任务计划

## D-001@v1: problem status 字面值用中文 3 态

- type: architecture
- status: accepted
- source: code + user
- question: 问题清单 `status` 简化 3 态后用中文（新建 / 进行中 / 已完成）还是保留数字（1 / 3 / 4）？
- answer: 中文。对齐任务计划 `PlanTask.status`（已查 `backend/app/modules/ppm/task/model.py:58-61` 确认中文 3 态「未开始 / 进行中 / 已完成」），消除前端 status 双轨制坑（MEMORY `ppm-status-dual-track-and-workbench-verify`：前端 PlanTask 中文 / TaskExecute 数字混用曾致按钮未禁用）。
- normalized_requirement: `PpmProblemList.status` 取值 ∈ {新建, 进行中, 已完成}，列宽 `String(30)`，alembic migration UPDATE 值映射（1→新建, 3→进行中, 4→已完成, 2/5/6/7→新建），数据可清空不兼容老值。
- impacts: [model, fsm, migration, 前端 taskStatusTag 复用, FR-1]
- evidence: task/model.py:58-61, MEMORY ppm-status-dual-track-and-workbench-verify, 用户「对齐任务计划」

## D-002@v1: TaskExecute in-flight plan / problem 互斥

- type: architecture
- status: accepted
- source: code
- question: `TaskExecute` 表 plan / problem 共用（`plan_task_id` / `problem_task_id` 二选一），in-flight（status=30）如何区分归属，防止 problem 操作误伤 plan 记录？
- answer: 复用 `status="30"` in-flight 机制（`task/service.py:45-49` `STATUS_DOING`）。problem 的 in-flight = `status="30"` + `problem_task_id == problem.id` + `plan_task_id is None`。`execute_problem` service 层校验三者，不匹配抛 400。
- normalized_requirement: `start` 建记录时 `plan_task_id=None, problem_task_id=problem.id, status="30"`；`execute_problem` 校验 `exc.problem_task_id == problem.id and exc.plan_task_id is None and exc.status == "30"`。
- impacts: [service start/execute_problem, FR-5, FR-7, FR-12]
- evidence: task/model.py:128-193（TaskExecute + 注释「二选一」+ `ix_ppm_task_execute_problem` 索引）, task/service.py:45-49/269-277

## D-003@v1: 废弃审批 / 验证 / 驳回端点全删

- type: boundary
- status: accepted
- source: user
- question: `next` / `submit` / `reject` / `done` / `close` / `tasks` / `logs` 端点 + `fsm` 残留 `ProblemNode` 审批链怎么处理？
- answer: 全删（前端 API + 类型 + 表单 + 后端 router / service / schema / fsm 节点链）。数据可清空（CLAUDE.md 规则 11）无兼容压力；`done` 的能力由新 `execute` 两段式替代，`submit` 由 `start` 替代。
- normalized_requirement: 删 `POST /problem-list/{id}/{next,submit,reject,done,close}` + `GET /{id}/{tasks,logs}`；删 service 对应方法；删**主流审批推进逻辑** `NODE_NAMES` / `NODE_TO_ROLE` / `NODE_NEXT` / `compute_next_node` / `is_audit_node`（**保留 `ProblemNode` 枚举**，因变更流 `CHANGE_NODE_NEXT` 等依赖，见 D-005）；删前端对应 API / 类型 / 表单。
- impacts: [router, service, schema, fsm, 前端 lib/forms, FR-14]
- evidence: 用户「简化 3 态删审核 / 验证 / 驳回」, router.py:232-332, fsm.py:54-145

## D-004@v1: 编辑入口范围

- type: boundary
- status: accepted
- source: user
- question: 进行中「编辑」入口能改哪些字段？已完成态也能编辑吗？已完成能否再开始？
- answer: 编辑入口改基本信息（描述 / 问题类型 / 紧急度 / 功能名称 / 计划起止 / 责任人 / 发现人），不动执行相关（`TaskExecute`）；新建 / 进行中 / 已完成任意态均可编辑基本信息（用户「任意→编辑」+「任意→删除」隐含任意态可改）；已完成是终态不可再「开始」（`start` 仅新建态可调）。
- normalized_requirement: `PUT /problem-list/{id}` 不限制 status（任意态可改基本信息）；`start` 校验 `status == "新建"`；已完成态操作列只有「编辑 / 详情 / 删除」。
- impacts: [router update, 前端操作列, FR-3, FR-5, FR-13]
- evidence: 用户 step6「进行中保留编辑入口」+「任意状态删除」, FR-3

## D-005@v1: 问题变更 problem_change 前端停用 + 后端保留 deprecated

- type: boundary
- status: accepted
- source: code + user
- question: 问题变更（`problem_change`）审批流模块（3 张表 + 独立 CRUD + next/reject 端点 + `effective_status` 7 覆盖）怎么处理？
- answer: 前端停用入口（删 `_problem-drawer` change mode + 页面「变更」按钮 + `lib/ppm/problem.ts` 的 problem-change 调用方）+ 删 `effective_status` 的「7 变更中」覆盖逻辑（保证 status 3 态）；**后端 problem_change 端点 / 表 / service / schema 保留不删**，标注 deprecated（爆炸半径大，且 problem_change 与 problem_list 主流耦合低；用户「进行中编辑」已用 update 替代变更申请，变更流前端不再触达）。后续可单独变更清理。
- normalized_requirement: 前端无 problem-change 入口；`list_problems` 不再设 `_effective_status=7`；`effective_status` property 直接返回 `status`；`fsm.ProblemChangeStatus` / `CHANGE_*` 保留（problem_change service 仍引用）；`ppm_problem_change*` 3 表保留。
- impacts: [service list_problems, model effective_status, 前端 _problem-drawer/page/lib, FR-15]
- evidence: model.py:150-159 effective_status, router.py:335-483 problem-change, fsm.py:162-223, 用户「进行中编辑替代变更」

## D-006@v1: 方案 B 仿写独立（不泛化 task-detail-modal）

- type: architecture
- status: accepted
- source: user
- question: 前端弹窗实现：泛化 `task-detail-modal` 成通用组件（方案 A）vs 新建 `problem-detail-modal` 仿写（方案 B）vs 折中抽 hook（方案 C）？
- answer: 方案 B 仿写独立。① `task-detail-modal` 来自未 commit 的 `workbench-task-modal-align` 变更，泛化会把两个变更绑死、增加冲突面；② task 与 problem 字段差异大（duty_user / 发现人 / 问题类型 / 紧急度 vs work_load / work_partner），泛化组件条件分支丑；③ problem 专属端点语义清晰；④ 跨天拆分逻辑重复 ~150 行可接受（task 版已稳定，YAGNI，后续要 DRY 再抽 hook 不迟）。
- normalized_requirement: 新建独立文件 `frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx`，不 import / 不修改 `task-detail-modal.tsx`；跨天拆分算法在 problem 版重新实现。
- impacts: [前端弹窗, design §3 非目标, design §10 风险]
- evidence: 用户 step8 选「方案 B 仿写独立（推荐）」, design §5 Wave 2 task-08
