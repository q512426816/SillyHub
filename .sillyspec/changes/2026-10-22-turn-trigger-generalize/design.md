---
author: flow-machine-draft
created_at: 2026-10-22T03:14:44.733Z
---
# 设计记录（Design Record）— 2026-10-22-turn-trigger-generalize

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：按用户已批准的设计对比稿（dsh turn-trigger.ts 同构 B 案）执行 Phase 1 纯前端泛化。核心三件：① session-log-assembler.ts 新增 `TurnTriggerKind`（task_wakeup/auto_resume/shadow_chat/group_chat）与 `TURN_TRIGGER_META` 配置表（字形/标签/正文是否折叠），`TurnSegment` 的 task_wakeup 专段改为单一 `kind:"turn_trigger"` 携带 trigger 字段（段为渲染期计算、无持久化，零迁移）；新增 `isAutoResumeInjection`（`[系统续跑` 前缀——daemon auto_resume.py 四模板 RESUME_PROMPT_TEMPLATE/RESUME_NUDGE_PROMPT/QUOTA_NUDGE_PROMPT/CONTEXT_OVERFLOW_REPLAY_HEADER 的共同稳定前缀，跨语言常量同步义务注释沿 TASK_WAKEUP_PROMPT_PREFIX 先例）并接入 extract/stripPreambleText（同构 task_wakeup 钩子）。② turn-segment-views.tsx 的 TaskWakeupNoticeView 泛化为 TurnTriggerView（按 META 渲染；contentHidden 的 kind 可展开全文，contentVisible 的 shadow/group 为纯来源标注行不可展开）。③ 分类落点：回放路径（runtime-session-helpers 开轮槽）与 live 路径（session-panel-page upsert）——task_wakeup/auto_resume 走内容前缀（正文折叠进触发行、prompt 剥空占开轮槽），shadow/group 走前导头判定（正文照常剥离显示、前导不再产 preamble 段避免双卡、仅开轮槽判定，中途群聊注入维持既有行为）。

选内容前缀+前导头检测而非 run metadata 驱动：auto_resume 的 metadata_.auto_resume_of 虽已透传前端，但挂在 SessionRunRead 上、回放装配入口（logsToTurns）只有 logs——接线需改装配签名并把 run 列表穿透到 helpers（跨层改动）；daemon 四模板共享 `[系统续跑` 稳定前缀且为 daemon 单一源常量，Phase 1 用前缀检测零后端零签名改动，metadata 驱动留给 Phase 2 与定时消息打戳一并做（设计对比稿已声明该演进方向）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：
- session-log-assembler.ts：`TurnSegment` 成员 `{kind:"task_wakeup"}` 移除，新增 `{kind:"turn_trigger"; id; text; ts; trigger: TurnTriggerKind}`；新增导出 `TurnTriggerKind`/`TURN_TRIGGER_META`/`isAutoResumeInjection`/`classifyPreambleTrigger`；extractPreambleText/stripPreambleText 增 auto_resume 钩子（行为同构 task_wakeup 分支）。
- turn-segment-views.tsx：`TaskWakeupNoticeView` 更名 `TurnTriggerView`（props 随段型），SegmentView 分发 case 同步；两视图（对话/进度）渲染语义不变。
- runtime-session-helpers.tsx / session-panel-page.tsx：唤醒留痕段收集泛化为触发段收集（回放开轮槽 + live upsert 幂等插段同构扩展 shadow/group/auto_resume）。
- turn-timeline.tsx / turn-status-bar.tsx：穷尽 switch 与对话过滤谓词的 kind 改名补点（task_wakeup → turn_trigger）。
- message-queue-bar.tsx：事件行分流谓词泛化（origin==='task_wakeup' || origin.startsWith('auto_resume:')），事件行标签按 trigger 区分；计数保持只豁免 task_wakeup（对齐后端 SESSION_QUEUE_MAX_PENDING 仅豁免 TASK_WAKEUP_QUEUE_ORIGIN 的口径）；✎ 抑制扩展到 auto_resume。
- backend / daemon / API 契约：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。分类是渲染期纯函数（内容前缀/前导头判定不依赖到达顺序）；live 路径 upsert 幂等守卫（segments 无同 trigger 段才插）沿 task_wakeup 先例覆盖 SSE 重放/乱序；shadow/group 仅开轮槽判定（openerSlotSeen 既有语义），中途到达的同前导不产触发段。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：组件纯展示无写面；拖拽/编辑状态机沿用 message-queue-bar 既有单写者口径（本变更仅扩分流谓词，未动状态机）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。turn_trigger 段与 task_wakeup 段同生命周期（随轮装配计算、随条目/日志删除消失）；expandedId/editingId 的 byId 防御覆盖新 trigger 来源条目；live upsert 的幂等守卫键从「无 task_wakeup 段」改为「无同 trigger 段」，轮内多源触发（理论面）各自一行不互吞。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。判定输入全部来自本会话日志内容与本会话队列条目 origin（服务端写入），无跨会话聚合面；`[系统续跑`/`【影子直聊】`/`【群聊上下文】` 前缀空间互不相交且与用户自由文本撞笔的概率由「开轮槽 + 精确头部」双重收窄（伪造前缀的用户消息会误标来源标注行——与 task_wakeup 伪造前缀既有口径一致，Phase 2 metadata 驱动后消除，风险已在对设计中向用户披露）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是内容前缀检测的伪造/漂移面——用户手打 `[系统续跑` 或 `【影子直聊】` 开头会被误标来源行（不丢内容、仅标注错源）；daemon 模板文案改动会静默漏检。双向前缀为 daemon/后端单一源常量且有测试锁定（auto_resume.py 注释「单一源导出供测试锁定」），跨语言同步义务注释落在前端常量处；根治靠 Phase 2 metadata 驱动（设计已排期）。死路：①「run metadata 驱动分类」——Phase 1 放弃（装配签名穿透成本，见做法概述）；②「定时消息并入」——用户裁定留 Phase 2（派发侧无标记需后端动 scheduled_send）；③「每源独立段类型」——组合爆炸，设计对比稿已否决（A 案）；④「shadow/group 前导保留 preamble 段双呈现」——进度视图双卡（来源注入卡 + 触发行）冗余，已裁定触发行替代。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | frontend/src/components/daemon/session-log-assembler.ts | TurnTriggerKind/META/isAutoResumeInjection/classifyPreambleTrigger + 段型泛化 + preamble 钩子 |
| 改 | frontend/src/components/daemon/turn-segment-views.tsx | TaskWakeupNoticeView → TurnTriggerView（按 kind 配置渲染）+ 分发 case |
| 改 | frontend/src/components/daemon/runtime-session-helpers.tsx | 回放开轮槽触发段收集泛化（4 源） |
| 改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | live upsert 同口径泛化 |
| 改 | frontend/src/components/daemon/turn-timeline.tsx | kind 改名补点（过滤谓词/对话特判/segmentTsOf） |
| 改 | frontend/src/components/daemon/turn-status-bar.tsx | segmentTs kind 改名补点 |
| 改 | frontend/src/components/daemon/message-queue-bar.tsx | 事件行分流泛化 + ✎ 抑制扩展 |
| 改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | rowKindOf 穷尽 switch kind 改名补点（turn_trigger 归 user 行，实施期发现的设计清单遗漏） |
| 改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | TurnTriggerView 按 kind 用例 |
| 改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 4 源装配用例 |
| 改 | frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx | auto_resume 事件行用例 |
