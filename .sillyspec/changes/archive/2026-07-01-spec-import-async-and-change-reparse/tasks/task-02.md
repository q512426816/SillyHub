---
id: task-02
title: backend apply_sync 拆分——apply/reparse_docs/reparse_changes 三步各自容错（覆盖：FR-01, FR-05, D-003）
author: WhaleFall
created_at: 2026-07-01 13:04:17
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01, FR-05]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_bundle_sync.py
status: pending
---

## goal
apply_sync 落盘后顺序调 ScanDocService.reparse(docs)+ChangeService.reparse(changes)，各自 try/except 容错（失败设 sync_status=dirty 不阻断另一阶段），返回 {reparsed_docs, reparsed_changes} 各段 parsed。

## implementation
- apply_sync 返回类型 int → dict（如 `{reparsed_docs, reparsed_changes}`）；保持现签名（workspace_id, tar_bytes），落盘/tar 校验/Sip Slip 防护不动（service.py:427-478）
- 落盘逻辑不变；落盘成功后 commit sync_status=clean（service.py:483-487）
- 顺序调 ScanDocService.reparse → ChangeService.reparse，各自独立 try/except：成功记 stats.parsed；失败 log.warning + 设 sync_status=dirty 并 commit，但**不 raise**（docs/changes 独立，部分成功优于全失败——修正现 service.py:494-503 失败即 raise 的行为）
- import_from_repo 内 service.py:256 与 :292 调用点同步更新（接受 dict 返回，日志字段从 reparsed:int 改 reparsed_docs/reparsed_changes）
- 新增 test_bundle_sync.py 用例：① apply_sync 后 docs+changes 双 reparse 都入库；② ScanDoc.reparse 注入异常 → sync_status=dirty 且 ChangeService.reparse 仍执行；③ 反之 ChangeService 异常 docs 仍执行

## acceptance
- apply_sync 落盘后 docs 入 ScanDocument 表、changes 入 Change 表（变更中心可读）
- reparse_docs 失败时 sync_status=dirty，reparse_changes 仍执行；反之亦然（两段独立）
- apply_sync 不再因 reparse 异常 raise（落盘成功的文件即真理源，D-006）
- sync 端点（router.py:135）行为兼容：apply_sync 返回 dict 后由 task-03 统一进 DTO，本任务不动 router/schema

## verify
- 临时容器：`docker run --rm -v backend:/app multi-agent-platform-backend:latest sh -c 'pip install --target=/tmp/d -q pytest pytest-asyncio aiosqlite anyio && PYTHONPATH=/tmp/d python -m pytest app/modules/spec_workspace/tests/ -q'`
- ruff/format/mypy 过

## constraints
- 不改 ScanDocService/ChangeService 内部（只调用其 reparse）
- ChangeService.reparse 已处理 daemon-client 扁平布局（service.py:668-692），本任务不重复处理 path_source
- spike-01：执行时实测 reparse changes 1100 文件耗时（design §12 风险），>50s 反馈 task-03
