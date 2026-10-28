---
author: flow-machine-draft
created_at: 2026-10-28T00:24:44.820Z
---
# 设计记录（Design Record）— 2026-10-28-reparse-trigger-tests-realign

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯测试对齐变更：60629d2bb 把 `_compute_reparse_scope` 改三元组并把归档 rename/delete 从全量改为 scoped+structural（D-004/D-007，OOM 治本：全量重扫是内存峰值主源），同笔新增 test_archive_scoped_reparse.py 锁新契约，但漏更新旧文件 test_incremental_reparse_trigger.py——8 个纯函数用例死于二元组解包、3 个端到端用例死于全量期望。修法是按新契约更新该文件：解包改三元组、rename/delete 期望改 `([<name>], False, True)`、sync 级两断言改 scoped 列表、`test_archive_full_reparse_still_deletes` 行为断言保留但命名/docstring 对齐真实机制（rename 双侧 name 均进 scope，活跃侧目录消失在 scoped 内删除——非全量）。模块 docstring 与分区注释同步。判定依据（排除实现回归）：60629d2bb docstring 落痕 D-004/D-007 决策、git log -S 锁定三元组签名唯此一引入、新契约测试全过、`git log` 证实旧文件自 595eb98cc 后未随语义更新。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无：不改任何 src 代码、不改被测契约（契约已由 60629d2bb 定型并由 test_archive_scoped_reparse.py 锁定）。变化仅是测试文件的断言/命名/docstring 对齐。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：纯测试断言更新，无运行时输入面；structural 通道的调度时序不在本文件断言面（由 test_archive_scoped_reparse.py 的双通道用例锁）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：测试文件无共享可变状态；各用例独立 tmp_path/db_session。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用：测试内 drain_reparse_workers 排空后台任务的既有模式不变。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：用例各自建独立 workspace/spec_root，模式沿用既有。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：若 60629d2bb 实为回归（测试才是对的），本变更会把回归固化为契约——已用四点证据排除（docstring 决策落痕、-S 唯一引入、新契约测试全过含归档翻转端到端、生产实证 OOM 治理动机）；且归档区 delete 的行删除能力由 scoped 覆盖（test_archive_scoped_reparse.py 锁定翻转），旧「全量」口径无独有能力。放弃方案：改实现回旧口径——直接违背 D-004/D-007 的 OOM 治理目标（全量重扫是内存峰值主源），否决。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| M | backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py | 八用例三元组化+新契约断言；两 sync 级断言改 scoped；命名/docstring 对齐；零 src 改动 |
