---
author: hermes
created_at: 2026-06-04T15:45:00
---

# Plan: workspace-spec-root-managed-p0

## 概述

为 SillyHub 已有的 5 个 workspace 补建 `spec_workspaces` 记录，配置 `SPEC_DATA_ROOT`，迁移 scan 文档到各 workspace 专属目录。P0 只做 managed 模式。

## Wave 分组

### Wave 1: 基础配置 + Data Migration（task-01, task-02）
- task-01: 配置 SPEC_DATA_ROOT 环境变量
- task-02: 创建 alembic data migration 补建 spec_workspaces
- **依赖**: 无
- **完成标准**: migration 运行成功，5 个 workspace 都有 spec_workspaces 行

### Wave 2: 文档迁移（task-03）
- task-03: 迁移已有 scan 文档到 spec_root
- **依赖**: Wave 1（需要 spec_workspaces 行和物理目录）
- **完成标准**: .sillyspec/docs/{component}/scan/ 文档复制到 spec_root

### Wave 3: 测试 + 验证（task-04, task-05）
- task-04: 补充测试
- task-05: 验证端到端链路
- **依赖**: Wave 2
- **完成标准**: 全部测试通过，ScanDocsService 从 spec_root 读取

## 任务总表

| Task | Wave | 文件 | 预估行数 |
|------|------|------|---------|
| task-01 | W1 | backend/.env | 1 |
| task-02 | W1 | alembic/versions/202606210900_backfill_spec_workspaces.py | ~60 |
| task-03 | W2 | scripts/migrate_scan_docs.py | ~80 |
| task-04 | W3 | spec_workspace/tests/test_backfill.py | ~120 |
| task-05 | W3 | 手动验证 | 0 |

## 风险缓解

- migration 幂等：先 SELECT 再 INSERT
- 文档迁移幂等：目标存在则跳过
- `.gitignore` 加 `data/spec-storage/` 避免误提交
