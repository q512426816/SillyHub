---
author: qinyi
created_at: 2026-07-20 11:30:22
change: 2026-07-20-problem-list-align-task-plan
status: draft
---

# 提案（Proposal）— 问题清单对齐任务计划

## 一句话

把 PPM「问题清单」(`/ppm/problem-list`) 的详情弹窗和执行流程，整体对齐成「任务计划」(`/ppm/task-plans`) 那套成熟模式：统一详情 / 执行弹窗 + 开始 / 执行两段式（支持跨天填报与重复执行）+ 状态机简化为 3 态。

## 为什么要做

任务计划经过两次变更（`2026-07-16-workbench-load-crossday` 已归档 + `2026-07-20-workbench-task-modal-align` 活跃），已形成一套用户认可的执行模式：统一弹窗（detail / execute 双模式）、两段式执行（启动建 in-flight → 执行收口，提交可回退实现重复执行）、跨天填报、3 态状态机。

问题清单还停留在旧交互：详情与处置是两个独立入口（内联只读 Modal + 侧边 Drawer），处置一步到位（`done_task` 单次填一段），不能跨天、不能重复执行；状态机残留 7 态（审核 / 验证 / 驳回 / 变更中等）和大量废弃端点。

两条并行业务线交互割裂，用户认知负担大；问题清单缺跨天填报与重复执行能力。

## 做什么

1. **前端**：新建 `problem-detail-modal.tsx`（复刻 `task-detail-modal` 结构 + 问题字段），重构问题清单列表操作列（开始 / 执行 / 详情 / 编辑 / 删除），删旧的处置 Drawer 与废弃表单。
2. **后端**：问题清单新增 `POST /{id}/start` + `PUT /{id}/execute`（仿 `task/service.py` start / execute_plan），删 `next / submit / reject / done / close / tasks / logs` 废弃端点；`fsm` 重写 3 态；`status` 字段改中文。
3. **数据**：alembic migration 做 `status` 列宽 + 值映射（数据可清空，不兼容老数据）。

详见 `design.md`。

## 不在范围内（Non-Goals）

- 不泛化 `task-detail-modal` 成通用组件（方案 B 仿写独立，决策 D-006）。
- 不删问题变更（`problem_change`）模块后端代码 / 表（爆炸半径大，仅前端停用入口 + 删 status 7 覆盖，D-005）。
- 不改任务计划任何代码（只读参照）。
- 不做历史数据兼容（CLAUDE.md 规则 11，重置开发数据）。

## 影响范围

- 后端：`backend/app/modules/ppm/problem/`（fsm / model / service / router / schema）+ 新 migration；problem 子域测试。
- 前端：`frontend/src/app/(dashboard)/ppm/problem-list/`（page / _problem-drawer / _forms）+ 新增 `_components/problem-detail-modal.tsx` + `lib/ppm/{problem.ts,types.ts}` + `components/ppm-status-actions.tsx`；problem-list 测试。
- 不影响：任务计划、工作台、agent / daemon / lease 链路、其他 PPM 子域（项目计划 / 数据范围）。

## 规模

large（前后端各一大块 + migration），单变更可承载，不拆分、不批量。

## 依赖与风险

- 依赖 `task-detail-modal.tsx` 作为复刻基准（来自未 commit 的 `workbench-task-modal-align`，建议先 commit）。
- `ppm-data-scope` 数据范围注入已在 main（`c2d1e10b`），start / execute 复用即可。
- alembic 当前单 head `20260718_project_org_id`，新 migration 接它。
- 详见 `design.md` §10 风险表。
