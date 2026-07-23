---
id: task-04
title: "PostScanValidator 扁平修复（post_scan_validator.py:156 去 .sillyspec 前缀）"
title_zh: "PostScanValidator 扁平修复"
author: qinyi
created_at: 2026-07-12 00:43:24
change: 2026-07-11-daemon-client-container-overreach
wave: 1
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-3.1]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/agent/post_scan_validator.py
---

# TaskCard — task-04

## 目标

修复 `PostScanValidator._check_output_paths` 在 daemon-client 平台托管模式下恒误报 `expected_docs_missing` 的 bug。daemon-client 下 `spec_root` 是扁平根（直接 `docs/`，无 `.sillyspec` 包裹），但 :156 硬编码了 `spec_root/.sillyspec/docs`，导致扫描校验对合法扁平布局恒失败。

## 实现要点

改 `backend/app/modules/agent/post_scan_validator.py:156` 一行：

```python
# 改前（:156）
expected_docs = spec_root / ".sillyspec" / "docs"
# 改后（扁平根，对齐 spec_paths.py:114-116 _spec_root() platform_managed 语义）
expected_docs = spec_root / "docs"
```

`:170` 的 `expected_docs.rglob("*")`、`:195` 的 `expected_docs.glob("*/scan")`、`:208-210` 的 `scan_dir.glob("*.md")`、`:221` 的 `scan_dir.relative_to(spec_root)` 全部基于 :156 的 `expected_docs` 变量，改 :156 后自动适配扁平布局，无需逐处修改（Design Grill G8 已确认）。server-local 已在 2026-07-10 变更移除，扁平为唯一布局，无需回退分支。

## 验收标准

- 扁平 fixture（`spec_root/docs/<project>/scan/{ARCHITECTURE,...,TESTING}.md`）下 `_check_output_paths` 返回空 error 列表，不报 `expected_docs_missing`。
- AC-6：扁平根 `spec_root` 下 PostScanValidator 不报 `expected_docs_missing`。

## verify

```bash
cd backend && uv run pytest -q --no-cov backend/app/modules/agent/tests/test_post_scan_validator.py
```

若现有 fixture 仍按 `.sillyspec/docs` 包裹布局构造，同步将 fixture 目录结构调整成扁平（`spec_root/docs/...` 而非 `spec_root/.sillyspec/docs/...`），与 scanner/parser 扁平化（task-05/06）保持一致。

## 约束

- 只改 `_check_output_paths`（`:149-228`）内的 :156 一行，不动同文件其他 `_check_*` 函数（`_check_log_patterns` / `_check_manifest_exists`）与 `_determine_status` 状态机。
- 不改 `runtime_root` 读取（`:238` manifest 检测路径正确，平台侧 runtime 不受扁平化影响）。
- 不改 `__init__` 签名 / `validate` / `_validate_daemon_client` 分支逻辑。
- 不引入 SpecPathResolver 依赖（`_check_output_paths` 是模块级自由函数，非 resolver 方法；直接用 `spec_root / "docs"` 最简）。
