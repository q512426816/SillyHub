---
id: task-05
title: WorkspaceScanner 扁平重写（scanner.py:78-130 scan() 语义翻转 + 顶层常量）
title_zh: WorkspaceScanner 扁平重写
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-3.2]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/scanner.py
---

# task-05 — WorkspaceScanner 扁平重写

## 目标

把 `WorkspaceScanner.scan()` 的语义从"在 `root/.sillyspec/` 包裹下找内容"翻转为"`root` 本身就是扁平内容根"（daemon-client 平台托管模式，扁平布局直接是 `docs/`、`changes/`、`.runtime/`），使 `/scan` 与 `rescan` 在 `spec_ws.spec_root` 下恢复正确判定（不再恒报 `WARN_NO_SILLYSPEC`）。覆盖 FR-3.2 / D-005@v1。

## 实现要点

文件：`backend/app/modules/workspace/scanner.py`（只改这一个文件）。

1. `scan()`（`:78-130`）语义翻转：
   - `:80` `sillyspec = root / ".sillyspec"` → `sillyspec = root`（root 直接当内容根）。
   - `:87-89` 删掉 `if not sillyspec.is_dir(): WARN_NO_SILLYSPEC` 提前返回——扁平根存在性已由 `:79 _normalise` + 调用方 `_guard_path`（service.py:116）保证；`is_sillyspec` 改为按 `REQUIRED_TOP_LEVEL` 任一存在置真（见下）。
   - `:94/101/104/105/110/117/118/119` 各 `sillyspec / "..."` 路径名不变（扁平后语义自然正确），无需改路径拼接。
2. `is_sillyspec` 判定：扁平根下 `projects/` 或 `changes/` 任一存在即为真（对齐 `REQUIRED_TOP_LEVEL`），否则仍记 warning 但不提前返回。
3. `REQUIRED_TOP_LEVEL`（`:74`）/`OPTIONAL_TOP_LEVEL`（`:75`）常量名/取值保留（描述的是扁平根下的子项名，与包裹根下一致），仅注释/docstring 改为"扁平内容根"。
4. 调用方核实（不改）：
   - `service.py:112-117` `scan(root_path)` 经 `_rewrite_path` 透传，`/scan` 端点入参路径由前端/spec 决定。
   - `service.py:415-432` `rescan`：`scan_path = spec_ws.spec_root`（扁平根）→ `self.scan(scan_path)`，已是扁平根，无需改 service.py。
5. parser 集成块（`:121-128` `_WP().parse(root)`）保持原样不动——root 语义随翻转一并变为扁平根，parser 内部适配由 task-06 负责。

## 验收标准

- 扁平根 `spec_ws.spec_root`（直接含 `docs/`、`changes/`、`.runtime/`）下 `rescan` 不再报 `WARN_NO_SILLYSPEC`，`is_sillyspec=True`，`structure.has_changes_dir/has_projects_dir` 正确反映扁平目录。
- `WARN_MISSING_CHANGE_SUBDIR`/`WARN_MISSING_ARCHIVE_SUBDIR` 在扁平根下按 `changes/` 子目录缺失如实上报（行为不变）。

## verify

```
cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/test_scanner.py
```

（注：test_scanner.py 位于模块内 `app/modules/workspace/tests/`，非 `backend/tests/modules/workspace/`。fixture 扁平化由 task-10 负责，本任务跑现有用例确认 scan() 翻转后路径解析不崩。）

## 约束

- 不改 `parser.py`（`:108 projects_subdir` 由 task-06 负责）。
- 不改 `service.py` 调用方（`:112-117` / `:415-432` 已传扁平根 `spec_ws.spec_root`，路径正确）。
- 不改 `post_scan_validator.py`（task-04 负责）。
- 不改测试 fixture（task-10 负责）。
- `WARN_NO_SILLYSPEC` 常量（`:22`）保留导出名，避免破坏外部消费者；扁平布局下不再触发，但常量不删。
