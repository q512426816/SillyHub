---
author: flow-machine-draft
created_at: 2026-10-07T13:43:18.668Z
---
# 设计记录（Design Record）— 2026-10-07-spec-sync-task-reparse

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单点接线：`spec_workspace/service.py _run_reparse_once` 在既有 ChangeService.reparse 之后（同一后台会话内）按 scope 查变更行（workspace + change_key in scope；archive_hit 全量；location!='deleted'）逐行调 TaskService.reparse。选此位置因为它已是增量落盘后唯一的自动 reparse 执行体（inline/后台 runner 共用、single-flight 防抖调度器内），连动天然继承节流与合并语义，无需新调度面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`_run_reparse_once` 内部新增连动副作用（私有方法，签名不变）；reparse_triggered 日志多 task_stats 键。无端点/schema/文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：连动在同一 reparse 执行体内同步串行，无独立事件序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

复用既有 single-flight/节流窗（ql-20260909-021 调度器）——同 workspace 并发触发合并为一轮；TaskService.reparse 幂等（task_key upsert），双跑收敛。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

连动在独立会话事务内，失败仅告警不阻断；中断残留由下一轮幂等 reparse 收敛。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：查询按 workspace_id + scope 限定；TaskService.reparse 按行 id 定向。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：archive_hit 全量路径下对大 workspace 逐变更 reparse 的耗时——已在后台任务里（不阻塞同步响应）且全量路径仅归档移动触发（罕见）；后续可按 location 过滤收窄。试过放弃：在 apply_ops 落盘循环里逐 op 触发——绕过调度器会复活 ql-20260909-021 修掉的风暴；放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/spec_workspace/service.py | _run_reparse_once 连动 TaskService.reparse（best-effort + task_stats 日志） |
| 新增 | backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py | 连动跟随 + 失败不阻断两用例 |
