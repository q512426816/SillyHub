---
author: qinyi
created_at: 2026-08-13 15:52:00
---

# 变更提案（Proposal）— platform_change_progress 主键缺陷修复

> change: `2026-08-13-fix-platform-progress-pk`
> 决策台账：`decisions.md`（D-001@v1 ~ D-005@v1）；技术方案见 `design.md`

## 背景

`platform_change_progress` 表（进度同步收件箱）当前以 `change_name` **单主键（全局唯一）**存储进度镜像。这是 2026-08-11 `change-progress-projection` 决策 A 的遗留 tradeoff（为兼容 `workspace_id=NULL` 过渡行放弃复合主键），带来两个缺陷（2026-08-13 实测触发）：

- **跨 workspace 重名冲突**：同名变更（如 `quick-uuid8` 或跨项目复用）在第二工作区上行进度 → INSERT 撞 change_name 主键 → 500，无法同步。
- **NULL 历史行挡道**：`shk_live_` 全局上行产生的 `workspace_id=NULL` 行占用 change_name 主键，换 `shpsync_` 后带 workspace 的同名行插不进去。

## 目标

- 跨 workspace 同名变更进度镜像可共存（各占一行）。
- `workspace_id=NULL` 历史行与带 workspace 行共存，不再挡道。
- 零业务影响（端点/body/schema 不变），现有数据保留。

## 方案

**加独立 `id` UUID 主键 + `change_name` 去主键 + 保留 `(workspace_id, change_name)` 复合唯一约束**（方案 A，用户确认）。PG 唯一约束对 NULL 不参与唯一性 → 跨 workspace 同名 / NULL 行共存。

## 不在范围内（Non-Goals）

- 不改 platform_sync 端点/契约（POST/GET 路径、六表 body、header、409 响应）。
- 不处理 NULL 行语义收敛（shk_live_ 过渡期保留，正常用 shpsync_）。
- 不做进度快照清理/归档。
- 不改 change 模块投影逻辑。

## 影响面

- `model.py`：加 id 主键（default=uuid.uuid4），change_name 去主键。
- 新 migration：batch_alter_table 改主键 + 现有行回填 id。
- `service.py`：upsert INSERT 加 id。
- `__init__.py` docstring、模块文档、测试（跨 workspace 重名 / NULL 共存 / 并发回退）。
- 无 gen:types（端点 schema 不变）。
