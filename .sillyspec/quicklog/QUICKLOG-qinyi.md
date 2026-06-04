## ql-20260604-001-progress | 2026-06-04 10:43:13 | 清除 progress.json 残留引用

状态：已完成
文件：backend/app/core/spec_paths.py、backend/app/modules/runtime/service.py、backend/app/modules/runtime/schema.py、backend/app/modules/runtime/tests/test_router.py
摘要：删除 progress.json fallback 逻辑，改用 SQLite sillyspec.db。测试通过 4/4。
