---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-01
title: _resolve_change_dir spec_root 解析 helper
priority: P0
depends_on: []
requirement_ids: [FR-03]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/spec_workspace/service.py
---

# task-01 — `_resolve_change_dir` spec_root 解析 helper

## goal

在 `ChangeService` 新增 `_resolve_change_dir(workspace, change) -> Path`，统一解析单个变更目录的绝对路径，作为 task-02/03/04/05 共用的位置定位原语。替代现有用 `workspace.root_path` 读文档（对 daemon-client 失效）的旧写法，对齐 `reparse`（`service.py:696-708`）的 spec_root 解析范式。覆盖 FR-03、D-006@v1（path_source 分流）。

## implementation

落点 `backend/app/modules/change/service.py`（`ChangeService` 内私有方法，置于 reparse 之前的工具方法区）。

1. 取 spec 根：
   - `await SpecWorkspaceService(self._session).get(workspace.id)`（函数内 import，对齐 reparse `service.py:698`）。
   - try/except `Exception` 兜底（`SpecWorkspaceNotFound` 或任何异常）→ log.warning（`change.resolve_change_dir_failed`，含 workspace_id/error），回退 `Path(workspace.root_path)`。
   - 拿到 spec_ws 且 `spec_ws.spec_root` 非空 → 用 `Path(spec_ws.spec_root)`；否则回退 `Path(workspace.root_path)`。
2. path_source 分流（`from app.modules.workspace.service import is_daemon_client_path_source`）：
   - `is_daemon_client_path_source(workspace.path_source)` 为 True（扁平布局）→ 返回 `spec_root / "changes" / change.change_key`。
   - 否则 server-local（包裹布局）→ 返回 `root_path / ".sillyspec" / "changes" / change.change_key`（对齐 parser `platform_managed=False` 的扫描根，design §5 Phase1）。
3. 返回 `Path`（绝对路径，不 `.resolve()`，调用方需 resolve 时自行做——task-03/04 路径守卫负责 resolve+落在变更目录内校验）。
4. 不在 helper 内做存在性检查（调用方 list_files 不存在返空、read_file 不存在返 exists=False）。

签名参考：
```python
async def _resolve_change_dir(self, workspace: Workspace, change: Change) -> Path: ...
```

调用方传 `(workspace, change)` 而非 `workspace_id, change_key`——避免再查一次 workspace/change（task-02~05 已持有这两个对象）。

## 验收标准
- daemon-client 工作区：返回 `{spec_root}/changes/{change_key}/`（用 `SpecWorkspaceService.get` 的 spec_root，不用 root_path）。
- server-local 工作区：返回 `{root_path}/.sillyspec/changes/{change_key}/`。
- spec_ws 不存在（未配置 spec workspace）或 spec_root 为空：回退 root_path 分流（daemon-client 仍走扁平根=root_path/changes/...，server-local 走包裹）——与 reparse 同语义，不抛异常。
- 不读文件系统（纯路径计算），无副作用。

## verify

backend pytest（service 单测，新建 `backend/app/modules/change/tests/test_resolve_change_dir.py` 或并入 task-15 的 test_files_router 同目录 service 单测组）：

- daemon-client 工作区 + spec_ws 存在 → 断言返回路径 = `{spec_root}/changes/{key}`。
- server-local 工作区 → 断言返回路径 = `{root_path}/.sillyspec/changes/{key}`。
- spec_ws 抛 `SpecWorkspaceNotFound` → 回退 root_path 分流（不抛、log.warning 落地）。
- spec_ws.spec_root 为空字符串 → 回退 root_path。
- 复用 SQLite in-memory fixture（CONVENTIONS：单测 SQLite，生产 PG；此处无 PG 方言，SQLite 即可）。

不在本 task 跑 router/端点测（task-15 负责）。

## constraints

- brownfield：server-local 行为零变化（`.sillyspec` 包裹根与现有 reparse `platform_managed=False` 一致）。daemon-client 修复为 spec_root（之前 `get_document_content` 用 root_path 失效，design §9 已决定删 get_document_content 而非修，本 helper 是新增能力供 list/read/write 使用）。
- 仅改 `service.py` + 必要时 `spec_workspace/service.py`（本 task 不需改后者，导入即可）。`spec_workspace/service.py` 列在 allowed_paths 是因为若发现 `SpecWorkspaceService.get` 需加 `get_or_none` 变体可在此 task 内顺手加——但优先 try/except 复用现有 get，不扩接口（YAGNI）。
- 对齐 reparse `service.py:696-714` 的解析+分流范式，不引入新 import 旁路（SpecWorkspaceService 函数内 import 保持与 reparse 一致，避免顶层循环依赖风险）。
