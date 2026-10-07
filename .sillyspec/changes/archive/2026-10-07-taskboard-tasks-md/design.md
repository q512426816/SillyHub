---
author: flow-machine-draft
created_at: 2026-10-07T14:07:18.862Z
---
# 设计记录（Design Record）— 2026-10-07-taskboard-tasks-md

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单点扩展 `task/parser.py`：`parse_tasks` 在卡片循环后追加 `tasks.md` 注册表行解析（行级正则 `_TASKS_MD_LINE_RE`——宽容形态与 CLI 侧 task-tick/change.timeline 判集同族），映射勾选态→status、冒号后文本→title（截 500 对齐列宽）；卡片优先以 seen_keys 集天然实现（注册表行仅补未见 key）。这兑现了 parser docstring 的既有声明（`Also reads tasks.md…frontmatter takes precedence`），且连动链（spec-sync→TaskService.reparse）上一变更已建好——本变更只让 parser 能产出 thin 行。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`TaskParser.parse_tasks` 签名不变，产出集扩大（含 tasks.md 注册表行）；无端点/schema 变化；任务板/看板对 thin 变更从空变有任务行。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：纯文件解析，行序即文档序，无事件依赖。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用新增面：解析无副作用；任务行落库走既有 reparse upsert（task_key 幂等）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用：tasks.md 半写态由行级正则天然容忍（坏行跳过），下一轮幂等 reparse 收敛。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：解析按 change_rel_path 限定，行落库经既有 change_id 归属。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：thin 行 status 只有 draft/done 两态（看板中段列空）——勾选态是 tasks.md 唯一信号，不造无据状态；后续要更细可由 status 映射规则扩展。试过放弃：把注册表行也建成卡片式富结构（priority/owner 从行文猜测）——无据造数；放弃，只取确定字段。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/task/parser.py | parse_tasks 追加 tasks.md 注册表行解析（卡片优先） |
| 修改 | backend/app/modules/task/tests/test_parser.py | TestTasksMdRegistryLines 四用例 |
| 修改 | backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py | thin e2e 用例（同步→建行→改写跟随） |
