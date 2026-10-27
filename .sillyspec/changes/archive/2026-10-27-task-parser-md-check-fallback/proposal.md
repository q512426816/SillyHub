---
author: flow-machine-draft
created_at: 2026-10-27T07:04:27.238Z
---
# 提案书（Proposal）— 2026-10-27-task-parser-md-check-fallback

## 动机

任务原话转写：修 Task parser 厚档变更任务进度恒 0/N bug：tasks.md 勾选被「卡片优先」规则整行跳过（同 key），而 TaskCard frontmatter 无 status 键恒 draft，平台 Task 表/悬浮框 execute 任务计数永远 0/N（2026-10-28-bg-task-status-report 实证：tasks.md 7/7 全勾，parser 输出全 draft）。

动机：会话页面 execute 任务进度与变更中心任务列表对厚档变更完全失真，agent 实际完成但平台显示 0 进度。

成功标准：
- TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖
- tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）
- backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft
- 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖
2. tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）
3. backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft
4. 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净

## 成功标准（可验证）

1. TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖
2. tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）
3. backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft
4. 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净
