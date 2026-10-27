---
author: sillyspec-fr-index
created_at: 2026-10-27T07:24:47.212Z
---

# FR 索引 — task

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/task.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-task-001 TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖
变更：2026-10-27-task-parser-md-check-fallback
状态：active
摘要：主路径；优先级
全文：.sillyspec/changes/archive/2026-10-27-task-parser-md-check-fallback/requirements.md#FR-01
最近确认：4816e3611244550fc2e97be15e7049d7dbf10665

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-parser-md-check-fallback:flow:测试绑定FR-01
  tests: backend/app/modules/task/tests/test_parser.py「test_card_explicit_status_wins」 | backend/app/modules/task/tests/test_parser.py「test_card_no_frontmatter_md_checked_done」 | backend/app/modules/task/tests/test_parser.py「test_card_no_status_md_checked_done」 | backend/app/modules/task/tests/test_parser.py「test_card_no_status_md_unchecked_draft」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-parser-md-check-fallback
  status: active

## FR-task-002 tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）
变更：2026-10-27-task-parser-md-check-fallback
状态：active
摘要：thin 单源零回归
全文：.sillyspec/changes/archive/2026-10-27-task-parser-md-check-fallback/requirements.md#FR-02
最近确认：4816e3611244550fc2e97be15e7049d7dbf10665

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-parser-md-check-fallback:flow:测试绑定FR-02
  tests: backend/app/modules/task/tests/test_parser.py「test_parse_three_tasks」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-parser-md-check-fallback
  status: active

## FR-task-003 backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft
变更：2026-10-27-task-parser-md-check-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-task-parser-md-check-fallback/requirements.md#FR-03
最近确认：4816e3611244550fc2e97be15e7049d7dbf10665

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-parser-md-check-fallback:flow:测试绑定FR-03
  tests: backend/app/modules/task/tests/test_parser.py「TestMdCheckFallback（五用例）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-parser-md-check-fallback
  status: active

## FR-task-004 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净
变更：2026-10-27-task-parser-md-check-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-27-task-parser-md-check-fallback/requirements.md#FR-04
最近确认：4816e3611244550fc2e97be15e7049d7dbf10665
