---
author: hermes
created_at: 2026-06-04T15:30:00
---

# Design: workspace-spec-root-managed-p0

## 架构

```
SillyHub 仓库 (root_path)
├── .sillyspec/            ← 平台自身文档（不存放其他 workspace 文档）
└── data/
    └── spec-storage/      ← SPEC_DATA_ROOT
        ├── {ws_id_1}/     ← workspace 1 的 spec_root
        │   ├── .sillyspec/
        │   │   └── docs/
        │   └── manifest.json
        ├── {ws_id_2}/     ← workspace 2 的 spec_root
        └── ...
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/.env` | 修改 | 加 `SPEC_DATA_ROOT=./data/spec-storage` |
| `backend/app/core/config.py` | 不改 | 已有 `spec_data_root` 字段 |
| `backend/app/modules/spec_workspace/service.py` | 不改 | 已正确生成 spec_root 路径 |
| `backend/app/modules/workspace/service.py` | 不改 | `scan_generate()` 已正确传 spec_root |
| `backend/app/modules/scan_docs/service.py` | 不改 | 已读 spec_root |
| `backend/app/modules/change/dispatch.py` | 不改 | 已读 spec_root |
| `backend/alembic/versions/xxx_backfill_spec_workspaces.py` | 新增 | Data migration：为已有 workspace 补建 spec_workspaces 行 |
| `scripts/migrate_scan_docs.py` | 新增 | 迁移 .sillyspec/docs/ 下 scan 文档到各 workspace spec_root |
| `backend/app/modules/spec_workspace/tests/test_backfill.py` | 新增 | 测试 backfill 逻辑 |

## 兼容策略

Brownfield 变更：
- 已有 workspace 的 scan 文档在 `.sillyspec/docs/` 下
- migration 先建 spec_workspaces 行，再迁移文档
- 迁移是幂等的（重复运行不会出错）

## 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| spec_data_root 路径不存在导致 mkdir 失败 | 低 | 高 | SpecWorkspaceService.create() 已有 mkdir -p |
| 迁移文档时文件已存在 | 低 | 低 | 幂等：跳过已存在文件 |
| 硬编码 workspace id | 中 | 高 | migration 从 DB 动态读取 |
