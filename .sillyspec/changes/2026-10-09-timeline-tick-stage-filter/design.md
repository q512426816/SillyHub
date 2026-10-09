---
author: flow-machine-draft
created_at: 2026-10-09T04:06:40.935Z
---
# 设计记录（Design Record）— 2026-10-09-timeline-tick-stage-filter

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`timeline.py` 的 `_TASK_DONE_RE` 从「checked N→M」子串匹配改为带可选 stage 前缀捕获的锚定匹配（`^(?:(\S+) · )?checked (\d+)→(\d+)`），`_infer_task_times` 循环内对捕获到的非 None 且非 `tasks` 的 stage 前缀 continue 跳过——语义与 CLI `inferFlipTimes`（sillyspec 仓 timeline.js:39 `e.stage && e.stage !== 'tasks'`）逐字对齐。根因背景：watcher 对任何文件的 `- [x]` 计数增加都发 task-done（detail 带「stage ·」前缀，DB 无独立 stage 列），design.md 自审清单 6 勾产生「design · checked 0→6」；Python 移植只做了计数子串匹配、丢了 CLI 的域白名单，误吃该事件把 10:00:48 赋给全部任务且游标跳到 6 致后续真实事件断裂。选前缀解析而非给 events 表加 stage 列：零 schema 变更、零回填，与推送端既有「stage 并入 detail」契约一致。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

模块内私有函数 `_infer_task_times`（timeline.py）行为变化：非 tasks 前缀的 task-done 事件不再参与游标衔接。API 响应结构（ChangeTimelineRead）零变化；无端点/schema/DTO 变更（api-types 无需 regen）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   事件按 ts 正序读（既有查询不变）；过滤只剔除域外事件，不改变游标衔接对顺序的既有依赖——乱序迟到（同步镜像延迟重放）下游标断裂语义照旧（from≠游标即停），无新假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   只读聚合（红线 D-004：events 表只读零 mutation），无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   无状态纯函数 + 单次请求内聚合；请求中断无残留状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   查询既有按 (workspace_id, change_name) 过滤不变；stage 前缀是事件自身属性，与工作区无关，不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：tasks 域内仍无法区分 tasks.md 与 tasks/task-NN.md 卡片的勾选计数（卡片段落勾选会以「tasks · checked N→M」进入推断）——这是 CLI 同款已知诚实面限制（事件只记计数不记任务 id），本次对齐 CLI 语义不扩大不收窄。试过放弃：①events 表加 stage 列 + watcher 推送带 stage——需 schema 迁移与历史回填，跨仓协同成本远超收益；②按 detail 前缀白名单枚举具体 stage 名（design/proposal…）——黑名单式枚举漏新 stage 域，白名单「仅 tasks 参与」与 CLI 语义一致更稳。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/timeline.py | `_TASK_DONE_RE` 前缀捕获 + `_infer_task_times` 非 tasks 前缀跳过（含 docstring 补注） |
| 修改 | backend/app/modules/change/tests/test_timeline.py | 新增实证形态回归用例 test_timeline_task_time_skips_non_tasks_stage |
| 新增 | docs/sillyspec/fourpiece-created-at-utc-born-anchor-offset.md | 同族工具缺陷记录（fourpiece-init 写 UTC 致 born 锚偏 8h，已修于 sillyspec 仓待发版） |
