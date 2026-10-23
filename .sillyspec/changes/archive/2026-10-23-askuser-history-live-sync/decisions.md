---
author: flow-machine-draft
created_at: 2026-10-23T02:56:55.937Z
---
# 决策记录（Decisions）— 2026-10-23-askuser-history-live-sync

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：resolved 事件到达时后端答案落库与事件推送的时序竞态——若推送先于落库（理论窗口），重拉拿到的仍是 pending 态，记录短暂停留未更新，直到下一次事件/刷新兜底。评估可接受：backend 的 resolved 语义是"请求已收口"（落库后广播），实际窗口极小；且问答级频率下无重试风暴风险。 放弃的方案：a) 前端把 SSE 事件手工转 SessionDialogRead 增量 append/merge——resolved 事件不含 answers（SessionPermissionResolved 无答案字段），必须伪造或再查单条，且 id/created_at 等 REST 字段 SSE 缺失，拼装体与刷新后权威数据不一致（闪变）；b) 后端在 resolved 事件里加 answers 字段——动 SSE 契约+后端，改动面大且只解决 resolved 一半（request 到达仍需转换），违背"前端回显权威数据"原则；c) 轮询 dialogHistory——问答级频率用轮询浪费且延迟不可控。均弃。
