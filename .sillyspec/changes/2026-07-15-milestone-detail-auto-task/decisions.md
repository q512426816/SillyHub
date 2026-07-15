---
author: WhaleFall
created_at: 2026-07-15T18:57:52
---

# 决策台账（Decisions）— 里程碑明细提交自动创建任务计划

本次变更的需求澄清决策记录。长期术语在 archive/scan 时再提升到 `glossary.md`。

## D-001@v1: 明细-任务一对一（含变更版本链）
- type: architecture
- status: accepted
- source: user + code
- question: 明细发起「变更」会产生新版本（旧 done→archived、新 draft），如何避免重复任务并让任务始终跟随当前有效版本？
- answer: 一条里程碑明细（含其 parent_id 版本链）始终只对应一条 PlanTask。`change_process` 产生新版本 draft 时，调用 `_migrate_task_to_version` 把任务 `ps_plan_node_detail_id` 从旧版本迁到新版本；新版本提交变 done 时 `_ensure_task_for_detail` 命中即更新字段、不新建。
- normalized_requirement: 任意时刻一条明细族（自身 + 全部 parent 祖先）在 `ppm_plan_task` 中至多一条 `ps_plan_node_detail_id` 指向其当前版本的记录。
- impacts: FR-变更联动, design §5.1/§7, R-01
- evidence: 用户「任务跟着明细同步更新」决策（step6）；`backend/app/modules/ppm/plan/service.py` change_process（旧 done→archived + 新 draft parent_id 版本链）
- priority: P0

## D-002@v1: 明细→任务字段映射
- type: boundary
- status: accepted
- source: code
- question: 建任务时 PlanTask 各字段从明细哪里取？
- answer: user_id/user_name ← execute_user_id（+反查 User.display_name）；content ← task_theme；start_time ← plan_begin_time；end_time ← plan_complete_time；work_load ← plan_workload；ps_plan_node_detail_id ← detail.id；project_id/project_name ← 回溯 PsPlanNode.ps_project_plan_id → PsProjectPlan；module_id ← detail.module_id；status 新建="未开始"（同步时不动）；kanban_order ← 该 user 现有 max+1。
- normalized_requirement: `_ensure_task_for_detail`/`_sync_task_fields` 严格按此映射写值；`_sync_task_fields` 不覆盖 task.status。
- impacts: FR-建任务/FR-编辑同步, design §5.3
- evidence: `backend/app/modules/ppm/task/model.py` PlanTask 字段；`backend/app/modules/ppm/plan/model.py` PsProjectPlan.project_id/project_name、PsPlanNodeDetail 字段
- priority: P1

## D-003@v1: 执行人为空则跳过建任务
- type: boundary
- status: accepted
- source: code
- question: 明细 execute_user_id 为空时是否建任务？
- answer: 不建。`PlanTask.user_id` 非空（nullable=False），无执行人无法落合法任务；跳过避免无主任务。前端新建明细 execute_user_id 已必填（ql-20260714-003），此分支主要兜底 API 直调/异常数据。
- normalized_requirement: `_ensure_task_for_detail` 在 detail.execute_user_id 为 None 时直接返回 None，不写库。
- impacts: FR-建任务, design §5.1/§7
- evidence: `backend/app/modules/ppm/task/model.py` user_id nullable=False；用户「记给明细的执行人」决策
- priority: P1

## D-004@v1: 删除明细只解关联、保留任务
- type: boundary
- status: accepted
- source: user
- question: 删除里程碑明细时，已自动建好的任务怎么办？
- answer: 把关联任务的 `ps_plan_node_detail_id` 置 null，任务本身（及其执行/工时记录）保留。
- normalized_requirement: `delete_detail` 删明细后调 `_unlink_task`，将匹配任务的 ps_plan_node_detail_id 置 None；任务行不删除。
- impacts: FR-删除联动, design §5.1/§7
- evidence: 用户「保留任务，只解除关联」决策（step6）
- priority: P1

## D-005@v1: Excel 导入即完成的明细也批量建任务
- type: boundary
- status: accepted
- source: user
- question: Excel 批量导入的明细（import_commit 中 required_filled→done）是否也自动建任务？
- answer: 是。`import_commit` 同事务内，对每个落 done 的明细调用 `_ensure_task_for_detail` 批量建任务；draft 明细不建。
- normalized_requirement: import_commit 在末尾统一 commit 前，对所有 status=done 的新建明细执行联动建任务；任一失败则整批回滚。
- impacts: FR-导入联动, design §5.1/§7.5
- evidence: 用户「手动提交和导入都建」决策；`import_commit` 既有批量事务范式
- priority: P1

## D-006@v1: 历史数据不补建
- type: compatibility
- status: accepted
- source: docs
- question: 上线前历史已 done 的明细是否追溯建任务？
- answer: 不补建。仅对上线后新提交/新导入的明细生效。
- normalized_requirement: 联动仅在 create_detail(done)/_transition(DONE)/import_commit/update_detail/change_process/delete_detail 的实时调用中触发；不提供任何回填脚本/启动任务。
- impacts: 非目标, design §3/§9
- evidence: CLAUDE.md 规则 11（未上线，允许重置开发数据，不要求历史兼容）
- priority: P2

## D-007@v1: 编辑已完成明细同步更新关联任务
- type: boundary
- status: accepted
- source: user
- question: 明细提交后又被编辑（update_detail），已建任务是否同步？
- answer: 是。`update_detail` 后调 `_sync_task_fields`，同步执行人/时间/主题/工作量/项目/模块字段；不改 task.status（保留任务自身推进）。
- normalized_requirement: update_detail 更新明细后，若该明细已有 ps_plan_node_detail_id 关联任务，则按 D-002 映射同步字段（status 除外）。
- impacts: FR-编辑同步, design §5.1/§7
- evidence: 用户「任务跟着明细同步更新」决策（step6）
- priority: P1
