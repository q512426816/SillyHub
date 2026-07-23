---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
status: draft
---

# 需求（Requirements）— 问题清单对齐任务计划

## 业务需求

**BR-1**：问题清单的详情查看与执行填报，应与任务计划使用同一套交互范式（统一弹窗 + 两段式执行），降低用户认知负担。
**BR-2**：问题清单支持跨天填报工时与重复执行（一个问题的处置可分多次、跨多天记录），与任务计划能力对齐。
**BR-3**：问题清单状态机简化，去掉未使用的审批 / 验证 / 驳回流程，只保留与执行强相关的 3 态。

## 功能需求（验收点）

### 状态机
- **FR-1**：`PpmProblemList.status` 取值收敛为 3 态中文：`新建` / `进行中` / `已完成`。alembic migration 将老值映射（`1→新建, 3→进行中, 4→已完成, 2/5/6/7→新建`）。
- **FR-2**：`fsm.py` 删除 `ProblemNode` 4 节点审批链（`NODE_NEXT` / `compute_next_node` / `is_audit_node`）与对应 `TRANSITIONS` 分支；`ProblemStatus` 重写为 3 态。

### 列表操作列（对齐任务计划）
- **FR-3**：问题清单列表操作列按状态显示：
  - 新建态 →「开始」「编辑」「详情」「删除」
  - 进行中 →「执行」「编辑」「详情」「删除」
  - 已完成 →「编辑」「详情」「删除」
- **FR-4**：「删除」任意状态可用，限本人或平台管理员（复用现有数据范围 + `PPM_PROBLEM_DELETE`）。

### 开始（两段式第一步）
- **FR-5**：`POST /api/ppm/problem-list/{id}/start`：仅「新建」态可调用（否则 400）；新建一条 in-flight `TaskExecute(problem_task_id, status="30", actual_start_time)`；问题 `status` → `进行中`。
- **FR-6**：`start` 返回的 `TaskExecute.id` 作为后续 `execute` 的 `task_execute_id`。

### 执行（两段式第二步，跨天 + 重复）
- **FR-7**：`PUT /api/ppm/problem-list/{id}/execute` 收口 in-flight 记录（`status → "90"`，回填 `actual_end_time` / `execute_info` / `time_spent`）。
- **FR-8**：跨天校验：`actual_start_time.date() != actual_end_time.date()` → 422（前端跨天拆分逐天调用绕过，对齐 `task/service.py:330`）。
- **FR-9**：`action="submit"` → 问题 `status` 回 `新建`（可再次 `start` = **重复执行**）；`action="complete"` → 问题 `status → 已完成`（终态）+ 写 `real_end_time`。

### 统一弹窗
- **FR-10**：新建 `problem-detail-modal.tsx`，detail 模式 = 只读问题信息卡（项目 / 模块 / 功能名称 / 问题类型 / 紧急度 / 责任人 / 发现人 / 发现日期 / 计划起止 / 已消耗 / 问题描述）+ 处置记录表（`listTaskExecutes({problem_task_id})`）。
- **FR-11**：execute 模式 = 在 detail 基础上展开跨天填报区：识别 in-flight（`status==="30"`）后按 `actual_start_time ~ today` 自动拆分多行（最多 60 天兜底），逐天填耗时 + 说明；末天用用户选的 submit / complete，中间天强制 submit；两按钮「提交(回新建)」「完成」。
- **FR-12**：`TaskExecute` in-flight 互斥校验：problem 的 in-flight 必须 `problem_task_id == problem.id` 且 `plan_task_id is None`（D-002）。

### 编辑
- **FR-13**：「编辑」入口改问题描述 / 问题类型 / 紧急度 / 功能名称 / 计划起止 / 责任人 / 发现人等基本信息，不改执行相关；新建 / 进行中 / 已完成任意态可编辑（`PUT /problem-list/{id}`）。

### 清理
- **FR-14**：删除问题清单废弃端点 `/{id}/next` / `/submit` / `/reject` / `/done` / `/close` / `/tasks` / `/logs` 及对应 service / schema / 前端 API / 类型。
- **FR-15**：问题变更（`problem_change`）前端入口停用（删 `_problem-drawer` change mode + 页面入口），`effective_status` 删除「7 变更中」覆盖逻辑；后端 `problem_change` 端点 / 表保留（deprecated，D-005）。
- **FR-16**：`create_problem` 新建后 `status = 新建`，不再触发 `next_process`。

## 非功能需求

- **NFR-1**：backend 改动通过 ruff + mypy + pytest（problem 子域）；frontend 通过 lint + typecheck + vitest（problem-list + problem-detail-modal）。
- **NFR-2**：alembic migration `down_revision = "20260718_project_org_id"`，不产生多 head；`alembic upgrade head` 在干净库通过。
- **NFR-3**：不破坏任务计划、工作台、项目计划、数据范围等既有功能（verify 回归）。
- **NFR-4**：Windows / Linux / macOS 兼容（CLAUDE.md 规则 13）；UI 中文（规则 12）。

## 验收标准（端到端）

- **AC-1**：新建一个问题 → 列表显示「新建」态 + 「开始」按钮 → 点开始 → 变「进行中」+ 出现「执行」按钮。
- **AC-2**：进行中点「执行」→ 弹窗展开跨天填报区（若 in-flight 起始跨多天则自动拆多行）→ 逐天填 → 点「提交(回新建)」→ 问题回「新建」可再次「开始」（重复执行验证）。
- **AC-3**：进行中点「执行」→ 填报 → 点「完成」→ 问题变「已完成」（终态），处置记录表新增一条。
- **AC-4**：任意态点「详情」→ 弹窗只读显示信息卡 + 处置记录表，无填报区。
- **AC-5**：任意态点「编辑」→ 改基本信息保存成功，状态不变。
- **AC-6**：本人 / 管理员任意态可删除；非本人非管理员不可删。
- **AC-7**：跨天填报时，单次 execute 跨天被后端拒（422），前端拆分后逐天成功。
- **AC-8**：列表不再出现「审核中 / 已作废 / 待验证 / 变更中」状态；废弃端点 404。
