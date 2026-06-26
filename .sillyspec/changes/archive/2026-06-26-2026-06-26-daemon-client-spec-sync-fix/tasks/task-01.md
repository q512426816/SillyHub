---
id: task-01
title: "SpecPathResolver 增 platform_managed mode + for_spec_workspace 工厂"
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04, task-05]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/core/spec_paths.py
---

# task-01 — SpecPathResolver 增 platform_managed mode + for_spec_workspace 工厂

## goal

为 `SpecPathResolver` 引入 `platform_managed` 模式与 `for_spec_workspace(spec_ws)` 工厂，使 platform-managed workspace 的 spec_root（扁平布局，无 `.sillyspec` 包裹）与 repo-native/server-local（包裹布局）共用一套路径解析。

## implementation

- 在 `SpecPathResolver.__init__(self, workspace_root, *, platform_managed=False)` 增加仅关键字参数 `platform_managed: bool = False`，存为 `self.platform_managed`。
- 改造 `changes_root`：`platform_managed=True` 返回 `self.root / "changes"`，否则保持 `self.root / ".sillyspec" / "changes"`。
- 改造 `runtime_dir`：`platform_managed=True` 返回 `self.root / ".runtime"`，否则保持 `self.root / ".sillyspec" / ".runtime"`（`db_path` / `gate_status_path` 自动跟随，无需单独改）。
- 改造 `docs_dir(project)`：`platform_managed=True` 返回 `self.root / "docs" / project`，否则保持 `self.root / ".sillyspec" / "docs" / project`（`scan_dir` / `modules_dir` 自动跟随）。
- 新增 classmethod `for_spec_workspace(cls, spec_ws)`：返回 `cls(spec_ws.spec_root, platform_managed=(spec_ws.strategy == "platform-managed"))`。
- 保持 `change_dir` / `archive_dir` / `legacy_change_dir` 走 `changes_root`（自动适配 mode，无需单独分支）。

## acceptance

- `SpecPathResolver(root, platform_managed=True)` 的 `changes_root` / `runtime_dir` / `db_path` / `gate_status_path` / `docs_dir(p)` / `scan_dir(p)` / `modules_dir(p)` 返回路径均不含 `.sillyspec` 段（直接挂在 root 下）。
- `SpecPathResolver(root)`（默认 `platform_managed=False`）所有方法行为与改造前逐字节一致，路径仍带 `.sillyspec` 包裹（server-local / repo-native 零回归）。
- `SpecPathResolver.for_spec_workspace(spec_ws)` 在 `spec_ws.strategy == "platform-managed"` 时构造 platform-managed resolver，其余 strategy（`repo-native` / `server-local`）构造默认 resolver。
- `platform_managed` 为仅关键字参数，位置调用 `SpecPathResolver(root)` 不报错。

## verify

- `cd backend && uv run pytest tests/ -k "spec_paths or SpecPathResolver" -v`
- `cd backend && uv run ruff check app/core/spec_paths.py`
- `cd backend && uv run mypy app/core/spec_paths.py`

## constraints

- `platform_managed` 默认 `False`，确保 server-local / repo-native workspace 路径行为零回归（FR-02 / SC3 守护）。
- 仅修改 `backend/app/core/spec_paths.py`，不触碰任何 reader（scan_docs / runtime / knowledge / validator 等），reader 适配在 task-02~task-05。
- 不改 sillyspec CLI 目录布局语义，不改 daemon 本地扁平存储路径。
- `for_spec_workspace` 通过字符串比较 `spec_ws.strategy == "platform-managed"` 选 mode，不引入对 SpecWorkspace ORM 的硬依赖（鸭子类型，便于单测构造 stub）。
- 兼容 Windows / Linux / macOS（纯 `pathlib.Path` 拼接，无平台分支）。
