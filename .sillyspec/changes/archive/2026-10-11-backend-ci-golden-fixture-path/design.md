---
author: flow-machine-draft
created_at: 2026-10-11T15:25:27.215Z
---
# 设计记录（Design Record）— 2026-10-11-backend-ci-golden-fixture-path

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

backend parity 测试（app/modules/daemon/tests/test_run_sync_golden_parity.py，docstring 自载）直接消费 `sillyhub-daemon/tests/fixtures/claude-sdk-messages/golden-session*.json` 三件套，但 backend-ci.yml 触发面只看 `backend/**`——daemon 侧 fixture 变更不会触发 backend-ci，parity 回归只剩人肉本地跑兜底（2026-10-11-daemon-masked-test-fix 独立评审 P3 揭示的 CI 盲区）。修法：push/pull_request 两处 paths 各补 `sillyhub-daemon/tests/fixtures/**` 窄路径——只覆盖被跨端消费的 fixtures 目录，不放大到整个 sillyhub-daemon/**（daemon 有自己的 CI，宽路径会让 daemon 任意改动都白跑 20 分钟 backend 全量）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无生产接口变化。仅 `.github/workflows/backend-ci.yml` 的 CI 触发面扩展：push 与 pull_request paths 各 +1 条 `sillyhub-daemon/tests/fixtures/**`，既有路径零删除。行为变化 = daemon golden fixture 变更的推送现在会触发 backend-ci 实跑（含 parity 测试）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——GitHub Actions paths 过滤按推送 diff 面判定，与事件到达序无关；同推送含 backend/** 时也不会双触发（同 workflow 同 SHA 去重为一个 run）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——workflow 文件单处修改；paths 匹配是 Actions 平台侧只读判定，无写竞争面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——纯配置文件改动，无运行态；推送前 YAML 已静态校验，坏配置不会被 Actions 采纳（workflow 解析失败即报 invalid workflow file，不静默）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   触发面按路径窄匹配（仅 sillyhub-daemon/tests/fixtures/**），daemon 源码/构建产物的日常变更不误触发 backend-ci；monorepo 内 backend↔daemon 的 fixture 共享消费关系正是本变更要补的触发闭环，无串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：fixture 再生成若频繁（daemon 侧 gen 流程再跑），每次都会白跑一轮 20 分钟 backend 全量——但 fixture 变更本就低频（快照锚定实现回归），且 parity 恰恰是这些变更最需要验证的面，代价与收益对等。放弃的方案：①把 paths 放宽到 `sillyhub-daemon/**`（daemon 任意改动都触发 backend 全量，20 分钟白跑成常态，不做）；②把 parity 测试的 fixture 复制进 backend/ 目录断开跨端引用（复制即漂移，三源对照设计的目的就是单一 fixture 源，不做）；③用 paths-filter 之类动态 job（对单路径需求过重，YAML 两行的事）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | .github/workflows/backend-ci.yml | push/pull_request paths 各 +sillyhub-daemon/tests/fixtures/**（带跨端消费依据注释） |
