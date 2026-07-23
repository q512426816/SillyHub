---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-06
title: alembic migration status 值映射
wave: 1
blockedBy: [task-02]
allowed_paths: [backend/app/modules/ppm/migrations/versions/20260720_problem_status_3state.py]
acceptance: [FR-1]
---

## 目标
新增 migration：`ppm_problem_list.status` 列宽 8→30 + 值映射老数字到中文 3 态。

## 实现步骤
1. 新建 `20260720_problem_status_3state.py`，`revision = "20260720_problem_status_3state"`，`down_revision = "20260718_project_org_id"`（已 `alembic heads` 确认单 head，MEMORY `migration-chain-fragmentation-pattern`）。
2. `upgrade()`：
   - `op.alter_column("ppm_problem_list", "status", existing_type=sa.String(8), type_=sa.String(30), nullable=False)`；
   - 值映射 UPDATE（顺序：先 3→进行中、4→已完成，最后 1/2/5/6/7→新建，避免覆盖）：
     ```python
     op.execute("UPDATE ppm_problem_list SET status='进行中' WHERE status='3'")
     op.execute("UPDATE ppm_problem_list SET status='已完成' WHERE status='4'")
     op.execute("UPDATE ppm_problem_list SET status='新建' WHERE status NOT IN ('进行中','已完成')")
     ```
   - 设默认值：`op.alter_column(..., server_default="新建")`。
3. `downgrade()`：反向（数据可清空，downgrade 简化：列宽回 8，不恢复老数字值，仅 reset）。
4. 不删废弃列（now_node/check_*/audit_*/handle_info 保留，D-005 + 减少爆炸半径）。

## 测试点
- 干净库 `cd backend && uv run alembic upgrade head` 通过；`alembic heads` 仍单 head（新 revision）。
- 老数据 `status='1'` → upgrade 后 `'新建'`。

## 验收
- migration upgrade/downgrade 无错；单 head；现有 migration 链未断裂。
