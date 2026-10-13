---
author: flow-machine-draft
created_at: 2026-10-13T15:46:23.344Z
---
# 设计记录（Design Record）— 2026-10-13-turn-anchor-flowdiff-shape

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 sillyhub-daemon/src/interactive/turn-anchor.ts：①TurnAnchorRecord 增 totals 字段（{files, additions, deletions}——files=行数、行数加总时 null 不计入，与 sillyspec flow diff totals 同语义），doRecord 落盘前计算；②导出 toFlowDiffShape(record) 纯函数——返回 {rows, totals}（rows=files 原样引用，不复制不改写），作为 flow diff 消费契约的统一投影口。为什么 additive：JSONL 是追加分块真相源，旧字段与追加格式不动、旧读者（含已归档变更的消费面）忽略新字段零破坏；投影函数让平台后续消费方（后端/前端）一套契约吃轮粒度（轮锚）与变更粒度（flow diff --json）两种数据源，不复制数组不引入第二真相。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

turn-anchor.ts：TurnAnchorRecord 接口增 totals 字段（additive）；新增导出 toFlowDiffShape（纯函数）；doRecord 内增 totals 计算。JSONL 单行多一个 totals 键（旧读者零感知）。无端点/命令/文件格式变化（daemon 对外 API 不动——投影函数供进程内消费）。轮粒度 rows 无 state 字段：flow diff 的 state 是变更粒度三源区分（committed/dirty/untracked/archived），轮锚 diff 行天然无此维度，消费方按缺省理解。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。totals 是单条记录内 files 的确定性折叠（同输入同输出），计算发生在 doRecord 串行链内、落盘前——与轮到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无新并发面：totals 在既有 per-session 串行链内计算；投影函数纯读。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。additive 字段——中断/重启后旧记录无 totals，消费方 toFlowDiffShape 对无 totals 的存量记录现算兜底（投影不信任存量字段，始终从 files 重算——新旧记录同口径）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。字段与函数均在单会话记录域内；daemon 多实例各写各的 anchorsDir（既有语义）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：totals 与 files 不一致（存量漂移）——缓解：toFlowDiffShape 不信任存量 totals、始终从 files 重算（落盘 totals 只是消费方便利，真相在 files）；新落盘记录两者同源同算。次风险：rows 无 state 字段被消费方误当 flow diff 完整契约——JSDoc 明示维度差异。试过放弃的方案：①在 JSONL 行内再加 rows 别名数组——同一数据双字段冗余存 JSONL，膨胀且易漂移；②在 sillyspec flow diff 侧加轮粒度模式——CLI 不应知道 daemon 的会话轮概念，职责倒置。均否。
