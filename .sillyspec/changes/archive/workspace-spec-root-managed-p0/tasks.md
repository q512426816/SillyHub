---
author: hermes
created_at: 2026-06-04T15:30:00
---

# Tasks: workspace-spec-root-managed-p0

## task-01: 配置 SPEC_DATA_ROOT 环境变量
- 文件: `backend/.env`
- 操作: 添加 `SPEC_DATA_ROOT` 行
- 命令: 在 .env 末尾追加

## task-02: 创建 alembic data migration 补建 spec_workspaces
- 文件: `backend/alembic/versions/202606210900_backfill_spec_workspaces.py`
- 操作: 遍历 workspaces 表所有 active 行，为每行在 spec_workspaces 创建对应记录
- 策略: platform-managed, spec_root = {settings.spec_data_root}/{workspace_id}
- 幂等: 先查再插，已存在则跳过
- 物理目录: mkdir -p

## task-03: 迁移已有 scan 文档
- 文件: `scripts/migrate_scan_docs.py`
- 操作:
  1. 读取所有 spec_workspaces 行
  2. 遍历 .sillyspec/docs/{component_key}/ 下的 scan 文档
  3. 复制到 {spec_root}/.sillyspec/docs/{component_key}/
  4. 打印迁移统计
- 幂等: 目标已存在则跳过

## task-04: 补充测试
- 文件: `backend/app/modules/spec_workspace/tests/test_backfill.py`
- 操作:
  - 测试 backfill migration 为 workspace 创建 spec_workspaces 行
  - 测试幂等性（重复运行不报错）
  - 测试 ScanDocsService 从 spec_root 读取

## task-05: 验证端到端链路
- 操作:
  - 运行 migration
  - 运行迁移脚本
  - 调用 ScanDocsService.reparse() 确认从 spec_root 读取
  - 确认 .sillyspec/docs/ 下的文档不再是唯一副本
