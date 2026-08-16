---
author: qinyi
created_at: 2026-08-16 11:55:00
---

# 模块影响分析（Module Impact）— 2026-08-16-change-owner-from-token

## 影响模块清单

| 模块 | 影响等级 | 变更内容 | 回归风险 |
|---|---|---|---|
| backend/change | 中 | model.py 新增 ChangeEventORM（新表）；schema.py 三 optional 字段（kind/event_type/owner_name）；service.py enrich 两函数扩展（owner_name 批量 join + 时间线合成事件 + 截断两层分离） | 低——enrich 为读侧纯扩展，写侧在 platform_sync；新表 append-only 零迁移风险 |
| backend/platform_sync | 中 | router push_progress 传真实 User；service 新增 _sync_change_owner（savepoint 范式 best-effort） | 低——不触碰 _apply 主流程 commit 时机；失败仅回滚 savepoint |
| backend/migrations | 低 | 一条建表 migration（change_events + 两索引） | 低——down_revision 执行时实测 heads |
| frontend/changes 变更中心 | 低 | owner 列用户名三态；时间线 kind=event 样式；line-clamp 移除 | 低——纯展示层 |
| frontend/api-types | 低 | gen:types 重生成 | 低——生成器产物 |
| sillyspec CLI / sillyhub-daemon | 无 | 不触碰 | 无 |
| backend/users | 无 | 只读 join | 无 |

## 模块文档同步点（archive 时）

- `modules/backend.md`：change 模块新表 change_events + platform_sync 写入侧 owner 对齐 + enrich 投影扩展。
- `modules/frontend.md`：owner 列用户名展示 + 时间线事件条目。

## 对外契约变更

- API 响应 additive：StepTimelineEntry.kind/event_type、ChangeSummary/ChangeRead.owner_name（全 optional）。
- openapi.json + api-types.ts 同步重生成（task-03）。
- header X-SillySpec-User / last_pusher 语义零变化。
- 数据库：新表 change_events（append-only）；ux_changes/users 零变更。

## 并行/多 agent 影响

- service.py（change）与 platform_sync/service.py 为两独立文件，写侧/读侧不冲突。
- migration 撞号风险：execute 时实测 alembic heads 再定 down_revision（当前快照 d7a1f5c2b9e4）。
- 上行链路写入量增加：每次上行最多 +1 SELECT +1 UPDATE +1 INSERT（幂等时零写）。
