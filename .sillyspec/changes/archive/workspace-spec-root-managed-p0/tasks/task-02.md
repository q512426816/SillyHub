---
author: hermes
created_at: 2026-06-04T15:45:00
wave: 1
depends_on: [task-01]
files:
  - backend/alembic/versions/202606210900_backfill_spec_workspaces.py
---

# Task-02: 创建 alembic data migration 补建 spec_workspaces

## 目标
为 workspaces 表中所有 active 行在 spec_workspaces 表补建对应记录。

## 操作步骤
1. 创建 migration 文件 `backend/alembic/versions/202606210900_backfill_spec_workspaces.py`
2. `upgrade()` 函数：
   - 读取 `spec_data_root` 配置（从环境变量或默认值）
   - SELECT 所有 status='active' AND deleted_at IS NULL 的 workspace
   - 对每个 workspace：
     - 检查 spec_workspaces 是否已有该 workspace_id 的行
     - 没有 → INSERT，strategy='platform-managed'，spec_root='{spec_data_root}/{workspace_id}'
     - 创建物理目录 `mkdir -p {spec_root}`
3. `downgrade()` 函数：
   - DELETE FROM spec_workspaces WHERE workspace_id IN (SELECT id FROM workspaces)
   - 不删物理目录（安全）

## 关键约束
- 幂等：先查再插
- spec_data_root 路径用 `os.path.abspath()` 转为绝对路径
- workspace_id 是 UUID，直接用作目录名

## 验证
- `alembic upgrade head` 成功
- `SELECT count(*) FROM spec_workspaces` 返回 5
- 每行 spec_root 指向正确路径，物理目录存在
