---
author: flow-machine-draft
created_at: "2026-10-25T12:36:00Z"
---
# 设计记录（Design Record）— 2026-10-25-fe-build-unblock

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

并行变更 deferred-switch 提交面带进两处类型错误使 next build 失败。修复取最小类型面：① page-helpers.tsx:435 `ordered[i - 1].whoLine` 在 noUncheckedIndexedAccess 下可能 undefined——改 `i > 0 ? (ordered[i - 1]?.whoLine ?? null) : null`（i=0 本就传 null，?. 只收窄类型不改值域）；② session-panel-variant.test.tsx:238 `opts?.llmProviders ?? ([] as never[])` 的联合含 unknown[]——整体断言 `(opts?.llmProviders ?? []) as never[]`（测试 helper 边界收口，调用面 464/504 行 fixture 形态不变）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外契约变更——两处均为源内类型收窄（运行时字节码等价：?. 与 ?? null 在既有输入域下求值结果与原表达式一致；as never[] 为编译期断言）。文件：frontend/src/components/daemon/session-panel/page-helpers.tsx、frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用：纯类型收窄，无运行时逻辑变化，不存在事件序问题。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：两文件为并行会话已提交内容的修补，Edit 前已核对最新态；若并行会话同刻也在修，git 提交面以显式 pathspec 隔离。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用：无状态、无生命周期面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用：改动限本仓前端两文件，无跨仓面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险可忽略：`?.` 与 `?? null` 在 i>0 且元素必存在的构造下与原 `.whoLine` 等值。试过放弃的方案：把测试 opts 类型改为 LlmProviderRead[]（需 import + 464/504 fixture 补齐必填字段，改动面扩大且可能引出 agent_kinds 类新错）——放弃，取 never[] 边界断言最小面。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | ordered[i-1] 可选链收窄（TS2532） |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | llmProviders 边界断言收口（TS2322） |
