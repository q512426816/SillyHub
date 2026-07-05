---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-06
title: "_resync_change_docs per-change 文档刷新"
priority: P0
depends_on: [task-01]
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/parser.py
---

# task-06 — `_resync_change_docs` per-change 文档刷新

## 目标

新增 `ChangeService._resync_change_docs(workspace_id: uuid.UUID, change_id: uuid.UUID) -> None`，
**只重新解析单个变更目录**并刷新该 change 的 DB 文档矩阵（`ChangeDocument` 行 + `change.title`），
供 task-05/08 的 `POST /changes/{cid}/files/content` 在写完平台镜像后立即调用（D-005@v1：per-change、POST 时执行、不钩 complete 避 daemon 先-complete-后-sync 竞态）。

## 设计依据

- design §5 Phase3（service.py:76 resync 时机 + §77 不钩 complete 竞态说明）。
- design §7.5 行「resync docs」：发起方 backend(POST 内)，接收方 DB change_documents，状态「即时刷新（不依赖 complete）」。
- design D-005@v1（§11 决策追踪）。
- plan task-06 行 + 覆盖矩阵 D-005@v1 → task-06, task-08。
- 现有代码：
  - `ChangeParser._parse_change`（parser.py:446-563）单目录解析 → `ParsedChange`（含 docs + title + affected_components + change_type），需传 `change_dir` + `location`/`rel_prefix`。
  - `ChangeParser._extract_title`（parser.py:171-183）读 proposal.md 首个 `# ` heading。
  - `ChangeService._sync_docs`（service.py:840-877）刷 `ChangeDocument` 行（按 `(doc_type,path)` upsert exists/path/last_modified_at + 删消失行）。
  - `ChangeService._apply_parsed`（service.py:982-998）已含 `row.title = parsed.title`（保护 change_type、覆写 affected_components）。
  - `reparse`（service.py:734-769）示范逐 change 调 `_apply_parsed` + `_sync_docs` 的范式。

## 实现要点

1. **拿变更目录**：调 task-01 `_resolve_change_dir(workspace_id, change_id) -> Path`（spec_root 解析，daemon-client 扁平 / server-local 包裹）。
2. **取 change_key**：从 DB 查 `Change` 行（`change_id`）拿 `change_key` + `path_source`（或 `_resolve_change_dir` 一并返回）。必要时通过 `is_daemon_client_path_source` 判 `platform_managed`（与 reparse service.py:714 对齐）。
3. **单目录解析**：用 `self._parser._parse_change(sillyspec_root, change_dir, location="active", rel_prefix=...)` → `ParsedChange`。daemon-client 扁平用 `rel_prefix=f"changes/{change_key}"`，server-local 用 `f".sillyspec/changes/{change_key}"`（对齐 parser.py:87-110 调用约定）。
   - 不调 `parse_workspace`（全量，违反 D-005 per-change 约束）。
   - 不改 parser 公共接口：复用 `_parse_change`（已是模块内方法，本 service 同模块可触达）。
4. **刷 DB**：
   - 调 `self._apply_parsed(existing_change, parsed, workspace_id=workspace_id)` → title / affected_components / change_key 跟上（含编辑 proposal.md heading 后 title 同步，FR-07/D-005 的关键效果）。
   - 调 `self._sync_docs(change=parsed, workspace_id=workspace_id, existing_change=existing_change, stats=stats)` 刷 `ChangeDocument` 行（exists/path/last_modified_at）。
   - `await self._session.commit()`。
5. **best-effort（R-05 / D-005 约束）**：整体 `try/except Exception as exc`，失败仅 `log.warning("change.resync_failed", change_id=..., error=str(exc))`，**不抛**——保证 `POST files/content` 返回不被阻断（镜像已写成功，resync 失败可由下次 reparse 兜底）。

## 验收标准
- pytest：编辑 `proposal.md` 首行 heading 后调 `_resync_change_docs` → `ChangeDocument` 行 `last_modified_at` 更新（断言 mtime 变化）+ `change.title` 等于新 heading（断言行变）。
- pytest：单目录解析断言不触发全工作区 reparse（仅该 change 的 docs 刷新，可造第二个 change 验证其行不变）。
- pytest：`_parse_change` 抛异常时 `_resync_change_docs` 吞掉异常 + 仅 log + 不抛（POST 不受影响）。

## 约束

- D-005@v1：per-change（只该 change 目录），**非全量 reparse**。
- 失败 best-effort（try/except + structlog log，不抛、不阻断 POST）。
- 不改 parser 公共接口（复用 `_parse_change`）。
- resync 时机由调用方（task-05/08 POST）控制；本 task 只提供方法，**不**自行挂到 `complete_change_write`（避免 design §77 竞态）。
