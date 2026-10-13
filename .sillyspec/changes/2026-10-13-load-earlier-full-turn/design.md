---
author: flow-machine-draft
created_at: 2026-10-13T10:00:15.718Z
---
# 设计记录（Design Record）— 2026-10-13-load-earlier-full-turn

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因：`handleLoadEarlier`（session-panel-page.tsx）按 `(ts,id)` 复合游标固定
`HISTORY_PAGE_SIZE=400` 行翻页，页边界与「已加载窗口最旧行」边界都会把一轮（run）
切成两半——触顶加载后顶部那轮只有后半段（提问在更早未加载区）；「回到会话开头」
复用同一翻页链路，到头后跨页同轮分裂成多个轮块（每页独立 `logsToTurns` 装配）。

方案（轮边界对齐）：翻页拉回一页后判两类跨界轮——① 窗口侧：页轮集合 ∩ 窗口终态
轮集合（新增模块级纯函数 `collectCrossBoundaryRuns`，经 `turnsRef` 快照镜像读取，
不进回调 deps）；② 页顶侧：满页时发 `limit=1` 探查请求（同 before 复合游标语义）
取紧邻更早一行，与页内最旧行同 run 即被切。命中的跨界轮用既有 `run_id` 直达端点
（`getAgentSessionLogs({runId, slim})`，先例：handleJumpToTurn 单轮直达）拉整轮行，
当页该轮行替换为整轮行重新装配，并在 prepend 的 `setTurnState` updater 里摘掉窗口
内同轮终态旧块——一轮收敛为单个完整块（提问 + 全部输出同块）。游标推进取合并后
行集的最旧行。选此方案而非「续拉整页直到轮边界」：后者多拉无关行且仍分裂显示；
选此方案而非「重写装配层做跨块段合并」：直达整轮重装天然产出单块，改动收敛在
handleLoadEarlier 一个函数内，SSE 实时链路零触碰。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

改动文件：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
（handleLoadEarlier 主体 + 模块级纯函数 `stripPageKeySuffix` / `collectCrossBoundaryRuns`
+ `turnsRef` 镜像）及测试文件（新增 1 个 + 适配 2 个）。对外端点/命令/文件格式：
无变化——`getAgentSessionLogs` 既有查询参数（`run_id` / `before` / `before_id` /
`limit` / `slim`）组合使用，后端零改动。组件 props / 导出签名：无变化。行为变化：
满页翻页后多一次 `limit=1` 探查请求；跨界轮多一次 `run_id` 直达请求；跨界轮从
「分裂多块」变为「单块完整呈现」，窗口内同轮旧终态块被摘除替换。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：SSE 实时增量按 realRunId 匹配最末块，decorated 块 realRunId 保持
   原值（#e 后缀仅在 runId key 上）——增量迟到不受影响；历史行时间序由后端升序
   返回保证，直达整轮行（升序）与当页剩余行按 run 分组装配，组内序不变。
2. 并发写：翻页全程 `historyLoadingRef` 同步锁防重入；探查/直达响应回来后先做
   会话纪元校验（`epochAtStart !== sessionEpochRef.current` 即丢弃），换会话在途
   响应不串台；`setTurnState` updater 为纯函数（摘块匹配只依赖 prev 与外层已定型
   的 crossRuns 集合，不读 ref）。
3. 切换/生命周期：换会话 effect 纪元 +1 并 abort 在途请求（探查/直达均带
   `abort.signal`）；直达单轮失败只降级该轮（当页行原样装配，保持现状分裂显示），
   整批失败 crossRuns 清空等价现状路径，不报错不卡死；到头（不满页）不发探查。
4. 作用域：跨界判定与摘块全部基于当前会话的 turns 快照与页行集合，会话切换即整体
   重置（turnState 归零 + 游标清空），无跨会话/跨工作区数据面；后端 run_id 直达
   端点自带会话归属闸门（404），无越权面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：摘窗口旧块的匹配键错误导致误摘（表现为内容丢失）——防护：匹配键取
`realRunId ?? stripPageKeySuffix(runId)`（与 upsertTurn / handleJumpToTurn 既有口径
同源），且只摘终态块（`TERMINAL_TURN_STATUSES` 闸），运行中轮（currentRunId 所在）
天然非终态不进集合。次风险：超长轮（>2000 行）被后端直达上限截断——此时该轮仍
不完整，但游标已压到返回集最旧行，下次翻页继续推进，行为不劣于现状。试过放弃的
方案：① 续拉整页直到轮边界——多拉无关行、请求量翻倍且不解决显示分裂；② 装配层
跨块段合并（把已装配块的 segments 拼接）——段去重/prompt 归并/子代理重挂语义复杂，
触碰 SSE 共享装配器风险大；③ 探查改为「拉一页看首行」——多拉 400 行只为看一行，
浪费带宽。
