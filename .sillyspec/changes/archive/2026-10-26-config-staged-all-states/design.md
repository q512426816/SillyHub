---
author: flow-machine-draft
created_at: 2026-10-26T05:16:17.246Z
---
# 设计记录（Design Record）— 2026-10-26-config-staged-all-states

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：上一变更（2026-10-25-session-config-deferred-switch）留下两处缺口：①组件 stagedMode 分支带 `!running` 条件——轮运行中点选供应商/模型/档案仍走旧 `executeSwitch` 后半段立即 `injectSession`（空 prompt 纯切换 → 忙轮排队条目 → 派发建静默切换 run，用户看到新轮次）；思考档位控件 `thinkingCtrlDisabled` 叠加面板传入的 `thinkingLevel.disabled`（=running），运行中禁用点不了。②模型子下拉的渲染条件与候选派生基于 `selectedProvider`（按 `llmProviderId` 会话真值查找），暂存供应商后真值未变 → 模型下拉不出现/候选不跟随，需再次操作才显示。

修法（纯前端两处，均 `session-config-bar.tsx`）：①stagedMode 分支去掉 `!running`——运行中点选同样仅上抛暂存；`onThinkingMenuClick` 同步去条件；`thinkingCtrlDisabled` 在 stagedMode 挂载时不再叠 `thinkingLevel.disabled`（仅 ended/离线禁用）。运行中暂存的配置随用户下一条消息生效：忙轮排队路径（sendToServerQueue）上一变更已并入暂存 options，后端排队条目带配置字段 + 非空 prompt，派发建**带消息的正常轮**（inject.py 非静默分支），不再产生静默切换轮。②显示层供应商改「暂存优先」派生：`displayProviderId = staged.llm_provider_id !== undefined ? staged.llm_provider_id : llmProviderId`，`selectedProvider`/`modelCandidates` 全部以 displayProviderId 为基准；取消暂存自然回退真值。

依据：`session-config-bar.tsx`（executeSwitch stagedMode 分支 / onThinkingMenuClick / thinkingCtrlDisabled / selectedProvider 派生，本文件为上一变更交付物）；`session-panel-page.tsx`（sendToServerQueue 排队路径已并入暂存 options，上一变更交付）；backend `inject.py`（非空 prompt 走正常消息轮）与 `queue.py`（排队条目保存配置字段、派发重放）——后端零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `SessionConfigBar` props 签名零变化（staged/onStagedSwitch 上一变更已定）；行为变化：挂载暂存模式后 running 态点选四控件从「立即 inject 忙轮排队」变为「仅暂存」；思考档位控件 running 态从禁用变为可点选暂存；模型子下拉显示与候选在暂存供应商时跟随暂存值。
- 未挂 onStagedSwitch 的存量调用面：running 态保持旧「点选即 inject」行为（兼容锚不变）。
- `thinkingLevel.disabled` prop 语义收窄：仅在非 stagedMode 时生效（stagedMode 下点选不发请求，禁用理由消失）；面板传参不变。
- 无后端/daemon/API 形状变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立——暂存仍为纯本地 state，无新增网络面；运行中暂存 → 本轮结束（SSE 迟到不影响）→ 下一条消息发送时并入，时序与空闲暂存同构。SSE 迟到导致的 running 派生抖动不再影响点选行为（点选不再依赖 running 分流）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：暂存唯一写方仍为面板（上抛合并 + 发送清空），无新增写方；后端排队条目带配置字段由既有 enqueue 覆盖合并机制处理（纯切换行逐字段覆盖语义不受影响——现在纯切换行只剩旧调用面产生）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：运行中暂存 + 用户不发送 → 本轮自然结束暂存仍挂着（下一条消息生效），与空闲暂存语义一致；发送失败暂存保留重试（上一变更既有）；sessionId 切换清空（既有）。运行中发送走排队路径携带暂存（上一变更已接线，本变更零改动）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：暂存仍为面板内 state 不落库不跨实例（上一变更声明边界不变）；显示层 displayProviderId 派生是纯函数计算，无作用域面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是「运行中点选即暂存」与后端忙轮排队语义的行为差异认知——旧语义「运行中受理即排队、本轮结束生效」改为「点选无任何后端动作、下一条消息才生效」，若用户在运行中点选后期望「本轮结束就换供应商（不发消息）」则不满足（需发送一条消息才生效）。此为用户明确指令（全部不触发轮次），接受该语义；运行中点选的 toast/提示已随 D-001 静默，控件值变化即反馈。

放弃的方案：①运行中点选仍即时 POST 但要求后端不建轮——需后端新增「无轮切换」通道，改动面大且与「发送时生效」的统一模型冲突；②模型下拉单独传暂存供应商 prop——比组件内派生 displayProviderId 多一条 props 通道，无收益。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | stagedMode 分支去 !running；档位控件 running 禁用解除（stagedMode 下）；displayProviderId 派生模型下拉显示与候选 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | running 点选四控件断言改暂存上抛；模型下拉跟随暂存供应商用例；既有 running 用例改写 |
