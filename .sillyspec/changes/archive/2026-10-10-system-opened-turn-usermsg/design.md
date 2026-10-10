---
author: flow-machine-draft
created_at: 2026-10-10T15:33:49.552Z
---
# 设计记录（Design Record）— 2026-10-10-system-opened-turn-usermsg

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户实证（服务器 run 4296aa6a）：轮次由 [后台任务通知] 系统消息开启，跑 14 分钟 240 行输出后用户⚡中途注入「国际销售合同 不要动！」——该消息成了此轮首条「有效」user_input，回放被提升为轮 prompt（顶部气泡）、实时被 prompt 补写路径写进 prompt，时序全丢。根因：系统通知行被 `extractPreambleText/stripPreambleText` 剥空后 `continue`，不占 prompt 槽，首条真实消息错误补位。修法最小侵入三处：①回放 `logsToTurns`——首条 user_input 剥空时压入一个占位空组（键含控制字符不可碰撞），prompt 保持空、真实消息自然落组 2+ 走既有 user_msg 段按 ts 插入链路；②共享函数 `appendDeliveredUserMsgIfAbsent` 守卫放宽（prompt 空 + 已有输出段 → 照常追加 delivered 段）；③page/dialog 两模式 prompt 补写加「新鲜轮（无输出段）」条件。不动后端/数据（时间戳本就正确），全部复用既有 user_msg 段渲染与插入机制。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `appendDeliveredUserMsgIfAbsent`（session-panel-page.tsx 导出，page/dialog 共用）：守卫行为变化（空 prompt + 有输出段 → 追加段），签名不变。
- `logsToTurns`（runtime-session-helpers.tsx 导出）：内部新增占位空组，返回形状不变（prompt 可能为空串——通知唯一开轮既有形态）。
- 后端/端点/数据格式零改动。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/runtime-session-helpers.tsx | logsToTurns 开轮槽占位（openerSlotSeen + 占位空组） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | appendDeliveredUserMsgIfAbsent 守卫放宽 + page 模式 prompt 补写新鲜轮条件 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | dialog 模式 prompt 补写新鲜轮条件（同款） |
| 修改 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | 占位槽 3 用例 + 顺手修 enrich 身份用例 fixture 缺 apiDurationMs（token-speed 旧债） |
| 新增 | frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx | appendDelivered 守卫 4 用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。回放侧开轮槽按 entries 处理序（后端返回 run 块序内 ts 升序）首条 user_input 判定，与到达顺序无关；user_msg 段 ts 取 log timestamp（服务器时间）非客户端时钟，插队消息乱序到达仍按 ts 落位。实时侧 resync 重放走同一 onLog 链路，与回放口径一致（通知先到剥空不写 prompt、输出段累积、中途消息成段）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：纯前端派生状态（setTurnState 单线程 reducer 链），无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：全部变更在既有 setState updater 纯函数内，无定时器/外部资源；换会话 turnState 整体重置不受影响。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：占位组与 user_msg 段均按 run 分组作用域内构造，run_id 匹配口径不变（runId/realRunId 双匹配既有逻辑）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：占位空组使「通知开轮」轮次的 prompt 恒空——若该轮实为用户真实发起但消息形态恰被剥空（如纯前导群聊注入开轮），顶部将无用户气泡——与既有「通知唯一开轮」形态一致，属既有语义而非新增缺失。
- 放弃方案「后端给 user_input 行加 opener 标记列」：需动表结构+迁移+双端联动，而时间戳数据本就正确、纯前端可判（首条+剥空），收益不抵面。
- 已知残留：首条判定按处理序而非严格 min(ts)——后端返回序即块内 ts 升序，理论乱序输入不在契约内。
- 评审 P3-2 披露补记：系统开轮后、首条输出段到达前的窄竞态窗口内，中途消息实时路径仍会写 prompt（无输出段可判），回放则渲染为 user_msg 段——两形态时序均正确，仅展示形态短暂不一致，窗口随首条输出到达自然闭合。
