---
author: flow-machine-draft
created_at: 2026-10-23T03:00:27.832Z
---
# 设计记录（Design Record）— 2026-10-23-session-first-window-turn-align

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

参考 deepseek-harness 的自适应分页（首屏「至少 50 条消息、至少 2 个 turn，最多 500 条消息」，优先在 turn/start 处裁切，并配全量轮次大纲与按需补拉），把会话页首屏从「固定 400 行日志窗口」升级为「轮次对齐 + 预算自适应」：仍先拉最近 400 行日志作为底窗，随后用 `listSessionRuns` 快照按轮补拉——先补全窗口起点被截断的轮，再向前持续补更早轮，直到预算（3000 行）耗尽、更早轮直达触达单轮上限（2000 行，可能截断）、到达会话开头或单次 8 轮上限。小会话因此尽量全量显示，不做「2 轮即停」的额外截断（评审 P1）。**只有锚点轮直达完整（未触顶且覆盖底窗最新行）才合并**（以直达顺序为基、底窗尾部原序追加，不重排）；不完整/失败时整体回退底窗且不向前补拉，游标保持底窗最旧行——避免游标越过缺口造成永久洞（评审 P2/P3）。合并后的行集统一走 `logsToTurns` 装配，`hasEarlier` 仍按底窗是否满页判定；顶部「加载更早消息」保持既有日志游标翻页能力。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无新增端点、无后端签名变更。复用既有 `getAgentSessionLogs(sessionId, { limit, slim })`、`getAgentSessionLogs(sessionId, { before, beforeId, limit, slim })`、`getAgentSessionLogs(sessionId, { runId, slim })` 与 `listSessionRuns(sessionId)`。前端新增 `session-panel/initial-window.ts` 纯编排模块（fetch 注入、可单测）与首屏窗口常量（预算行数、单次补拉轮数上限 8）；`probeSessionLogBefore` / `getSessionRunLogs` 均支持 AbortSignal；后端响应结构零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。首屏补拉全部在建立 SSE 流之前完成（保持 ql-20260827-018「先回灌再建流」），`streamCursor` 取合并后最大日志时间，SSE 增量从该切点继续；补拉等待期间用 `cancelled` 标志丢弃过期结果，会话切换由 effect 重置 `turnState` 并关闭旧流闭环。合并以直达返回顺序为基、底窗中不在直达内的行按原序追加（不重排），跨 run 顺序与组内顺序均保持稳定。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

本设计只发只读 GET，无写入；首屏补拉位于 `establish()` 单飞序列内，`historyLoadingRef`/abort 与「加载更早」隔离。`listSessionRuns` 快照复用 `runsPromise`，不额外增加并发请求风暴。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。补拉前后校验 `cancelled`；首屏补拉链挂 `AbortSignal`，切换会话/卸载时 effect cleanup 立即 abort 在途请求（不再白跑到链尾），旧响应因 `cancelled` 不落地。补拉失败（runs 快照失败、直拉失败、直达截断、abort）均降级回底窗装配，不阻断建流；游标与 `hasEarlier` 在降级路径保持原语义。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。所有请求以当前 `sessionId` 为作用域，`runId` 直达端点自带「run 不属于该会话即 404」校验。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险是首屏多一次 runs 快照与至多 9 次单轮直达拉取（1 次截断轮 + 最多 8 个更早轮候选**并行**，一个 RTT 批量；slim 截断传输）；预算 3000 行、单轮 2000 行、单次 8 轮三上限把最坏请求量与传输量同时锁死，短轮会话不会串行发数百次请求。切会话/卸载经 AbortSignal 立即取消在途补拉链。直达不完整/失败时整体回退底窗（不合并、不向前补拉），新增更早轮只在完整时采纳——两条路径都保证轮间无洞。放弃方案：① 直接调大 `HISTORY_PAGE_SIZE`——仍会在大轮上复现且无轮对齐；② 后端改日志接口做服务端自适应分页——最优雅但改动面跨前后端、影响所有消费方，留待后续；③ 首屏全量加载所有轮次——长会话传输不可控（500 轮 × 数千行）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/daemon/session-panel/initial-window.ts | 首屏自适应编排纯模块：probe 截断判定、合并去重、最小轮数、预算与单轮上限门控 |
| 修改 | frontend/src/lib/daemon/sessions.ts | 新增 probeSessionLogBefore / getSessionRunLogs 两个语义化封装（复用 logs 端点，隔离探测/直达调用面） |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts | 自适应编排单测（单轮超窗全量 / 多轮 2 轮 / 已满足不补拉 / 直达截断降级） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 首屏接入自适应窗口：cursor / streamCursor / hasEarlier 与取消校验 |
| 修改 | frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | 新增首屏自适应接线集成用例 + 既有用例零回归 |
