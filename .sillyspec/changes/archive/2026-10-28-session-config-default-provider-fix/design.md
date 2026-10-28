---
author: flow-machine-draft
created_at: 2026-10-28T03:11:53.137Z
---
# 设计记录（Design Record）— 2026-10-28-session-config-default-provider-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三处纯前端缺陷修复，不动后端与 daemon：

1. **默认供应商显示按引擎匹配**（session-config-bar.tsx）：新增 `engineDefaultProvider`
   派生（`is_default` 且 `agent_kinds` 含当前引擎；引擎未定不过滤），供应商控件
   兜底显示与 `noProviderLabel` 兜底文案都改走它——与后端 claim 默认注入链
   （lease/context.py：`agent_kind ∈ agent_kinds` 命中才构造 config）同口径，
   保证界面展示的「默认」与实际注入是同一家。选这个方案是因为后端注入本身正确，
   病灶纯在展示层，回退派生单一化避免两处各自 find 漂移。
2. **模型下拉回退渲染**（session-config-bar.tsx）：`displayProviderId` 真值为
   null（未显式选择）时显示层回退 `engineDefaultProvider.id`——模型子下拉的
   渲染条件与候选列表天然跟随 selectedProvider，预会话/未选供应商时「显示将用
   默认供应商却不给选模型」消失。仅显示层回退，显式选择/暂存与请求载荷不变。
3. **dialog 首句 model 漏传**（session-panel-dialog.tsx）：handleSend idle 分支
   createSession 补 `model`（有值才带）——quick-e09c48e1 在 page 路径修过的
   「UI 有值但 body 组装漏转发」同款缺陷在 dialog 路径的补齐。

切换时序（问题三）**零触碰**：链路核查落档 queue-dispatch-audit.md，现状语义
即用户拍板的「agent 接收到新消息时才切换」。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `noProviderLabel(providers, engine?)`（frontend/src/lib/api/llm-providers.ts）：
  新增可选第二参 `engine`——传入时默认供应商须 `agent_kinds` 覆盖该引擎才进
  文案；缺省不过滤（群聊等既有三处调用面零回归）。
- SessionConfigBar 对外 props 无变化；内部新增 `engineDefaultProvider` /
  `displayProviderId` 回退逻辑，模型子下拉在「未显式选 + 有引擎匹配默认」时
  由隐藏变为渲染。
- dialog 首句 createSession 请求体：`model` prop 非空时新增 `model` 字段
  （此前恒缺）；null/空不带（零回归）。后端 create 无 model_requires_provider
  守卫（仅 inject 有），该载荷形态合法且模型独立于 llm_provider_id。
- 后端 / daemon：无改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：providers 列表 react-query 异步到位前 `engineDefaultProvider`
   为 null——显示退「本机默认」、模型下拉隐藏，列表到位后重渲染收敛（与既有
   noProviderFallbackLabel 同款 loading 缺省，非新态）。
2. **并发写**：纯前端派生（useMemo），无共享可变数据；多会话面板各自实例各自
   派生，不串写。
3. **切换/生命周期**：显示层回退不进任何请求载荷——用户在回退态点选模型走
   provisional/staged 既有通道；会话中途 providers 刷新（默认供应商被改）时
   显示随派生自然刷新，无残留暂存（staged 语义既有，不触碰）。
4. **作用域**：engineDefaultProvider 过滤键 = 会话引擎（effectiveEngine），
   每面板按自身 engine 派生，跨工作区/跨引擎会话不串台；群聊调用面不传 engine
   维持旧口径（多引擎场景留给后续需要时再收）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：模型下拉在回退态出现后，用户以为「显式选了默认供应商」——但请求
载荷仍不带 llm_provider_id，后端默认链注入的正是显示的这家（同口径），行为
一致无偏差；「不指定」项在下拉中保持当前高亮，语义仍是未显式选择。
试过放弃的方案：让显示层回退值直接写进 createSession 载荷（显式带默认供应商
id）——放弃，会把「用户默认」固化为「会话显式绑定」，默认供应商后续变更时
存量会话不再跟随，与「不指定=跟随默认」语义冲突。
