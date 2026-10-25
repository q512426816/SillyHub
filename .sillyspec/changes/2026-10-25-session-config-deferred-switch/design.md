---
author: flow-machine-draft
created_at: 2026-10-25T11:14:01.126Z
---
# 设计记录（Design Record）— 2026-10-25-session-config-deferred-switch

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：根因是 `session-config-bar.tsx` 的 `executeSwitch` 在会话空闲态点选供应商/模型/档案时立即调 `injectSession(sessionId, "")`（空 prompt 静默切换），后端 `inject.py` 为其建一个空的切换 run；思考档位则是点选即 POST `set-thinking-level`。用户要求点选不立即生效。

方案：**纯前端暂存，零后端改动**（执行期 D-001 用户定调修订：暂存静默无标记 + 时间线切换说明行）。面板页（`session-panel-page.tsx`）持有暂存 state（provider/model/profile/thinking_level 四字段），传给 `SessionConfigBar` 受控显示；组件在空闲态点选时不再 `executeSwitch`，改为上抛 `onStagedSwitch` patch（静默——控件直接显示暂存值，无「待生效」标记、无 toast，D-001）；选回当前生效值即取消该字段暂存（组件持当前值判定 cancel flag）。发送路径（空闲直发 `sendFromQueue`、忙轮排队 `sendToServerQueue`、历史重发 `handleResend`）在 `injectSession` options 中并入暂存的 provider/model/profile，暂存档位先调 `setSessionThinkingLevel`（失败警告不阻塞），受理成功后清暂存并 invalidate `agentSessionDetail`。暂存为空时请求形态与现状逐字段一致（零回归）。运行中点选保持现状（后端忙轮排队，本就不建轮）；ended/provisional 行为不变。

切换说明行（FR-06 / D-001）：`SessionTurnView` 新增 `configChangeLine`，`TurnRow` 轮块顶部独占一行渲染（形态对齐 system_event 虚线药丸）。双链路生成共用 `page-helpers.buildConfigChangeLine` 纯函数：**实时路**——发送受理成功时面板以「会话当前生效值 ⊕ 暂存值」预置占位轮（发送方前端权威，含会话级模型覆盖维度）；**历史路**——`enrichDisplayTurns` 排序后相邻轮快照对比（whoLine 扩 `modelName` = 档案快照 model；供应商/档案维度）。run 快照无会话级模型覆盖列（后端确认），历史路的模型维如实缺失、由实时路补足，不编造。

依据：`frontend/src/components/sessions/session-config-bar.tsx`（executeSwitch/props 契约）、`frontend/src/lib/daemon/sessions.ts`（injectSession options / setSessionThinkingLevel）、`backend/app/modules/daemon/session/service/inject.py`（带切换字段的普通消息即时生效）、`session-panel-page.tsx`（发送三路径 + provisional 暂存先例 ql-20260823-008）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- `SessionConfigBar` 新增 props：`staged?: { agent_profile_id?: string; llm_provider_id?: string; model?: string; thinking_level?: string }`（受控暂存值）、`onStagedSwitch?: (patch: { field: SessionConfigStagedField; value: string; label: string; cancel?: boolean }) => void`。两 prop 均可选——未传时空闲点选保持旧行为（立即切换），存量调用面零回归。
- 组件内变化：空闲态且 `onStagedSwitch` 已传时，供应商/模型/档案点选走暂存上抛分支（不 `injectSession`，静默无 toast——D-001）；会话态思考档位点选在 `onStagedSwitch` 已传时同样上抛（不 POST）；暂存供应商时级联上抛 `model: ""` 重置（对齐 provisional 切供应商重置模型先例）。
- `SessionTurnView` 新增可选 `configChangeLine?: string | null`（切换说明）；`whoLine` 新增可选 `modelName?: string | null`（档案快照模型）。
- `page-helpers.tsx` 新增导出 `buildConfigChangeLine(prev, next)` 纯函数 + `ConfigChangeWho` 类型；`enrichDisplayTurns` whoLine 构造补 modelName、排序后相邻快照对比填 configChangeLine（预置优先）。
- 面板新增：暂存 state + label ref、`onStagedSwitch` 合并/清除、三个发送点位并入（含档位先调）、受理成功清暂存 + invalidate `agentSessionDetail`、占位轮预置 configChangeLine、sessionId 切换时重置暂存。
- 无后端/daemon/API 形状变化；`injectSession` 与 `set-session-thinking-level` 端点照旧使用；排队条目配置字段（agent_profile_id/llm_provider_id/model）后端已保存并在派发重放（queue.py 确认），无后端改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：暂存是纯本地 state，无网络乱序面；发送窗口期（inject 在途）用户再点选 → 新暂存挂到「下一次」发送（本次已带旧暂存快照），语义自洽。SSE 迟到不影响暂存显示（显示值与网络态解耦）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：暂存只有面板单一 state 写入方（组件上抛 + 发送清空），React 单线程更新无并发写；后端多端（另一浏览器标签）同会话切换不受影响——暂存不落库，发送时以请求字段覆盖。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：sessionId 切换（换会话/关面板）时清空暂存，防跨会话串台；发送失败暂存保留（原文回填重试同款语义）；档位暂存在发送时若失败保留（下次发送再试）并 toast 警告；会话由 idle 转 running（定时消息/他端触发）后暂存仍在，下次发送照常并入（后端对带配置的排队消息照常受理）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：暂存为面板内 React state，不写 storage、不跨工作区/跨仓/多实例共享；刷新页面即丢（可接受——暂存与发送通常秒级相邻，需求已如实标注）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是发送点位遗漏（面板发送路径多：直发/排队/重发/定时消息/团队触发）——本次覆盖三个主注入点位（直发/排队/重发）；定时消息与团队触发为独立配置语义（创建时已带各自参数），不并入（在汇报中说明）。次风险：现有测试断言 injectSession 精确参数形态，暂存为空时必须不多传字段（以「仅暂存非空才并入」保证）。

放弃的方案：① 后端持久化暂存（agent_sessions 加 pending 字段，刷新不丢）——改动面扩到后端+迁移+三端同步，用户痛点（切换轮）纯前端即可解决，收益不成比例；② 复用后端忙轮排队机制扩展到空闲态（空闲也落 pending 行）——空闲无 run 终态钩子可应用，需要新派发时机，架构改动更大；③ 档位继续点选即 POST（不建轮无感知问题）——用户明确要求四控件统一「发送才生效」，且统一后交互模型单一（点选=暂存）更好解释。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 新增 staged/onStagedSwitch props；空闲点选暂存上抛分支（静默，D-001）；暂存值受控显示 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 暂存 state + 接线 + 三发送点位并入 + 清暂存 + 占位轮预置切换说明 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | SessionTurnView.configChangeLine/whoLine.modelName；轮块顶部切换说明行渲染 |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | buildConfigChangeLine 纯函数；enrichDisplayTurns modelName + 相邻快照对比 |
| 修改 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | 空闲点选断言改暂存上抛；新增暂存显示/取消/运行中保持用例 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | 新增发送并入暂存并清空用例 |
| 新增 | frontend/src/components/daemon/__tests__/page-helpers-config-change-line.test.tsx | buildConfigChangeLine 文案 + enrich 相邻对比用例 |
