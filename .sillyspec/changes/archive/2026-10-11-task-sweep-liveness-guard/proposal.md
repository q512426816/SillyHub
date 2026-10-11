---
author: flow-machine-draft
created_at: 2026-10-11T03:36:49.940Z
---
# 提案书（Proposal）— 2026-10-11-task-sweep-liveness-guard

## 动机

任务原话转写：上一变更 2026-10-10-run-close-task-sweep 的设计缺陷修正（用户指正）：run 终态≠任务必死——后台子代理任务本来就跨轮次存活（主代理开轮派发后轮结束、任务继续跑、跑完发 [后台任务通知] 唤醒新轮继续回复），且线上表 is_async 恒为 false（daemon 上报未打标），按 is_async 排除保护不了它们；run 关闭即清扫会把真实在跑的后台任务错标「已停止」（迟到 running 心跳又被终态吸收冻结在错误状态）。服务器实测清扫已上线且一次扫了 112 条（当时恰好零异步任务、零误伤，但语义缺口真实存在）。
成功标准：
- 清扫（run 收口 + 启动兜底）只收「最近无心跳」的任务：updated_at 距清扫时刻超过宽限窗（5 分钟）且 is_async=false 才收口；活跃心跳中的任务（含跨轮次后台任务）不被误收
- 被清扫行保留可识别标记（message=清扫原因），后续到达的 running 心跳在「清扫收口行」上复活（status 回 running、finished_at 清空），真实在跑的任务下一个心跳即自愈；真实终态行（事件驱动的 stopped/completed/failed）维持终态吸收不复活
- run 收口时对「宽限窗内活跃」的任务安排延迟复扫（宽限+缓冲后重扫该 run），不靠后端重启兜底孤儿
- 新单测覆盖：心跳豁免/is_async 豁免/迟到心跳复活/真实终态不复活/延迟复扫；既有 agent_session_tasks 全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 清扫（run 收口 + 启动兜底）只收「最近无心跳」的任务：updated_at 距清扫时刻超过宽限窗（5 分钟）且 is_async=false 才收口；活跃心跳中的任务（含跨轮次后台任务）不被误收
2. 被清扫行保留可识别标记（message=清扫原因），后续到达的 running 心跳在「清扫收口行」上复活（status 回 running、finished_at 清空），真实在跑的任务下一个心跳即自愈；真实终态行（事件驱动的 stopped/completed/failed）维持终态吸收不复活
3. run 收口时对「宽限窗内活跃」的任务安排延迟复扫（宽限+缓冲后重扫该 run），不靠后端重启兜底孤儿
4. 新单测覆盖：心跳豁免/is_async 豁免/迟到心跳复活/真实终态不复活/延迟复扫；既有 agent_session_tasks 全绿

## 成功标准（可验证）

1. 清扫（run 收口 + 启动兜底）只收「最近无心跳」的任务：updated_at 距清扫时刻超过宽限窗（5 分钟）且 is_async=false 才收口；活跃心跳中的任务（含跨轮次后台任务）不被误收
2. 被清扫行保留可识别标记（message=清扫原因），后续到达的 running 心跳在「清扫收口行」上复活（status 回 running、finished_at 清空），真实在跑的任务下一个心跳即自愈；真实终态行（事件驱动的 stopped/completed/failed）维持终态吸收不复活
3. run 收口时对「宽限窗内活跃」的任务安排延迟复扫（宽限+缓冲后重扫该 run），不靠后端重启兜底孤儿
4. 新单测覆盖：心跳豁免/is_async 豁免/迟到心跳复活/真实终态不复活/延迟复扫；既有 agent_session_tasks 全绿
