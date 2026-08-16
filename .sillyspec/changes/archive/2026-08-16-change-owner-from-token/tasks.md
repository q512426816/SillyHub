---
author: qinyi
created_at: 2026-08-16 07:52:00
---
# 任务清单（Tasks）

> 以 plan.md 为准（骨架与其同步）。

- [x] task-01: ChangeEventORM 模型 + 建表 migration（execute 时实测 alembic heads 定 down_revision）
- [x] task-02: platform_sync 写入侧——router 传真实 User + `_sync_change_owner`（savepoint 原子/幂等/首填不记事件/best-effort）+ 测试
- [x] task-03: schema 增量（StepTimelineEntry.kind/event_type + owner_name）+ gen:types
- [x] task-04: 读侧投影——enrich 批量 join users 填 owner_name + 时间线合成事件（重编 ordering/stage 近似）+ 测试
- [x] task-05: 前端——owner 列用户名 + 时间线事件样式 + 明细不截断（line-clamp 移除）+ 测试（含长文本用例）
- [x] task-06: 全量回归——pytest + vitest + tsc + 双用户上行冒烟
- [x] ql-20260816-002-402b 提案书（Proposal）
