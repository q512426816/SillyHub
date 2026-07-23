---
id: task-06
title: WorkspaceParser 扁平修复（parser.py:108 projects_subdir 改扁平）
title_zh: WorkspaceParser 扁平修复
author: qinyi
created_at: 2026-07-12 00:43:24
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-3.3]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/workspace/parser.py
---

## 目标

`WorkspaceParser.__init__`（`backend/app/modules/workspace/parser.py:108`）的 `projects_subdir` 默认值由 `.sillyspec/projects`（包裹布局）改为扁平 `projects`，使 parser 在 daemon-client 平台托管模式下能正确解析扁平 `spec_root` 下的 `projects/*.yaml`。对应 design §5 Phase 3、FR-3.3、D-005@v1、AC-7。

## 实现要点

1. `parser.py:108` 将 `projects_subdir: str = ".sillyspec/projects"` 默认值改为 `projects_subdir: str = "projects"`。
2. 同步更新 `__init__` docstring（:110-114）对默认值与「Relative path to the projects directory」的描述，去掉 `.sillyspec/` 前缀字样。
3. 确认 `parse()`（:117）拼接路径正确：`:129` `root = Path(workspace_root).resolve()` → `:130` `projects_dir = root / self._subdir`；改默认值后即解析扁平 `root/projects`，方法体其余逻辑（:131-233）不变。
4. 仅改默认值，不删 `projects_subdir` 形参（保留可注入性，scanner/task-05 不传参即拿扁平默认）。
5. 不引入 SpecPathResolver 依赖（parser 是纯文件系统函数，无 platform_managed 概念；扁平为唯一布局，design §5 Phase 3 已明确无回退）。

## 验收标准

- parser 默认解析扁平根：`<root>/projects/*.yaml` 正确解析为 `ParseResult.workspaces`（多个 YAML → 多个 `ParsedWorkspace`），`relations` 正确串联。
- 旧包裹布局 `<root>/.sillyspec/projects/` 下无 YAML 时，`parse()` 不报错（返回空 `workspaces` + 一条 `missing_projects_dir` warning，:131-140 行为不变）。
- `scanner.py:124` 的 `_WP().parse(root)`（task-05 把 `sillyspec = root` 后）用新默认值即可正确读取扁平 `projects/`，无需 scanner 显式传 `projects_subdir`。
- `component_catalog_service.py:88` 的 `WorkspaceParser()` 调用不传参，随默认值扁平化生效。

## verify

```bash
cd backend
# 模块内单测（test_parser.py 在 app/modules/workspace/tests/，非 backend/tests/）
uv run pytest -q --no-cov app/modules/workspace/tests/test_parser.py
# scanner 集成路径（task-05 改 scanner 后）+ 相关 workspace 测试
uv run pytest -q --no-cov app/modules/workspace/tests/ tests/modules/workspace/
```

> 注：`backend/tests/modules/workspace/test_parser.py` 不存在；parser 的真实单测在 `backend/app/modules/workspace/tests/test_parser.py`（模块内联测试）。其 fixture 当前建 `tmp_path / ".sillyspec" / "projects"`（包裹布局），本任务的扁平化验证需新建/改 fixture 到 `tmp_path / "projects"`，与 task-10（scanner fixture 扁平化）的 fixture 同源——如发现 test_parser.py fixture 扁平化改动量超出 task-06 范围，记入 task-10 一并处理，本任务保证 parser 源码默认值已扁平。

## 约束

- 不改 `WorkspaceScanner`（`scanner.py`）——scanner 语义翻转 + `REQUIRED_TOP_LEVEL`/`OPTIONAL_TOP_LEVEL` 常量调整由 task-05 负责；本任务只动 parser 默认值。
- 不改 `ParseResult` / `ParsedWorkspace` / `ParsedRelation` / `ParseIssue` 数据结构（design §8 无 schema 变更）。
- 不改 `parser.py` 解析逻辑（:131-350 的 YAML 解析、duplicate_id/missing_id/yaml_error/relation 校验等全部保留）。
- 不引入 `SpecPathResolver` 到 parser（parser 保持纯文件系统模块，无 DB/FastAPI 依赖，见 test_parser.py:317 的「must not import DB or FastAPI」断言）。
- `projects_subdir` 形参保留（可注入，不硬删），仅改默认值。
