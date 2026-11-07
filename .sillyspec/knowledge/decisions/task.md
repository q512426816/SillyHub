# 决策知识 — task

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-task-001@v1 2026-10-27-task-parser-md-check-fallback——改 backend/app/modules/task/parser.py 单文件：`parse_tasks` 预读 tasks.md 建 key→勾选映射（`m
状态：implemented
变更：2026-10-27-task-parser-md-check-fallback
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-27-task-parser-md-check-fallback/design.md
文件：backend/app/modules/task/parser.py, backend/app/modules/task/tests/test_parser.py
最近确认：未记录
理由：改 backend/app/modules/task/parser.py 单文件：`parse_tasks` 预读 tasks.md 建 key→勾选映射（`md_checked`），卡片解析（`_parse_task_file` 新增 `md_checked: bool | None = None` 参数）在 frontmatter **未显式写 status 键**时用该映射回退（[x]→done、[ ]→draft、无行→draft）；显式 status 仍优先（靠键存在性区分「未写」与「写了 draft」）。选此方案因根因实证明确（2026-10-28-bg-task-status-report：tasks.md 7/7 全勾解析全 draft——CLI 勾选协议活在 tasks.md checkbox，TaskCard 模板无 status 键，旧「卡片优先跳过注册表行」让勾选态无处进表），平台侧单点修复即通，不动 CLI/前端。注册表行循环仍只补卡片未覆盖 key（thin 单源零回归）。
