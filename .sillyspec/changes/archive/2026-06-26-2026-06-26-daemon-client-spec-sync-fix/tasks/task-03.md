---
id: task-03
title: "runtime/service + knowledge(service 重定向 spec_ws.spec_root + parser mode)"
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/runtime/service.py
  - backend/app/modules/knowledge/service.py
  - backend/app/modules/knowledge/parser.py
---

# task-03 — runtime/service + knowledge(service 重定向 spec_ws.spec_root + parser mode)

## goal

修复 R6：knowledge/service 当前用 `Path(workspace.root_path) / ".sillyspec"`（daemon-client 的 root_path 是客户端机源码路径、backend 读不到，且未走 spec_workspaces），重定向到 `spec_ws.spec_root` 并按 platform-managed mode 解析；同时把 runtime/service 的 `_resolve_runtime_dir` / `get_progress` 收敛到 `SpecPathResolver.for_spec_workspace(spec_ws)`。daemon-client workspace 的 `/knowledge`、`/runtime` 在 scan 终态回灌后立即可见。

## implementation

- `runtime/service.py`：
  - `_resolve_runtime_dir` 改为：`spec_ws` 存在 → `SpecPathResolver.for_spec_workspace(spec_ws).runtime_dir()`；否则（无 spec_workspace 行，server-local 兜底）`SpecPathResolver(workspace.root_path).runtime_dir()`。去掉手写的 `strategy != "repo-native"` 分支（`for_spec_workspace` 已封装 mode 选择）。
  - `get_progress` 内 `resolver = SpecPathResolver(...)` 同样改为 `resolver = SpecPathResolver.for_spec_workspace(spec_ws) if spec_ws else SpecPathResolver(workspace.root_path)`，`db_path()` 自动按 mode 落到 `spec_root/.runtime/sillyspec.db`（platform-managed）或 `root_path/.sillyspec/.runtime/sillyspec.db`（server-local）。
- `knowledge/service.py`：抽取私有 helper（如 `_sillyspec_root(workspace)`）对齐 `scan_docs/service.py:86-95` 模式：先 `from app.modules.spec_workspace.service import SpecWorkspaceService` 查 `spec_ws`；`spec_ws.strategy == "platform-managed" and spec_ws.spec_root` → 返回 `Path(spec_ws.spec_root)`；否则返回 `Path(workspace.root_path) / ".sillyspec"`。`list_knowledge` / `get_knowledge` / `list_quicklog` / `get_quicklog` 四处把 `root = Path(workspace.root_path) / ".sillyspec"` 改为调 `_sillyspec_root(workspace)`。
- `knowledge/parser.py`：`parse_knowledge` / `parse_quicklog` 当前传 `sillyspec_root / "knowledge"` / `sillyspec_root / "quicklog"` 作为目录、`sillyspec_root` 作为 traversal 边界 + `rel_prefix=".sillyspec/..."`。platform-managed 时根已扁平，目录拼接天然成立；但 `rel_prefix` 含 `.sillyspec` 段在 platform-managed 下与扁平布局不一致——改为接收 mode（或由 service 传 `rel_prefix`），platform-managed 用 `"knowledge"` / `"quicklog"`，否则保持 `".sillyspec/knowledge"` / `".sillyspec/quicklog"`。traversal 边界 `sillyspec_root` 不变（路径安全校验保留）。

## acceptance

- daemon-client workspace（`strategy=platform-managed`）scan 终态回灌后：`GET /workspaces/<id>/knowledge` 返回非空条目（不再因读不可达 root_path 返回空）；`GET /workspaces/<id>/knowledge/<filename>` 返回内容；quicklog 同理。
- daemon-client workspace：`GET /workspaces/<id>/runtime` 返回 `RuntimeProgress`（读 `spec_root/.runtime/sillyspec.db`，非空时反映进度）。
- server-local / repo-native workspace 回归：knowledge/runtime 行为与改造前一致（走 `root_path/.sillyspec/...`，rel_prefix 带 `.sillyspec`）。
- platform-managed 下 `ParsedEntry.path` 形如 `knowledge/xxx.md`（无 `.sillyspec` 前缀），server-local 保持 `.sillyspec/knowledge/xxx.md`。

## verify

- `cd backend && uv run pytest tests/ -k "runtime or knowledge or Knowledge or Runtime" -v`
- `cd backend && uv run pytest tests/ -k "spec_paths or SpecPathResolver" -v`（依赖 task-01 工厂的单测，回归守护）
- `cd backend && uv run ruff check app/modules/runtime/service.py app/modules/knowledge/service.py app/modules/knowledge/parser.py`
- `cd backend && uv run mypy app/modules/runtime/service.py app/modules/knowledge/service.py app/modules/knowledge/parser.py`

## constraints

- 路径 traversal 校验保留：`parse_md_directory` 的 `resolved.startswith(sillyspec_root.resolve())` 边界不变，仅 mode 影响 `rel_prefix`。
- 不改 knowledge 数据模型（`KnowledgeEntry` / `QuicklogEntry` schema 不动）、不改 `KnowledgeParser` 的 `ParsedEntry` 字段。
- `spec_workspace.service` 的 import 保持函数内延迟导入（对齐 `scan_docs/service.py:88` 模式），避免循环依赖。
- platform-managed 判定统一走 `spec_ws.strategy == "platform-managed"`，与 task-01 工厂口径一致；不引入额外 strategy 字符串分支。
- server-local / repo-native 零回归（FR-01 / SC3 守护）：默认路径仍带 `.sillyspec` 包裹。
- 兼容 Windows / Linux / macOS（纯 `pathlib.Path` 拼接，无平台分支）。
