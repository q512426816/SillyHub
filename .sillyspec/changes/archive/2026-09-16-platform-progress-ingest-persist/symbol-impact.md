# 符号影响面报告

> tasks.md 内容指纹（生成时）: a7cebe8d73b5fb19——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。

- task-01: 新增模块 `app/modules.change.title_norm`（TEMPLATE_H1_RE / _TEMPLATE_TYPE_WORDS / DISPLAY_KEY_PREFIX_RE / extract_h1 / normalize_display_title）。全新符号无既有调用点；消费者为 task-03（platform_sync._sync_change_title_from_documents 内函数级 import）与 task-04（parser._parse_change 顶部 import）——均在任务范围内。
- task-02: 新增私有方法 `PlatformSyncService._sync_change_stage_status(workspace_id, name, body)` 与类常量 `CLI_STATUS_TO_PLATFORM`；`upsert_progress` 分支 1/3 内部追加两次调用（service.py 内私有接线，无外部调用点）。`_ensure_change_row`/`_apply`/409/拒收分支签名零改动。无对外签名级变更。
- task-03: 新增私有方法 `PlatformSyncService._sync_change_title_from_documents(workspace_id, name, documents)` 与类常量 `_TITLE_STAGE_ORDER`；`upsert_documents` 返回值/签名零改动，仅收尾追加 best-effort 调用。无对外签名级变更。
- task-04: `ChangeParser._extract_title(change_dir)` 签名与返回语义零改动（裸 H1 提取不变）；`_parse_change` 内 `parsed.title` 赋值从 `self._extract_title(...) or change_key` 改为 `normalize_display_title(self._extract_title(...), change_key)`——ParsedChange.title 值域变化（模板 H1 归一化为 key 派生名），消费方 `_apply_parsed.row.title` 与既有测试断言已核实（test_parser.py:55/71/85 英文/缺失/自定义三态行为不变）。
- task-05: `_parse_change` 标准文档扫描循环对 `doc_type == "MASTER"` 缺席分支 continue——ParsedDoc 列表值域变化（不再含 MASTER exists=False 行）；消费方 `_sync_docs`（seen_keys 删除环，存量脏行自然清理）与 get_documents 读端无签名依赖。既有 MASTER 断言均为 exists=True 场景（test_parser.py:109、change test_router.py:192）不受影响。
- task-06: 纯新增测试文件 test_stage_status_ingest.py（9 用例），无生产代码符号变更。
- task-07: 纯新增测试文件 test_title_normalization.py（17 用例），无生产代码符号变更。
- task-08: test_router.py:831 断言值 `"draft"` → `"in_progress"`（FR-01/D-002@v1 预期体现）；无生产代码符号变更。
