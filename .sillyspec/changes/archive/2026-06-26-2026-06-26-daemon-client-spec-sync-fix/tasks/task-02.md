---
id: task-02
title: scan_docs parser+service 按 mode 解析（去 .sillyspec 硬编码）
author: qinyi
created_at: 2026-06-26 11:36:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/scan_docs/parser.py
  - backend/app/modules/scan_docs/service.py
---

# task-02 — scan_docs parser+service 按 mode 解析

## goal

消除 `parser.py:105` / `parser.py:189` 的 `sillyspec_root / ".sillyspec" / "docs"` 硬编码，使 scan_docs reader 在 `platform-managed` workspace 下能解析 daemon 回灌的**扁平** `docs/` 布局（spec_root 即 .sillyspec 内容根），同时保持 server-local / repo-native 的 `.sillyspec/` 包裹语义零回归。覆盖 FR-01，承接 task-01 的 `SpecPathResolver` mode 能力。

## implementation

1. **parser.py**
   - `parse_docs_tree(self, sillyspec_root: Path, *, platform_managed: bool = False)`：`platform_managed=True` 时 `docs_dir = sillyspec_root / "docs"`；否则保持 `sillyspec_root / ".sillyspec" / "docs"`。`DOCS_DIR_MISSING` warning 文案按 mode 调整。
   - `parse_component(self, sillyspec_root: Path, component_key: str, *, platform_managed: bool = False)`：`platform_managed=True` 时 `scan_dir = sillyspec_root / "docs" / component_key / "scan"`；否则保持 `sillyspec_root / ".sillyspec" / "docs" / component_key / "scan"`。
   - 行内遍历/读文件/`doc_type` 识别/`STANDARD_DOC_TYPES` 占位/路径遍历 guard 全部保留不变。
2. **service.py `reparse`**
   - 现有第 86-95 行已在 platform-managed 时把 `sillyspec_root = Path(spec_ws.spec_root)`，但未把 mode 下传给 parser。改为按 `spec_ws.strategy` 推 `platform_managed = (spec_ws.strategy == "platform-managed")`，传给 `parse_docs_tree` / `parse_component`。
   - 优先用 task-01 的 `SpecPathResolver.for_spec_workspace(spec_ws)` 取 `platform_managed`（避免重复 strategy 判断）；若 task-01 API 尚未稳定，退化为内联 `strategy == "platform-managed"` 判断（二者等价）。
   - `try/except` 兜底（spec_ws 不存在/无 strategy）保持 `platform_managed=False` 默认。

## acceptance

- platform-managed workspace（spec_ws.spec_root 指向 daemon 回灌的扁平根）`reparse` 后：`stats["parsed"] > 0`，`scan_documents` 表落库行数 = daemon 本地 `docs/<component>/scan/*.md` 数量。
- repo-native / server-local workspace `reparse` 行为零变化（`platform_managed=False`，docs_dir 仍含 `.sillyspec`）。
- `parse_component` 对缺失 `scan/` 目录仍返回 `STANDARD_DOC_TYPES` 占位（exists=False）+ `SCAN_DIR_MISSING` warning。

## verify

```
cd backend && uv run pytest app/modules/scan_docs -q
```
补充/补充用例（如无则新增）：parser 双 mode（扁平 vs 包裹）docs_dir/scan_dir 解析单测；service `reparse` platform-managed + repo-native 双路径测；server-local 既有 scan_docs 集成测回归。

## constraints

- 不改 `parse_component` 的文件读取/doc_type 映射/占位行为。
- 不破坏既有 scan doc type 识别（`STANDARD_DOC_TYPES` + yaml stem）。
- `platform_managed` 默认 False，向后兼容；不引入 spec_ws 必须存在的硬依赖（try/except 兜底保留）。
- 不触碰 allowed_paths 之外的文件（validator/runtime/knowledge 由 task-03/04 处理）。
