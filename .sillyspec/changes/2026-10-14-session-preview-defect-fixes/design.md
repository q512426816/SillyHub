---
author: WhaleFall
created_at: 2026-10-14 06:20:49
---
# 设计记录（Design Record）— 2026-10-14-session-preview-defect-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

上一变更（2026-10-14-session-turn-preview-cards）上线实测两缺陷，本修复最小改面两处：

①失败轮点不动——根因：单轮「有内容」判定（anyBody/hasBody/loadedHasBody 共 5 处）只认 segments/output，额度耗尽失败轮（日志含 user_input 无答复）被判零正文进幂等黑名单，点击短路无响应。修法：5 处统一口径补「非空 prompt 也是可渲染正文」（用户消息气泡本身是内容；失败详情卡由 runs 快照 error_detail 经既有 enrichDisplayTurns 注入，块进来即渲染）。真零正文（prompt/output 双空，群聊空 user_input）维持 2026-09-29 幂等语义——探针实证空串不被放行。

②轮号错乱——根因：logsToTurns 按批次局部编号（初始窗口末块=12、单轮直达恒 1、翻页各批各起 1），归并层有大纲权威 seq 却未盖到已加载块，与预览卡/导航轮号错位穿帮。修法：归并层透传时盖章（stampOutlineSeq：seq 不一致才克隆），WeakMap 按原引用缓存产物——流式期间每 delta 重派生 displayTurns 不因盖章全量克隆（TurnRow memo 不击穿），seq 已一致零克隆。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

改动全部为前端组件内部：preview-merge.ts 新增模块内 stampOutlineSeq（未导出）；session-panel-page.tsx 5 处局部判定表达式扩 prompt 分支。无端点/类型/导出签名变化，无 api-types 再生。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：盖章以大纲为权威幂等（同 seq 重复派生同引用缓存；大纲迟到到达时轮号短暂为批次局部值，大纲到位下一次派生自动盖章修正——显示层自愈，无持久错位）。
2. 并发写：5 处判定只读；fetchAndAttachTurn 的 prepend 仍走既有 setTurnState 串行队列 + previewInflightRef 在飞去重，无双写路径新增。
3. 切换/生命周期：会话切换时大纲/turns/幂等标记/在飞集各自既有重置链不变；盖章缓存 WeakMap 随原引用 GC，无跨会话残留。
4. 作用域：盖章键 = 原块引用（run 作用域），大纲按 sessionId 拉取，无跨会话串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把「有 prompt」放行后，某些只有噪音 user_input（如纯前导/系统注入行）的轮被误判有内容而展开空壳。已用真零正文集成用例锁定空串不放行；纯前导内容由 steerMatchKey 类既有归一口径消化，属可接受边界。放弃方案：在 logsToTurns 内全局改批次编号（跨批次状态维护复杂、动共享装配器影响 dialog/群聊全消费方，风险面大）——归并层盖章只影响 page 模式消息流，改面最小。
