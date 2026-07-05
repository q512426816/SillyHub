---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-04
title: read_file 按 path 读单文件 + 路径守卫 + 1MB 截断
priority: P0
depends_on: [task-01]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/change/service.py
---

# task-04 — `read_file` 按 path 读单文件 + 路径守卫 + 1MB 截断

## goal

在 `ChangeService` 新增 `read_file(workspace_id, change_id, rel_path) -> tuple[str, str | None, bool]`（返回 `(path, content, exists)`，对应 design §7 `ChangeFileContent`），按相对变更目录的 path 读单个文件。复用旧 `get_document_content`（`service.py:211-265`）的 `MAX_CONTENT_BYTES=1MB` 截断 + `read_text(errors='replace')` 范式，但用 task-01 的 `_resolve_change_dir` 取代失效的 `workspace.root_path`，并补强路径穿越守卫（D-004@v1：必须覆盖 `../`、绝对路径、符号链接三类攻击）。覆盖 FR-04、D-004@v1。

## implementation

落点 `backend/app/modules/change/service.py`（`ChangeService` 内，置于 `get_documents`/旧 `get_document_content` 同区，task-01 helper 之后、list_files 旁）。

1. 签名：`async def read_file(self, workspace_id: uuid.UUID, change_id: uuid.UUID, rel_path: str) -> tuple[str, str | None, bool]`。
2. 取变更目录：`change = await self.get(workspace_id, change_id)`（沿用旧 `get_document_content:223` 的 `get`，命中 `ChangeNotFound` 即 404，不新建异常）→ `workspace = await self._workspace_service.get(workspace_id)` → `change_dir = await self._resolve_change_dir(workspace, change)`（task-01 helper，不 resolve）。
3. 拼绝对路径：`full_path = change_dir / rel_path`。
4. 路径守卫（D-004@v1，区别于旧 `get_document_content:249-251` 的 `startswith` 字符串比对——改用 `is_relative_to` 更严格、能拒符号链接穿越）：
   - `change_dir_resolved = change_dir.resolve()`，`full_resolved = full_path.resolve()`（resolve 会展开符号链接，符号链接指向变更目录外时 full_resolved 落到 change_dir_resolved 之外）。
   - `if not full_resolved.is_relative_to(change_dir_resolved): raise ChangeDocNotFound("Path traversal detected.", details={"path": rel_path})` → 映射 400（覆盖 `../` 越界、绝对路径 `/etc/passwd`、符号链接三类）。
5. 存在性：`if not full_path.is_file(): return rel_path, None, False`（对齐旧 `get_document_content:252-253`，目录或不存在都返 exists=False，不抛）。
6. 读内容：`size = full_path.stat().st_size`；`content = full_path.read_text(encoding="utf-8", errors="replace")`（对齐旧 `:254-255`，errors='replace' 容错非 UTF-8）。
7. 截断：`if size > MAX_CONTENT_BYTES:` → `content = content[: MAX_CONTENT_BYTES // 4]`（对齐旧 `:256-257`，按字符数截到约 1MB）。
8. 返回 `rel_path, content, True`。
9. try/except 包裹第 5-7 步：`except ChangeDocNotFound: raise`（守卫异常穿透）→ 其余 `Exception` 兜底 `return rel_path, None, False`（对齐旧 `:262-265`，读失败不炸端点）。
10. 不更新 `ChangeDocument.word_count`（旧 `:258-260` 那段删——read_file 不再依赖 ChangeDocument 行，design §7 `ChangeFileContent` 只返 path/content/exists）。

## 验收标准
- 正常读：变更目录内 `tasks/task-01.md` → 返回 `(rel_path, <内容>, True)`。
- 文件不存在或 path 指向目录 → 返回 `(rel_path, None, False)`，不抛。
- 路径穿越 `../`、绝对路径 `/etc/passwd`、符号链接指向变更目录外 → 抛 `ChangeDocNotFound`（HTTP 400）。
- 文件 >1MB → content 截断到 `MAX_CONTENT_BYTES // 4` 字符。
- daemon-client 工作区：经 `_resolve_change_dir` 走 `{spec_root}/changes/{key}/`（不再用 root_path，修复旧失效读，design §1 问题 3）。
- 只读，不写盘、不改 DB。

## verify

backend pytest（并入 task-15 `test_files_router.py` 的 service 单测组，或本 task 先起 `test_read_file.py`）：

- 路径穿越 attack：`rel_path="../etc/passwd"`、`rel_path="/etc/passwd"`、在变更目录内建符号链接指向外部 → 断言抛 `ChangeDocNotFound`（422/400）。
- 正常读：建 `changes/<key>/tasks/task-01.md` 含已知内容 → 断言 `content` 匹配、`exists=True`。
- 大文件截断：建 >1MB 文件 → 断言 `len(content) <= MAX_CONTENT_BYTES // 4`。
- 不存在/目录 path → 断言 `content is None`、`exists=False`、不抛。
- 两 path_source（server-local 包裹 / daemon-client 扁平）各跑一例（D-006@v1 分流由 task-01 保证，本 task 只验读路径正确）。
- 复用 SQLite in-memory fixture（CONVENTIONS：单测 SQLite；本 task 无 PG 方言，SQLite 即可）。

## constraints

- D-004@v1：守卫必须覆盖 `../`、绝对路径、符号链接三类攻击 path——用 `Path.is_relative_to` + `.resolve()`（resolve 展开符号链接），不用旧 `startswith` 字符串比对（startswith 可被 `/change_dir_evil` 同前缀绕过）。
- 只读，不写文件、不改 DB（写回在 task-04-write_file，本 task 命名 read_file，无副作用）。
- 复用 task-01 `_resolve_change_dir`，不重新解析 spec_root（DRY）。
- `MAX_CONTENT_BYTES` 常量已存在于 `service.py:37`（1_000_000），直接引用，不重定义。
- 异常类型用 `ChangeDocNotFound`（已 import `service.py:20`，映射 400/404 由 router 层统一），不新增异常类。
- 不改 `get_document_content`（旧方法删除归 task-07/08 D-008@v1，本 task 只新增 read_file）。
