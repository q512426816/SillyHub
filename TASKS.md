# TASKS.md — workspace-spec-root-managed-p0

## 变更概述
打通 Workspace 专属文档目录，让平台扫描的项目文档写入 workspace.spec_root 而非 SillyHub 自身仓库。

## Task 清单

### [ ] Task-01: 配置 SPEC_DATA_ROOT 环境变量
- 文件: `backend/.env`, `.gitignore`
- 操作: .env 加 `SPEC_DATA_ROOT`，.gitignore 加 `data/spec-storage/`

### [ ] Task-02: 创建 alembic data migration 补建 spec_workspaces
- 文件: `backend/alembic/versions/202606210900_backfill_spec_workspaces.py`
- 操作: 遍历 workspaces 表所有 active 行，为每行在 spec_workspaces 创建对应记录
- 幂等: 先 SELECT 再 INSERT，已存在则跳过

### [x] Task-03: 迁移已有 scan 文档
- 文件: `scripts/migrate_scan_docs.py`
- 操作: 从 `.sillyspec/docs/{component_key}/scan/` 复制到 `{spec_root}/.sillyspec/docs/{component_key}/scan/`
- 幂等: dirs_exist_ok=True

### [ ] Task-04: 补充测试
- 文件: `backend/app/modules/spec_workspace/tests/test_backfill.py`
- 测试: backfill 幂等性、ScanDocsService 从 spec_root 读取

### [ ] Task-05: 验证端到端链路
- 手动验证: migration → 迁移脚本 → ScanDocsService 读取

## 详细设计
见 `.sillyspec/changes/workspace-spec-root-managed-p0/tasks/` 下各 task 文件。
