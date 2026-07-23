---
id: task-10
title: scanner/parser 测试 fixture 扁平化（test_scanner.py + test_parser.py 约 14 处 fixture + 断言 + 静态 fixture 目录）
title_zh: scanner/parser 测试 fixture 扁平化
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: [task-05, task-06]
blocks: [task-11]
requirement_ids: [FR-3.4]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/tests/test_scanner.py
  - backend/app/modules/workspace/tests/test_parser.py
---

# task-10 — scanner/parser 测试 fixture 扁平化

## 目标

把 `test_scanner.py` + `test_parser.py` 的 fixture 从包裹布局（`tmp_path/.sillyspec/...`）改成扁平根（`tmp_path` 直接放 `projects/` `changes/` `docs/` `local.yaml` `.runtime/`），并同步对齐 task-05 后的新 `is_sillyspec` 判定（从「`.sillyspec` 目录存在」翻转为「`projects/` 或 `changes/` 存在」）与 task-06 的扁平 `projects_subdir="projects"`，使两套测试在扁平语义下全绿。覆盖 FR-3.4 / D-005@v1 / AC-7。

## 实现要点

文件（只改测试 + 静态 fixture，不动源码）：
- `backend/app/modules/workspace/tests/test_scanner.py`
- `backend/app/modules/workspace/tests/test_parser.py`
- `backend/app/modules/workspace/tests/fixtures/minimal-sillyspec/`（静态目录，去掉 `.sillyspec/` 一层）

1. **test_scanner.py**（`base = tmp_path / ".sillyspec"` 共 7 处：`:41-42` `:50` `:74-76` `:86` `:112` `:136` `:155`）：
   - `base = tmp_path / ".sillyspec"` → `base = tmp_path`（直接当扁平根），后续 `base / "projects"` `base / "changes"/"change"` 等拼接不变。
   - `test_missing_projects_dir`（`:41-42`）：扁平根下要有 `changes/`（让 `is_sillyspec=True`）但无 `projects/` → 改成 `tmp_path / "changes" / "change"` + `tmp_path / "changes" / "archive"`。
   - `test_missing_sillyspec`（`:34-37`）：空 `tmp_path` 在扁平判定下 `is_sillyspec=False` + `WARN_NO_SILLYSPEC`（task-05 保留该 warning 分支），断言不变。
   - `test_scan_result_parser_fields_default_empty`（`:127`）：`ScanResult(sillyspec_path="/tmp/.sillyspec", ...)` 是构造直传字面量，与 scan 无关，断言不变（仅传参字面量可选去前缀，非必须）。
   - `test_minimal_fixture_is_recognised`（`:20-31`）+ 静态 fixture：把 `fixtures/minimal-sillyspec/.sillyspec/{projects,changes,local.yaml}` 提升一层到 `fixtures/minimal-sillyspec/{projects,changes,local.yaml}`，断言不变（扁平后仍 `has_projects_dir/has_changes_dir/has_local_yaml=True`、`has_docs_dir=False`）。
2. **test_parser.py**（`projects = tmp_path / ".sillyspec" / "projects"` 共约 11 处：`:27` `:100` `:121-122` `:139-141` `:155` `:174` `:204` `:221-223` `:241` `:251` `:289` `:303-304`）：
   - 全部 `tmp_path / ".sillyspec" / "projects"` → `tmp_path / "projects"`（对齐 task-06 默认值扁平）。
   - `test_normal_parse`（`:86`）：`source_yaml_path` 断言由 `".sillyspec/projects/backend.yaml"` 改为 `"projects/backend.yaml"`。
   - `test_missing_projects_dir`（`:190-196`）：空 `tmp_path` 仍触发 `missing_projects_dir` warning，断言不变。
   - `test_empty_projects_dir`（`:249-252`）：`(tmp_path / ".sillyspec" / "projects").mkdir(...)` → `(tmp_path / "projects").mkdir(...)`。
3. 中文/空格路径（`test_handles_chinese_and_spaces` `:72-78`）：`nested / ".sillyspec" / ...` → 直接 `nested / "projects"`、`nested / "changes"/...`。

## 验收标准

- 扁平 fixture 下 `test_scanner.py` 全绿：`is_sillyspec` 在有 `projects/` 或 `changes/` 时为 True、空目录为 False；`WARN_NO_SILLYSPEC` 仅空目录触发；counts / parser 字段填充正确。
- 扁平 fixture 下 `test_parser.py` 全绿：`projects/*.yaml` 正确解析为 `workspaces`，`source_yaml_path` 为扁平相对路径，无 `.sillyspec/` 前缀。
- 静态 fixture 目录 `minimal-sillyspec/` 不再含 `.sillyspec/` 一层，`test_minimal_fixture_is_recognised` 断言全过。

## verify

```bash
cd backend && uv run pytest -q --no-cov app/modules/workspace/tests/
```

（覆盖 test_scanner.py + test_parser.py + 模块内其他测试。两文件均位于模块内 `app/modules/workspace/tests/`，非 `backend/tests/modules/workspace/`。）

## 约束

- 只改 fixture + 断言对齐扁平语义，不改测试覆盖的业务逻辑（counts/warning/relation/yaml_error/missing_id/duplicate_id 等场景全保留）。
- 不改 `scanner.py`（task-05 负责）、`parser.py`（task-06 负责）、`post_scan_validator.py`（task-04 负责）。
- 不引入 `tmp_path / ".sillyspec"` 新包裹（扁平为唯一布局，design §5 Phase 3 已明确无回退）。
- 不改 `ScanResult` / `ParsedWorkspace` 等数据结构（design §8 无 schema 变更）。
