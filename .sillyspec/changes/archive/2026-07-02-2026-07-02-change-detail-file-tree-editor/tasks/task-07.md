---
id: task-07
title: "list_pending_files 查询 pending/claimed edit 行"
author: qinyi
created_at: 2026-07-02 11:01:00
priority: P1
depends_on: [task-02]
blocks: [task-08]
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/service.py
---

# task-07 — `list_pending_files`

## goal
新增 `ChangeService.list_pending_files(workspace_id, change_id) -> list[PendingFileEntry]`，返回该变更下所有 `pending`/`claimed` 的 edit-kind `DaemonChangeWrite` 行（设计 §5 Phase3 / §7 PendingFileList）。供 router `GET /changes/{cid}/files/pending`（task-08）+ 前端「排队中」徽标轮询（task-10）。

## implementation
1. `change = await self.get_by_key(workspace_id, change.change_key)`（service.py:138，复用既有取 change_key 范式）。本任务签名收 `change_id`，先 `await self.get(workspace_id, change_id)`（service.py:171）拿 `change.change_key`。
2. `stmt = select(DaemonChangeWrite).where(`
   - `col(DaemonChangeWrite.workspace_id) == workspace_id`
   - `col(DaemonChangeWrite.change_key) == change_key`
   - `col(DaemonChangeWrite.status).in_(["pending", "claimed"])`
   - `col(DaemonChangeWrite.kind) == "edit"`  ← task-02 新增列；过滤避误纳 create 行
   - `).order_by(col(DaemonChangeWrite.created_at))`
3. 每行 `row.files[0]["path"]` 剥离前缀 `changes/{change_key}/` 得 `rel_path`（防御：`files` 为空或 path 无该前缀时按原样返回）。
4. 返回 `[PendingFileEntry(path=rel_path, status=row.status, created_at=row.created_at)]`。不返 `content`。

## 验收标准
- `list_pending_files(wid, cid)` 仅返该变更 `status ∈ {pending, claimed}` 且 `kind='edit'` 的行；`done`/`failed`/`create`-kind 不返。
- 按 `created_at` 升序。
- `path` 已剥离 `changes/{key}/` 前缀（前端文件树比对相对路径用）。

## verify
- `backend/app/modules/change/tests/test_files_router.py`（task-13 主体）或本任务自造 fixture：插入 pending/claimed/done 各 1 行（均 `kind='edit'`）+ 1 行 `kind='create'` pending；断言只返 pending+claimed 2 行，且不含 create 行。
- 路径剥离断言：files=[{"path":"changes/<key>/design.md",...}] → entry.path == "design.md"。

## constraints
- 只读查询，无写库 / 无文件系统访问。
- `kind='edit'` 过滤是关键——避免把 `proxy_create_change` 创建的 create-kind pending 行误当编辑排队展示。
- 依赖 task-02（`kind` 列 + migration）已落地；本任务执行前 `kind` 列须在 model + DB 已存在。
