---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-05
title: write_file path_source 分流写回 + 同文件 pending 合并
priority: P0
depends_on: [task-01, task-02]
requirement_ids: [FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/daemon/model.py
---

# task-05 — `write_file` path_source 分流写回 + 同文件 pending 合并

## goal

在 `ChangeService` 新增 `write_file(workspace_id, change_id, rel_path, content) -> {status, task_id}`，实现 POST files/content 的写回核心（design §5 Phase2）。按 `path_source` 分流（D-006@v1）：server-local 直写盘返 done；daemon-client 镜像即时直写 + 入 outbox 队列（kind="edit"）返 pending，**不 await**（D-001@v1 离线续传），并对同 `(change_key, rel_path)` 的 pending 行做 last-write-wins 合并（D-002@v1）。覆盖 FR-05、FR-06。

## implementation

落点 `backend/app/modules/change/service.py`（`ChangeService` 公有方法，置于 `_resolve_change_dir` 之后、reparse 之前）。`daemon/model.py` 已含 `kind` 字段（task-09 已加）。

```python
async def write_file(
    self, workspace_id: uuid.UUID, change_id: uuid.UUID, rel_path: str, content: str
) -> dict:  # {"status": "done"|"pending", "task_id": uuid|None}
```

1. 前置：取 `workspace = await self._workspace_service.get(workspace_id)`、`change = await self.get(workspace_id, change_id)`。
2. **路径守卫**（D-004@v1，与 task-04 同范式）：`change_dir = await self._resolve_change_dir(workspace, change)`；`resolved = (change_dir / rel_path).resolve()`；`if not str(resolved).startswith(str(change_dir.resolve())): raise ChangeDocNotFound("Path traversal detected.")`（对齐 `sync_documents` `service.py:339-341`）。覆盖 `../`、绝对路径、符号链接。
3. **content ≤ 1MB**（与 task-03 `MAX_CONTENT_BYTES` 同常量）：超限 raise 400（`ChangeDocNotFound` 或专用 `AppError`，沿用 task-03 既有错误类型）。
4. 分流（`from app.modules.workspace.service import is_daemon_client_path_source`，对齐 reparse `service.py:714`）：

   **server-local（!daemon-client）**：
   - `target = change_dir / rel_path`；`target.parent.mkdir(parents=True, exist_ok=True)`；`target.write_text(content, encoding="utf-8")`（对齐 `sync_documents` `service.py:342-343`）。
   - 调 `self._resync_change_docs(workspace_id, change_id)`（task-05 的同名兄弟 task 提供，若未就绪则 import-guard best-effort + log.warning）。
   - 返 `{"status": "done", "task_id": None}`。

   **daemon-client（双写）**：
   - ① 镜像直写（spike-01 验可写）：`target = change_dir / rel_path`；`target.parent.mkdir(...)`；`target.write_text(content, encoding="utf-8")`。**若 spike-01 不通过**：跳过镜像直写（不写），仅入队，resync 推迟到 daemon complete+sync 后（R-05 降级，前端轮询兜底）。
   - ② 合并/新建 outbox 行（D-002 last-write-wins）：
     - `SELECT DaemonChangeWrite WHERE change_key==change.change_key AND status=="pending"`，逐行扫描 `files` 列表匹配 `files[].path == f"changes/{change.change_key}/{rel_path}"`（path 与 proxy `_build_files` `proxy.py:96-123` 同格式 `changes/<key>/<file>`）。
     - 命中：UPDATE 该行 `files[matched_idx].content = content` + `created_at = datetime.now(UTC)`（刷新排序），`self._session.add(row)`。
     - 未命中：`row = DaemonChangeWrite(workspace_id=..., runtime_id=workspace.daemon_runtime_id, change_key=change.change_key, kind="edit", files=[{"path": f"changes/{change.change_key}/{rel_path}", "content": content, "doc_type": "edit"}], status="pending")`（files 项结构对齐 `_build_files`，doc_type 取 "edit"）。
   - **不调** `_await_change_write_receipt`（D-001：区别于 `proxy_create_change` `proxy.py:128-165` 的 60s 阻塞 await）。
   - `await self._session.commit()`；取 `task_id = row.id`。
   - ③ spike-01 通过则调 `self._resync_change_docs(workspace_id, change_id)`；不通过则跳过（镜像未写，resync 无意义）。
   - ④ 返 `{"status": "pending", "task_id": task_id}`。

## 验收标准
- server-local：写盘到 `{root_path}/.sillyspec/changes/{key}/{rel_path}`（parents 自动建），调 resync，返 `{status:"done", task_id:null}`。
- daemon-client：① 镜像写 `{spec_root}/changes/{key}/{rel_path}`；② outbox 行 status=pending（无 await）；③ resync 刷新；④ 返 `{status:"pending", task_id:<row.id>}`。
- 同文件二次保存（pending 行存在）：不新增行，原行 `files[0].content` 被更新为新 content + `created_at` 刷新（D-002 单行合并）。
- daemon 离线（无 claim）：返回后行保持 pending（不翻 failed）——离线续传。
- 路径攻击（`../`/绝对/符号链接）→ 400；content > 1MB → 400。

## verify

backend pytest（新建 `backend/app/modules/change/tests/test_write_file.py`，并入 task-15/16 单测组）：

- **两分支**：server-local → status="done" + 文件落盘；daemon-client → status="pending" + task_id 非空 + 镜像文件落盘。
- **同文件二次保存合并**：连续两次 write_file 同 rel_path 不同 content → DB 仅一行，content=后值，created_at 更新。
- **pending 不 await**：daemon 离线（无 daemon-client 心跳/claim）下 write_file 立即返回（断言调用耗时 < 2s，不阻塞 60s），行保持 pending。
- **路径守卫**：rel_path=`../../etc/passwd`、`/etc/passwd`（绝对）、符号链接出目录 → 均抛 400。
- **content 上限**：content 长度 1MB+1 → 400。
- 现有 `proxy_create_change` 创建路径回归断言（kind="create" 默认、`_await_change_write_receipt` 60s 行为不变）。

不在本 task 跑 router 端点测（task-07 接线 + task-15 负责）。

## constraints

- **D-001@v1**：绝不调 `_await_change_write_receipt`；不修改其 60s 超时逻辑（该函数仅服务 `proxy_create_change`，本 task 走独立路径根本不 await）。
- **D-002@v1**：同 `(change_key, rel_path)` pending 行 last-write-wins 合并（UPDATE content + created_at），不新增行。
- **D-006@v1**：`is_daemon_client_path_source(workspace.path_source)` 分流；两分支各有单测。
- **spike-01 不通过降级**（R-05）：跳过镜像直写 + 跳过 resync，仅入队（pending 行仍建/合并），返 `{status:"pending", task_id}`。execute 前先确认 spike-01 结论决定是否写镜像分支。
- **runtime_id**：`workspace.daemon_runtime_id` 必须非空（daemon-client 工作区已绑定）；None 时 raise `DaemonClientNoActiveSession`（对齐 `proxy_create_change` `proxy.py:192-199` 守卫，但仅在 daemon-client 分支检查）。
- **单编辑者并发**：不做三方合并（N6/R-07），last-write-wins；文档注明。
- `files` 载荷结构严格对齐 `proxy._build_files` 的 `{path, content, doc_type}`（path 形如 `changes/<key>/<file>`，doc_type 取 "edit"），保证旧 daemon 不识别 `kind` 也能照常 claim→write（brownfield §9）。
- 仅改 `service.py`（+ 必要时 `model.py` 若 task-09 的 kind 列尚缺，本 task allowed_paths 含 model.py 兜底）；不动 router（task-07）、不动 proxy（D-001 红线）。
