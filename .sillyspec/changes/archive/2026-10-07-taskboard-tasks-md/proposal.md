---
author: flow-machine-draft
created_at: 2026-10-07T14:07:18.862Z
---
# 提案书（Proposal）— 2026-10-07-taskboard-tasks-md

## 动机

任务原话转写：平台任务板只解析厚档任务卡（tasks/task-*.md），thin 变更的 tasks.md 注册表行（- [ ]/- [x] task-NN: 描述）不进任务板——parser docstring 声称『Also reads tasks.md…frontmatter takes precedence』但实现从未兑现。补齐：任务板/看板对 thin 变更也有任务行。

成功标准：
- TaskParser.parse_tasks 额外解析 change 目录下 tasks.md 的任务行（宽容行形态：缩进/- 与 * bullet/( |x|X) 勾选态），勾选→done、未勾→draft，title=冒号后描述（截 500）
- 同名 task_key 卡片优先（厚档富信息不被注册表行覆盖，模块 docstring 既有声明兑现）；仅 tasks.md 独有的 key 追加为任务行
- parser 单测 + 同步链 e2e（thin tasks.md 增量同步 → 任务表出现行）双覆盖，task/spec_workspace 模块回归绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. TaskParser.parse_tasks 额外解析 change 目录下 tasks.md 的任务行（宽容行形态：缩进/- 与 * bullet/( |x|X) 勾选态），勾选→done、未勾→draft，title=冒号后描述（截 500）
2. 同名 task_key 卡片优先（厚档富信息不被注册表行覆盖，模块 docstring 既有声明兑现）；仅 tasks.md 独有的 key 追加为任务行
3. parser 单测 + 同步链 e2e（thin tasks.md 增量同步 → 任务表出现行）双覆盖，task/spec_workspace 模块回归绿

## 成功标准（可验证）

1. TaskParser.parse_tasks 额外解析 change 目录下 tasks.md 的任务行（宽容行形态：缩进/- 与 * bullet/( |x|X) 勾选态），勾选→done、未勾→draft，title=冒号后描述（截 500）
2. 同名 task_key 卡片优先（厚档富信息不被注册表行覆盖，模块 docstring 既有声明兑现）；仅 tasks.md 独有的 key 追加为任务行
3. parser 单测 + 同步链 e2e（thin tasks.md 增量同步 → 任务表出现行）双覆盖，task/spec_workspace 模块回归绿
