---
author: flow-machine-draft
created_at: 2026-11-04T05:57:52.066Z
---
# 设计记录（Design Record）— 2026-11-04-session-quota-pill-follow-provider

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`frontend/src/components/sessions/ctx-usage-bar.tsx` 的 `QuotaPill` 目前把「选中供应商」只当排序提示，胶囊面固定取 `sortedEntries[0]`（全量可查供应商里排第一的），选中供应商不可查时它根本不在 `entries` 里，于是面就落到别家。改为两级展示源：

1. **有选中供应商**：胶囊面严格用该供应商的条目（`entries.get(providerId)`）；该供应商不可查或本轮无数据时，面渲染短状态「不支持」/「无数据」（供应商名与完整说明在 title 与浮层，D-001），不再取别家数据。浮层第一节固定是该供应商（有数据列明细，无数据列状态说明），其余可查供应商按名称序跟在后面。
2. **无选中供应商（本机默认）**：完全保留现有聚合行为（面取排序第一家、空数据灰字提示）。

页面接线（`session-panel-page.tsx`）把会话态传入的 `providerId` 改为「配置条暂存值优先」，经导出纯函数 `resolveQuotaPillProviderId(staged, session)` 解析：暂存有定义时用其值（空串=本机默认→null），否则用 `session.llm_provider_id`。这样配置条切换供应商（暂存、未发送）时胶囊立即跟随。预会话态已传 `preProviderId`，天然跟随。

供应商目录改用 `listUsableProviders()`（自己的 + 共享给自己的），与会话配置条候选同源：选中共享供应商时也能解析到它，按「不支持」展示且不发起额度查询（额度端点仅属主可查，接收方查询必失败），绝不回落聚合显示自己的别家额度（评审 P1 修复）。

查询集合：只对「非共享且 `detectUsageProvider` 非空」的供应商发起 quota/usage 请求；选中供应商不可查/共享时不额外请求，直接从 `listUsableProviders` 结果判定并渲染状态。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `QuotaPillProps.providerId`：语义从「展示排序优先提示」恢复为「当前选中的供应商」——有值时胶囊面/浮层首位必须是该供应商；null/undefined 仍是本机默认聚合。
- `CtxUsageBarProps.providerId`：新增「暂存值优先」的取值约定，组件签名不变。
- 新增导出纯函数 `resolveQuotaFace(providerId, providers, entries)`，返回面展示模型 `{ kind: "entry" | "unsupported" | "no-data" | "aggregate", ... }`；新增 `resolveQuotaPillProviderId(staged, session)` 供页面接线与单测共用。
- 无后端/接口改动，无新 API。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   供应商列表（react-query）与额度查询（refresh 中 `Promise.allSettled`）可能先后到达。选中供应商已在 `listUsableProviders` 结果中但额度尚未返回时，渲染「额度暂无数据」；额度返回后同一 `entries` 状态更新触发重渲染为正常数据。供应商列表未就绪（`isPending`）时不渲染，避免把「未知」误判成「不可查」。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端只读展示，`entries` 更新走既有函数式 `setEntries`，无并发写风险。轮询/悬浮刷新期间的旧响应由既有 `cancelledRef` + `inflightRef` 防重入/防回写，保持不动。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   切换会话时 `providerId` 变化，面即时切换到新供应商；若新供应商不在当前 `entries`（不可查/无数据），显示状态面而非旧供应商数据。组件卸载由既有 `cancelledRef` 防迟到 setState。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   额度数据按供应商 id 聚合在组件本地 state，不跨会话共享；`providerId` 来自当前会话/暂存，不跨工作区串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **风险**：状态文案与数据到达之间存在短暂「额度暂无数据」闪现（首次进入即选中可查供应商时）。可接受：比展示别家数据误导更安全，且 5 分钟轮询/悬浮 2 秒刷新会很快纠正。
- **放弃方案 A**：「选中供应商不可查时干脆不渲染胶囊」——用户明确要求明确告知，不渲染会让用户以为功能坏了。
- **放弃方案 B**：「继续聚合展示但把选中供应商排第一，不可查时不显示」——正是现状，用户反馈误导，否决。
- **不做**：本次不接入 OpenCode Go 额度（需要控制台 Cookie 走未公开 RPC，依赖 `opencode-usage-proxy`），留待用户确认后单独变更。
