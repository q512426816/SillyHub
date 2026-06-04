---
author: hermes
created_at: 2026-06-04T15:45:00
wave: 3
depends_on: [task-03, task-04]
files: []
---

# Task-05: 验证端到端链路

## 目标
手动验证 spec_root 全链路跑通。

## 操作步骤
1. 运行 `alembic upgrade head` — 确认 migration 成功
2. 运行 `python scripts/migrate_scan_docs.py` — 确认文档迁移成功
3. 启动后端，调用 `GET /workspaces/{id}/scan-docs` — 确认返回 spec_root 下的文档
4. 确认 `.sillyspec/docs/` 下的旧文档仍然存在（不删除）
5. 运行 `pytest` — 确认全量测试通过

## 验证
- ScanDocsService 从 spec_root 读取，不再 fallback 到 root_path
- 全部测试通过
