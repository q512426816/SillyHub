---
author: WhaleFall
created_at: 2026-07-22T09:25:00
---

# 提案（Proposal）— 项目计划 project_name join 改造

## 一句话

把 ppm_ps_project_plan 的 project_name 从「冗余字段 + 改名同步」改成「list/get/export 实时 outerjoin 项目表取真名」，消除冗余被写坏的 bug 源头。

## 动机

今天因冗余字段连修 4 个 bug（ql-014/015/016 + 旧数据修复），根因都是「冗余 project_name 被写坏/null/uuid」。维护冗余的三条链路（create 兜底 + update 前端发值 + 改名同步）任何一环出错，列表就显示错。

## 方案（A，用户确认）

list/get/export 显式 `outerjoin PpmProjectMaintenance` 取 project_name（单一可信源）；筛选/排序基于 join 字段；删 project/service.py:213-222 改名同步（join 后实时一致）；保留冗余列（不删 schema，避免迁移）。

## 影响

- 后端 ppm plan（list/get/export）+ project（删改名同步）。
- API 契约不变（project_name 仍返回字符串，只是来源改成 join）。
- 项目改名后列表自动反映（无需同步）。
- 无 DB 迁移、无前端改动。

## 不在范围内（Non-Goals）

- 不删 `ppm_ps_project_plan.project_name` 列（保留，避免迁移）。
- 不改前端 / create / update 写入逻辑。
- 无 schema / API 契约 / 状态机变更。

## 风险

见 design.md「风险与回滚」。关键：outerjoin 性能（数据量小可接受）；list 不再用 `_Crud.list_paged`（复用 common helper 处理分页排序计数）。
