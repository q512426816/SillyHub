---
author: WhaleFall
created_at: 2026-07-21T12:10:00
---

# 提案（Proposal）— ppm update 清空字段修复

## 一句话

修复 ppm 模块编辑保存时「清空字段不生效」的 bug：后端 update 的 `if v is not None` 把用户清空的 null 跳过，与路由 `exclude_unset=True` 矛盾，导致旧值保留。

## 动机

用户反馈：系统中所有 ppm 编辑页，有值字段被清空保存后旧值不更新。这是数据正确性 bug——用户明确清空却不落库，破坏编辑语义的可信度。

## 方案（A，用户确认）

去掉 plan/problem `_Crud.update` + plan `update_detail` 的 `if v is not None`，改直接 setattr。配合路由既有的 `exclude_unset=True`：**未传=不动，null=清空**。

不改：`change_process`（版本链复制+覆盖语义）、`agent`（有测试守卫，有意设计）、`task/project` update（已正确）。顺手修正 task update 误导性注释。

## 影响

- 后端 ppm 全部 PUT 路由的清空行为修正（plan/problem/task/project 子域）。
- 补 pytest 单测（清空 + 部分更新）。
- 无 schema / API 契约 / 状态机变更，无 DB 迁移。

## 不在范围内（Non-Goals）

- 不改 `change_process`（版本链复制+覆盖语义，null=不覆盖正确）。
- 不改 `agent` 模块同类写法（有测试守卫，有意设计）。
- 不抽 common update helper（方案 A，直接改 3 处，不重构）。
- 不做全量前端排查（按需核，已知 MasterDrawer / 明细表单清空发 `null`）。
- 无 schema / API 契约 / 状态机变更，无 DB 迁移。

## 风险

见 design.md「风险与回滚」。关键：DB 字段均 nullable（低风险）；`update_detail` 下游 `_sync_task_fields` 已有 `uid is not None` 守卫（plan/service.py:1645）保护 `PlanTask.user_id` 非空，执行阶段复查。
