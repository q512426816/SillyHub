---
author: flow-machine-draft
created_at: 2026-10-22T08:42:05.082Z
---
# 设计记录（Design Record）— 2026-10-22-merge-regression-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两类残留逐笔最小修：① daemon/grants 测试的 selected-metadata 建表闭包按姊妹范式（workspace/member_runtimes/tests/conftest.py）补全——users 新增默认档案外键后，闭包必须纳入 agent_profiles 及其 FK 目标 workspaces/llm_providers/tool_policies，并补相应模型 import 保证注册；② test_init_claim_tokens 两降级用例的 structlog 警告断言由只看 stdout 改为 captured.out+err 双流合并——断言意图（事件名+原因枚举在渲染输出中）不变，只解除对具体流的脆弱假设。选最小改动的理由：生产逻辑已被证明正确（Captured stderr 中事件完整、grants 建表失败发生在测试 fixture 组装期），债的载体是测试夹具与断言面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 仅测试面：`app/modules/daemon/grants/tests/conftest.py`（needed 元组扩项 + 模型 import）与 `app/modules/daemon/lease/tests/test_init_claim_tokens.py`（两处断言载体）；
- 生产源码零改动，无端点/签名/行为变化；不需要重新部署（镜像内测试不参与运行）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——测试夹具/断言，无事件流。
2. 并发写：不适用——夹具 metadata 为进程内静态构造，无共享写。
3. 切换/生命周期：边缘点已处理——日志渲染流随全局 structlog 配置时机变化（全量 vs 隔离），双流合并判定覆盖两种生命周期。
4. 作用域：不适用——metadata 为每测试独立 MetaData 实例，无跨用例串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：扩容 metadata 闭包引入 users↔agent_profiles、workspaces↔agent_profiles 环——姊妹 conftest 已实证同形态可建表（SQLite 内存库 + to_metadata + create_all），本变更照抄该范式并在隔离复跑中验证 62 passed。放弃方案：给 agent_profiles 建仅含 id 列的 stub 表——放弃理由：stub 与真实表结构漂移会掩盖后续 FK 问题，纳入真实表闭包与姊妹模块一致、可维护。
