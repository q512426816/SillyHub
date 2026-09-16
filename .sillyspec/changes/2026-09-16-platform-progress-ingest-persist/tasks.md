---
author: qinyi
created_at: '2026-09-16 07:50:00'
scale: large
---

# 任务清单（Tasks）— 2026-09-16-platform-progress-ingest-persist

- [x] task-01: 新建 title_norm.py 共享归一化 helper（TEMPLATE_H1_RE + extract_h1 + normalize_display_title） [target:NEW:backend/app/modules/change/title_norm.py]
- [x] task-02: P1 _sync_change_stage_status 落库 + upsert_progress 分支 1/3 接线（CLI_STATUS_TO_PLATFORM 映射表 + 未知值告警 + archived_at 首填） [target:backend/app/modules/platform_sync/service.py]
- [x] task-03: P2a upsert_documents title 重派生（最深阶段文档 H1 + _change_key_deleted 防复活守卫 + 占位行 IntegrityError 范式） [target:backend/app/modules/platform_sync/service.py] (depends_on: task-01)
- [x] task-04: P2a parser._extract_title 接 normalize_display_title（reparse 不回翻） [target:backend/app/modules/change/parser.py] (depends_on: task-01)
- [x] task-05: P3 parser MASTER 缺席不补 exists=False 占位行 [target:backend/app/modules/change/parser.py]
- [x] task-06: 新增 test_stage_status_ingest.py（落库/幂等/未知枚举告警/旧 CLI 无 header/409 不落库/change_deleted 不落库/reparse 不回翻） [target:NEW:backend/app/modules/platform_sync/tests/test_stage_status_ingest.py] (depends_on: task-02)
- [x] task-07: 新增 test_title_normalization.py（模板 H1 四态/documents 重派生/防复活守卫/MASTER 不发+存量清理） [target:NEW:backend/app/modules/change/tests/test_title_normalization.py] (depends_on: task-01,03,04,05)
- [x] task-08: 连带断言更新（test_router.py:831 status 随 FR-01 映射值）+ 相关回归全绿 + ruff check + mypy app [target:backend/app/modules/platform_sync/tests/test_router.py] (depends_on: task-01,02,03,04,05,06,07)
