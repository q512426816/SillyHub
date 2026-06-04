---
author: hermes
created_at: 2026-06-04T15:45:00
wave: 3
depends_on: [task-03]
files:
  - backend/app/modules/spec_workspace/tests/test_backfill.py
---

# Task-04: 补充测试

## 目标
为 spec_workspace backfill 和 spec_root 读取链路补充测试。

## 操作步骤
1. 创建 `backend/app/modules/spec_workspace/tests/test_backfill.py`
2. 测试用例：
   - `test_backfill_creates_spec_workspace_rows`: mock 5 个 workspace，验证 backfill 创建 5 行 spec_workspaces
   - `test_backfill_idempotent`: 重复运行不报错，行数不变
   - `test_scan_docs_reads_from_spec_root`: 给 spec_root 设值，验证 ScanDocsService.reparse() 从 spec_root 读
   - `test_dispatch_resolves_db_from_spec_root`: 验证 dispatch._resolve_db_path() 优先用 spec_root

## 验证
- `pytest backend/app/modules/spec_workspace/tests/test_backfill.py` 全通过
