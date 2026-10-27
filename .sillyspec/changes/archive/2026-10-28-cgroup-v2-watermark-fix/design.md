---
author: flow-machine-draft
created_at: 2026-10-27T23:33:32.445Z
---
# 设计记录（Design Record）— 2026-10-28-cgroup-v2-watermark-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

drift_probe.py 的 `_CGROUP_LIMIT_FILES` 首候选写成了 v2 不存在的 `/sys/fs/cgroup/memory.limit`（v2 实为 `memory.max`），导致纯 v2 宿主上 current 可读、limit 恒 None，水位告警静默失效。修法是一行候选表置换：首候选改 `/sys/fs/cgroup/memory.max`，v1 `memory/memory.limit_in_bytes` 兜底保留；docstring 的 v2 文件名同步修正。`max` 字面量（无限制）不加新分支——`_read_first_existing` 的 `int()` 已抛 ValueError 被捕获，按「该候选不可用」落回 v1 兜底，v1 也无则 None → 与无 cgroup 环境同路静默跳过，语义正确（无限制即无水位可言），仅在候选表旁注释说明。测试新增独立文件，monkeypatch 模块常量为 tmp_path 文件、monkeypatch 模块 log 符号为 MagicMock 断言事件（仓内既有结论：structlog PrintLoggerFactory 直写 stderr，caplog 抓不到，见 test_session_readiness.py:336-342 惯例）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外签名变化：`log_memory_watermark()` / `check_drift_once()` / `drift_probe_loop()` 签名与返回语义不变；日志事件名与字段不变。唯一变化是模块常量 `_CGROUP_LIMIT_FILES` 的候选内容与 docstring 文字。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

current 与 limit 两次读之间存在时间差，比例可能瞬时不精确；该值仅进观测日志、不驱动任何控制动作，误差可接受（既有属性，非本变更引入）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

/sys 文件由内核提供、本代码只读；探针循环是单 asyncio task，模块内唯一可变状态是 `_watermark_env_missing_logged` 一次性 debug 旗标，竞态下最坏多打一条 debug，无害。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

每轮纯读+落日志、无持久状态；单轮异常由 drift_probe_loop 既有 except 吞掉不崩循环，生命周期行为不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

/sys 路径是宿主全局只读面，多实例各自独立探测互不串台；monkeypatch 常量只在测试进程内生效。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：混合挂载形态（v2 无限制 `max` 且 v1 文件同时在）会回退用 v1 limit 算水位——语义上仍是「存在某限制」，方向安全，且该形态实际不存在于统一层级宿主。试过放弃的方案：为 `max` 字面量加显式分支返回哨兵值——放弃，因为现有 ValueError 落回路径已得到正确终态（None 跳过），加分支只增加状态面。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | backend/app/modules/spec_workspace/drift_probe.py | _CGROUP_LIMIT_FILES 首候选改 memory.max、docstring 同步、无限制语义注释 |
| A | backend/app/modules/spec_workspace/tests/test_memory_watermark.py | 四形态用例（monkeypatch 注入 + log spy 断言） |
