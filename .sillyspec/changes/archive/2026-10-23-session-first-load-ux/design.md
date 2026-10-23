---
author: flow-machine-draft
created_at: 2026-10-23T06:45:37.494Z
---
# 设计记录（Design Record）— 2026-10-23-session-first-load-ux

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户痛点：进入会话面板，轮次列表出现慢（大会话多等数秒）且加载中无任何动态指示。根因两条：
1. **渲染门槛被 2026-10-23-session-first-window-turn-align 拉高**——establish() 内底窗日志（400 行）返回后还要串行走 buildInitialWindow（probe → 锚点轮直达 ≤2000 行 → 并行补 8 轮 ≤8×2000 行，3 个串行 RTT），全部完成才 setTurnState 首次渲染；大会话（40+ 轮、上万行日志）明显变慢。
2. **加载态缺失**——详情返回后、历史在飞时，TurnTimeline 在 `turns.length === 0` 分支渲染静态空态文案（「XX 已就绪」），无任何加载动画，用户以为页面卡死。

方案（两段化 establish + 骨架屏）：
- **FR-02 分阶段渲染**：establish() 拆两段。第一段：底窗日志到达 → 既有 logsToTurns 装配 → setTurnState 立即渲染 + 写底窗游标（hasEarlier 满页即真）；第二段：buildInitialWindow 照旧在后台跑（请求链、AbortSignal、失败回退语义零变化），完成后把窗口结果相对已渲染底窗的**新增行**（按 log id 差集：锚点轮直达补齐段 + earlierRuns 各轮）经 logsToTurns 装配成轮块 prepend 进 turnState（复用「加载更早」的头部拼接语义，同 run 跨块由 #e 变体机制天然承接），游标推进到 adaptive.cursorLog。SSE 建流时序不变（仍在补拉完成后，streamCursor 语义零风险）。
- **FR-01 骨架屏**：新增 `initialHistoryLoading` state（sessionId 变化置 true，establish 尾部置 false）；SessionPanelPage 给 TurnTimeline 传可选 prop；TurnTimeline 在 turns 为空且该 prop 为真时渲染 3 张轮次卡片形状骨架（antd Skeleton，经 ConfigProvider 主题 token 着色，动画自带），替代静态空态分支。dialog 模式（session-panel-dialog.tsx 独立实现）不传新 prop，行为不变（本变更不触达）。

选择该方案而非「整体取消补拉」：first-window-turn-align 的轮次对齐目标（首屏窗口起点不落轮中段、轮首 user_input 不丢）仍由第二段达成，只是渲染时机前移；最终窗口状态与现版一致。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `TurnTimeline` 新增可选 prop `historyLoading?: boolean`（缺省 false = 现行为，dialog 宿主零变化）；为 true 且 `turns.length === 0` 时渲染骨架屏而非空态文案。
- `SessionPanelPage`（session-panel-page.tsx）内部 establish 流程重排为两段渲染；新增内部 state `initialHistoryLoading`；对外 props/导出签名无变化。
- `initial-window.ts` 的 `buildInitialWindow` 签名与返回契约零变化（复用原样）。
- 后端零改动；无 API/DTO 变化（不需要跑 gen:types）。
- 新增轮次骨架为纯展示组件，无对外导出契约。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。底窗与补拉结果之间无乱序（同一条 async 链顺序执行）；迟到风险点是补拉完成晚于 SSE 建流——建流仍在补拉完成后（时序不变），且合并按 log id 差集去重，SSE 首连缺口同步与补拉 merge 双向幂等。用户在补拉在飞期间触顶翻页：第二段持有 historyLoadingRef 同步锁（进入即置位），handleLoadEarlier 原有 `historyLoadingRef.current` 守卫天然挂起；补拉完成释放锁并推进游标后翻页恢复，无重复拉取。用户在补拉期间抢先发送新消息（占位轮）：第二段合并走 prepend（只动头部），不整体替换 turnState，尾部占位轮/实时轮不受影响（现版「prev.turns.length > 0 不覆盖」守卫的场景在本方案下天然满足）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   单会话单 establish 链（sessionId effect 独占）；切会话纪元（sessionEpochRef）+ initialAbortRef.abort() 沿用——第二段合并前校验 cancelled/纪元，旧会话补拉结果不 prepend 进新会话。多 agent 并行改码风险按仓库规则以最新态为准（Edit 前重读）。

   补充（独立评审 P2 修复）：补拉在飞期间用户可点预览卡/导航刻度单轮直达同一 run——该块会先 prepend，第二段再以 #w 整轮块 prepend 会同 run 双块。合并写入在 setTurnState updater 内按「prev 已有该 run 且有内容（prompt/segments/output 任一非空）」过滤 prepend 块，用户已加载的内容让位优先；锚点轮因 replaceRunIds 先摘除，不受该过滤影响（仍走整轮替换）。滚动侧：合并前若用户已离底（距底 ≥ 80px）则捕获元素锚，由既有锚定 effect 钉回，与 TurnTimeline 贴底跟随互不抢占。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。切会话/卸载时 initialAbortRef 已 abort 补拉链（现版行为）；骨架屏 state 随 sessionId effect 重置为 true（新会话进入即重新显示加载态），establish 尾部 finally 置 false——失败路径（历史拉取 catch）也必须置 false，防终态空会话永久骨架（FR-03）。React 18 自动批处理下 setState 顺序保证渲染一致性。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。全部状态会话作用域（sessionId effect 内），无跨工作区/跨仓数据；骨架屏纯前端展示无持久化。dialog 模式不接新 prop，不与本变更串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：第二段 prepend 合并的轮块拼装正确性（锚点轮直达段与底窗同 run 跨块、#e 变体 key、游标推进条件）——缓解：合并逻辑提炼为纯函数（输入：已渲染 turns、底窗行集、adaptive 结果；输出：prepend 轮块数组 + 新游标），单测覆盖跨 run/同 run/空补拉/整体回退四种形态；沿用「加载更早」已验证的拼接语义而非新造。

已放弃方案：
- 「底窗后立即建 SSE 流」：直达整轮可能带回底窗边界之外的行，cursor 语义需重推导（现版注释明确「游标不前进会重复拉取」），风险大于收益——建流时序保持不变。
- 「取消/砍掉 buildInitialWindow 恢复纯底窗」：回退 first-window-turn-align 的轮对齐目标（轮首被截的困惑回归），治标不治本。
- 「补拉自动连翻触顶翻页（maybeAutoFill 循环）替代直达链」：串行多页 RTT 比并行 8 轮慢，且首屏先闪半轮再补全跳变更丑。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | establish 两段化渲染 + initialHistoryLoading state + 补拉增量合并 + TurnTimeline 传 prop |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 新增可选 historyLoading prop + 骨架屏分支 |
| 新增 | frontend/src/components/daemon/session-panel/initial-window-merge.ts | 首屏窗口增量合并纯函数 buildInitialWindowMerge |
| 新增 | frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx | FR-01/FR-03 骨架屏与空态测试 |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/initial-window-merge.test.ts | 增量合并纯函数四形态单测 |
| 新增 | frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx | FR-02 分阶段渲染测试 |
| 新增 | .sillyspec/changes/2026-10-23-session-first-load-ux/visual-evidence.md | 视觉证据与对照说明 |
