---
author: flow-machine-draft
created_at: 2026-10-20T03:44:06.234Z
---
# 设计记录（Design Record）— 2026-10-20-session-error-visibility

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证（会话 71419980）：backend close_run_steps.py:277 把 SDK status=error_during_execution（涵盖全部模型错误：429/断流/codex spawn 失败）统一落 error_code=interactive_interrupted；前端 runTerminalTurnStatus（快照路径）与 deriveTurnTerminalStatus（实时路径）据此把该类轮归 killed「已中止」且不回填 errorDetail → RunErrorItem 错误卡永不渲染，真实错误（error_detail.raw）对用户完全不可见。

修复利用既有事实做精确区分：模型失败 = interactive_interrupted **且 error_detail 非空**（daemon classifyModelError 产物，模型错误键存在）；真打断 = interactive_interrupted 且 error_detail 空。两处渲染路径按此精化：① 快照路径（page-helpers.tsx enrichOne）terminal 判定为 killed 但 meta.status=failed 时尝试 buildErrorLogItem(meta.error_detail)，可解析则升级为 failed（status failed + errorDetail 回填，错误卡渲染），真打断维持 killed；② 实时路径（session-panel-page.tsx 终态回调）错误详情拉取条件扩展，拉回 error_detail 可解析则翻 status=failed + errorDetail；③ RunErrorItem raw 首行摘要默认渲染。选此方案而非后端拆新 error_code：后者需 daemon/backend/前端三方发版且存量 run 无法重写，error_detail 判定对存量数据即刻生效。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- enrichDisplayTurns（page-helpers.tsx）：签名不变；行为变化——killed+failed 快照且 error_detail 可解析的轮返回 status="failed" + errorDetail。
- session-panel-page 终态回调：内部逻辑，拉取条件扩展 + 回补时翻 status；无对外签名变化。
- RunErrorItem（agent-log/run-error-item.tsx）：props 契约不变；渲染输出新增 raw 首行摘要行（data-testid="run-error-raw-summary"）。
- 后端 / daemon / SSE 事件格式：零改动（「无」）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。SSE 终态先到（显示已中止），runs 快照迟到回补翻失败——两步收敛最终一致；刷新页面走快照路径直接正确。runs 拉取失败时保持 killed（既有 catch 兜底「失败 turn 仍有状态徽标」）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端 React 状态；setTurnState 函数式更新，fetchedErrorRunIdsRef 按 runId 幂等防重复拉取（既有机制，条件扩展不破坏）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。会话切换时 turns/runsMeta 整体重建；enrichOne 只补缺（?? 链）语义保留——已实时翻成 failed 的轮不被快照降级（快照升级与实时升级同值）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。改动仅会话面板渲染层；error_detail 取自本会话 run 行，无跨会话/跨工作区串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把真打断误报为失败（ql-20260918-003 曾专门修过反方向——打断被渲染成「轮次失败」的误导）。对策：升级条件严格限定 buildErrorLogItem 返回非 null（模型错误键存在才非 null），error_detail 空的真打断零触碰；FR-03 零回归用例钉住。

试过放弃的方案：① 后端拆新 error_code（如 interactive_model_failed）——需 backend+daemon+前端三方发版且存量 run 无法重写，放弃；② RunErrorItem 默认展开完整 raw——raw 可达数千字符（实测 404 HTML 全文），撑爆消息流，改为首行截断摘要 + 折叠全文。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | enrichOne killed 分支精化：error_detail 可解析则升级 failed + errorDetail |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 实时终态错误详情拉取条件扩展 + 回补翻 status=failed |
| 修改 | frontend/src/components/agent-log/run-error-item.tsx | raw 首行摘要默认渲染（截断）+ 折叠保留全文 |
| 新增 | frontend/src/components/daemon/__tests__/page-helpers-error-visibility.test.ts | 快照升级判定 + 真打断零回归用例 |
| 修改 | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | raw 摘要默认可见断言 |
