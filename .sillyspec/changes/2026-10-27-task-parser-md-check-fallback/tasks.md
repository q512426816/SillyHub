---
author: flow-machine-draft
created_at: 2026-10-27T07:04:27.238Z
---
# 任务注册表（Tasks）— 2026-10-27-task-parser-md-check-fallback

- [x] task-01: TaskParser.parse_tasks 厚档双源回退：TaskCard frontmatter 未写 status 键时，status 回退取 tasks.md 同 key 勾选态（[x]→done、[ ]→draft、无行→draft）；frontmatter 显式 status 仍优先不被覆盖
- [x] task-02: tasks.md 注册表行仍只补卡片未覆盖的 key（既有行为不变，thin 单源场景零回归）
- [x] task-03: backend/app/modules/task/tests/test_parser.py 补四类用例：卡无 status+md 勾选→done / 卡无 status+md 未勾→draft / 卡显式 status 优先 / 卡无 status 且 md 无行→draft
- [x] task-04: 聚焦测试全绿（test_parser.py + task 模块），ruff/mypy 净
