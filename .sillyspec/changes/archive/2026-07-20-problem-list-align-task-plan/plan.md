---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
plan_level: full
---

# 实现计划（Plan）— 问题清单对齐任务计划

## Spike 前置验证

无 Spike。技术方案确定（对齐已实现的 task 子域 start/execute 两段式 + task-detail-modal），无新技术栈/未验证集成。

## Wave 1（后端：状态机 + 两段式端点，链式为主）

- [ ] task-01: fsm 重写 3 态（ProblemStatus 中文 + TRANSITIONS，保留 ProblemNode，删主流审批推进逻辑）（覆盖：FR-1, FR-2, D-001, D-003）
- [ ] task-02: model status 中文化 + effective_status 简化（覆盖：FR-1, D-001）
- [ ] task-03: service 删审批旧方法 + 新增 start/execute_problem + create 去 submit（覆盖：FR-5, FR-7, FR-8, FR-9, FR-16, D-002, D-003）
- [ ] task-04: router 删废弃端点 + 新增 start/execute（覆盖：FR-5, FR-7, FR-14, D-003）
- [ ] task-05: schema 删废弃 + 新增 StartReq/ExecuteProblemReq + 删 ProblemListCreate.submit（覆盖：FR-5, FR-7, D-003）
- [ ] task-06: alembic migration status 值映射（覆盖：FR-1）
- [ ] task-07: 后端测试 start/execute + 删审批流测试（覆盖：FR-5, FR-7, FR-8, FR-9, FR-12）

## Wave 2（前端：统一弹窗 + 列表操作列，依赖 Wave 1 API）

- [ ] task-08: 新建 problem-detail-modal.tsx（detail/execute 双模式 + 跨天填报）（覆盖：FR-10, FR-11, D-006）
- [ ] task-09: problem-list/page.tsx 操作列重构 + 接入新弹窗（覆盖：FR-3, FR-4, FR-13, D-004）
- [ ] task-10: _problem-drawer + _forms 清理废弃 mode/表单（覆盖：FR-14, FR-15, D-003）
- [ ] task-11: lib/ppm/problem.ts + types.ts 删审批 API/类型 + 新增 start/execute（覆盖：FR-14）
- [ ] task-12: ppm-status-actions 3 态中文 + shared 复用 taskStatusTag（覆盖：FR-1）
- [ ] task-13: 前端测试 problem-detail-modal + page 操作列（覆盖：FR-10, FR-11, FR-3）

## Wave 3（验证）

- [ ] task-14: verify 后端 pytest + 前端 vitest + migration + AC 端到端（覆盖：AC-1~AC-8, NFR-1~NFR-4）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | fsm 重写 3 态 | W1 | P0 | — | FR-1,2, D-001,003 | ProblemStatus 中文 + TRANSITIONS，保留 ProblemNode |
| task-02 | model status 中文化 | W1 | P0 | task-01 | FR-1, D-001 | status String(30) 默认新建 + effective_status 简化 |
| task-03 | service 两段式 + 清理 | W1 | P0 | task-01,02 | FR-5,7,8,9,16, D-002,003 | start+execute_problem，create 去 submit/next_process |
| task-04 | router 端点改造 | W1 | P0 | task-03 | FR-5,7,14, D-003 | 删 7 废弃端点 + 新增 start/execute |
| task-05 | schema 改造 | W1 | P0 | task-03 | FR-5,7, D-003 | 删 6 废弃 schema + 删 submit + 新增 2 req |
| task-06 | alembic migration | W1 | P0 | task-02 | FR-1 | status 列宽 + 值映射，down=20260718 |
| task-07 | 后端测试 | W1 | P0 | task-03,04,05 | FR-5,7,8,9,12 | start/execute 单测 + 删审批测试 |
| task-08 | problem-detail-modal | W2 | P0 | task-11 | FR-10,11, D-006 | 复刻 task-detail-modal + 问题字段 |
| task-09 | page 操作列重构 | W2 | P0 | task-08,12 | FR-3,4,13, D-004 | 开始/执行/详情/编辑/删除 |
| task-10 | drawer+forms 清理 | W2 | P0 | task-09 | FR-14,15, D-003 | 仅留 create/edit mode |
| task-11 | lib api+types | W2 | P0 | task-04,05 | FR-14 | 删审批 API + 新增 start/execute |
| task-12 | status-actions+shared | W2 | P0 | task-02 | FR-1 | 3 态中文映射 |
| task-13 | 前端测试 | W2 | P0 | task-08,09 | FR-10,11,3 | 弹窗 + 操作列测试 |
| task-14 | verify | W3 | P0 | task-01~13 | AC-1~8, NFR-1~4 | 全量验证 |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-11 → task-08 → task-09 → task-10 → task-14（后端 fsm/model/service/schema 链 → 前端 API → 弹窗 → 页面 → 清理 → 验证，决定最短交付周期）。

## 全局验收标准

- [ ] backend `cd backend && uv run pytest -q`（problem 子域）全绿
- [ ] backend `uv run ruff check . && uv run ruff format --check . && uv run mypy app` 全绿
- [ ] frontend `cd frontend && pnpm test`（problem-list + problem-detail-modal）全绿
- [ ] frontend `pnpm lint && pnpm typecheck` 全绿
- [ ] `cd backend && uv run alembic upgrade head` 在干净库通过，单 head
- [ ] 不破坏任务计划 / 工作台 / 项目计划 / 数据范围既有功能（回归）
- [ ] AC-1 ~ AC-8 端到端手动核对通过

## 覆盖矩阵（decisions）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（status 中文 3 态） | task-01, task-02, task-06, task-12 | FR-1 / AC-1（列表显示中文态） |
| D-002@v1（TaskExecute in-flight 互斥） | task-03, task-07 | FR-12 / AC-2（problem in-flight 不误伤 plan） |
| D-003@v1（废弃端点全删） | task-01, task-03, task-04, task-05, task-10, task-11 | FR-14 / AC-8（废弃端点 404） |
| D-004@v1（编辑任意态基本信息） | task-09 | FR-13 / AC-5（任意态编辑不改状态） |
| D-005@v1（problem_change 前端停用后端保留） | task-03, task-09, task-10 | FR-15 / AC-8（无变更中状态） |
| D-006@v1（方案 B 仿写独立） | task-08 | FR-10,11（独立 problem-detail-modal） |
