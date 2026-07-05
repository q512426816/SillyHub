---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-03
title: list_files 遍历变更目录全部文件
priority: P0
depends_on: [task-01]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/service.py
---

# task-03 — `list_files` 遍历变更目录全部文件

## goal

在 `ChangeService` 新增 `list_files(workspace_id, change_id) -> list[ChangeFileEntry]`，递归遍历变更目录下全部文件，返回扁平清单（`path` 相对变更目录 posix、`name`、`size`、`last_modified_at`、`is_text`）。供前端文件树（task-11 `buildChangeFileTree`）消费。覆盖 FR-03。依赖 task-01 的 `_resolve_change_dir` 解析变更目录绝对路径。

## implementation

落点 `backend/app/modules/change/service.py`（`ChangeService` 内，置于 task-01 `_resolve_change_dir` 之后、reparse 之前的查询方法区）。

1. **解析变更目录**：先 `await self.get(workspace_id, change_id)` 拿 change（复用现有 get，含 workspace 存在性校验 + M:N 回退，service.py:171-199），再 `await self._workspace_service.get(workspace_id)` 拿 workspace，最后 `await self._resolve_change_dir(workspace, change)`（task-01）拿目录 `Path`。
2. **目录不存在返回空列表**（不抛）：`if not change_dir.is_dir(): return []`。对齐 scan_docs parser `parser.py:116` 的 `if not docs_dir.is_dir(): return result` 范式。
3. **遍历**：`for file_path in sorted(change_dir.rglob("*")):`（对齐 scan_docs `parser.py:127`），逐项过滤：
   - `not file_path.is_file()` → skip（跳过目录，parser.py:128）。
   - 文件名以 `.` 开头（隐藏文件，如 `.gitkeep`、`.DS_Store`）→ skip。
   - 路径任一段为 `__pycache__`（` "__pycache__" in file_path.parts`）→ skip。
4. **每文件构造 `ChangeFileEntry`**：
   - `path`：`str(file_path.relative_to(change_dir)).replace("\\", "/")`（跨平台 posix 相对路径，对齐 parser.py:143-144 的 `rel_str` 范式）。例：`tasks/task-01.md`、`prototype-foo.html`。
   - `name`：`file_path.name`。
   - `size`：`file_path.stat().st_size`（int 字节）。
   - `last_modified_at`：`datetime.fromtimestamp(file_path.stat().st_mtime, tz=UTC)`（对齐 parser.py:165）。stat 异常（OSError）→ 该字段 `None`，不中断遍历。
   - `is_text`：`file_path.suffix.lower() in {".md", ".html", ".yaml", ".yml", ".json", ".txt", ".mdx"}`（扩展名判定，design §7）。
5. **不读文件内容**（内容由 task-02 read_file 负责）；不 sort 内容，只 sort 路径（`sorted(rglob)` 已按路径字典序）。
6. **`ChangeFileEntry` 类型定义**：本 task 内在 `service.py` 顶部（`CompleteStageResult` dataclass 区附近）定义 pydantic `BaseModel`（字段对齐 design §7：`path/name/size/last_modified_at/is_text`）。**注**：task-07 会把该模型迁到 `schema.py` 统一管理（task-07 的 allowed_paths 含 schema.py），本 task 不跨文件改 schema。

签名参考：
```python
async def list_files(
    self, workspace_id: uuid.UUID, change_id: uuid.UUID
) -> list[ChangeFileEntry]: ...
```

## 验收标准
- 变更目录含 `tasks/task-01.md`、`design.md`、`prototype-x.html`、`references/note.md` → 四项全部列出，`path` 为相对 posix。
- 隐藏文件（`.gitkeep`、`.DS_Store`）不出现在结果。
- `__pycache__/*.pyc` 不出现在结果。
- `is_text`：`.md/.html/.yaml/.yml/.json/.txt/.mdx` → True；其它（如 `.png`）→ False。
- 目录不存在（变更目录被外部删除）→ 返回 `[]`，不抛异常。
- daemon-client 工作区：经 task-01 解析到 `{spec_root}/changes/{key}/`，能列出镜像卷真实文件（修复旧 `get_document_content` 用 root_path 失效的同类问题）。

## verify

backend pytest（并入 task-15 的 `test_files_router.py` 或本 task 起 service 单测组 `test_list_files.py`）：

- 造变更目录（tmp_path）含 `tasks/` 子目录 + `prototype-*.html` + `design.md` + 隐藏文件 `.gitkeep` + `__pycache__/x.pyc`，断言：tasks 子目录下文件全列出、prototype 列出、隐藏/pyc 排除。
- 断言 `path` 为 posix（Windows 下 `\` → `/`）：构造 `tasks/sub/a.md` 断言 `path == "tasks/sub/a.md"`。
- 断言 `is_text` 分流（.md True / .png False）。
- 目录不存在 → `[]`。
- server-local + daemon-client 两分支各跑一例（mock `_resolve_change_dir` 返回不同根，验证 list_files 本身与 path_source 解耦——分流已在 task-01 完成）。
- 复用 SQLite in-memory fixture（无 PG 方言依赖）。

## constraints

- 跨平台：相对路径用 `relative_to + replace("\\", "/")`（pathlib PosixPath 风格），不手拼分隔符。
- 不读文件内容（YAGNI，design N1/N3：list 只列元数据，read 才读内容）。
- 不做目录树组装（扁平清单即可，树由前端 task-10 `buildChangeFileTree` 组）。
- `ChangeFileEntry` 临时定义在 service.py，task-07 迁 schema.py（避免本 task 跨 allowed_paths 改 schema.py）。
- 仅改 `service.py`。不动 router（task-07 接线）、不动 schema.py（task-07 迁移）。
