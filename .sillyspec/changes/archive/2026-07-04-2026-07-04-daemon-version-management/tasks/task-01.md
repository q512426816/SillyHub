---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-01
allowed_paths:
  - backend/app/modules/daemon/model.py
  - backend/migrations/versions/
---

# task-01: backend model + migration（build_id 列）

## 所属 Wave
Wave 1（数据通路，最先执行）

## 文件
- 修改 `backend/app/modules/daemon/model.py`：`DaemonInstance` 加 `build_id: str | None`（String(50), nullable）
- 新增 `backend/migrations/versions/<rev>_daemon_instance_build_id.py`：upgrade 加 build_id 列、downgrade 删；`down_revision = 'b16bf63a5d05'`，revision id 唯一

## 验收标准
- [ ] DaemonInstance model 含 build_id 列定义
- [ ] migration upgrade 加列、downgrade 删列
- [ ] down_revision 严格 = b16bf63a5d05（当前 head）
- [ ] `alembic heads` 执行后仍为单 head（不引入多 head）
- [ ] migration 测试 upgrade/downgrade 通过（见 task-10）

## 依赖
无（Wave 1 起点）

## 覆盖
- FR-03, D-003@V1

## 风险防范
- R-02（migration 多 head）：execute 前先 `alembic heads` 确认单 head，revision id 与并行变更不碰撞
- 参见 memory: migration-chain-fragmentation-pattern
