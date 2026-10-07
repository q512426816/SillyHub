---
author: flow-machine-draft
created_at: 2026-10-07T14:07:18.862Z
---
# 需求规格（Requirements）— 2026-10-07-taskboard-tasks-md

## 功能需求

### FR-01: 任务板解析 tasks.md 注册表行

必须：`TaskParser.parse_tasks` 在任务卡（`tasks/task-*.md`，既有行为不变）之外解析 change 目录下 `tasks.md` 的注册表行 `- [ ]/- [x] task-NN: 描述`（宽容形态：缩进、`-`/`*` bullet、`( |x|X)` 勾选态）——勾选→done、未勾→draft、title=冒号后描述截 500；同名 task_key 卡片优先（厚档 --with-tasks 双源同 key 不重复不覆盖），仅注册表独有 key 追加为任务行；旧表格形态与普通文本行不误匹配。

#### 场景：thin 变更进任务板

Given thin 变更只有 tasks.md（两行：一勾一未勾），无任务卡目录
When 增量同步落盘 tasks.md 并连动 reparse
Then 任务板出现 task-01(done)/task-02(draft) 两行；改写勾选后跟随为全 done

### FR-02: 测试双覆盖

必须：parser 单测覆盖 thin-only/卡片优先/宽容形态/表格零误匹配；同步链 e2e 覆盖 tasks.md 增量同步→任务表建行→改写跟随；task/spec_workspace/change 模块回归绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: backend/app/modules/task/tests/test_parser.py「TestTasksMdRegistryLines.test_thin_tasks_md_only」
FR-02: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_thin_tasks_md_registry_reaches_task_board」
