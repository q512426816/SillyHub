---
author: flow-machine-draft
created_at: 2026-10-10T16:10:08.195Z
---
# 决策记录（Decisions）— 2026-10-10-run-close-task-sweep

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：daemon 对「子代理实际还在跑」的极窄窗口（run 收口瞬间任务仍在收尾事件在途）会被提前收口为 stopped——但 run 已终态意味着该轮进程已结束，任务不可能再产出合法结果，收口语义正确；迟到终态事件仍可覆盖（乱序问）。 - 放弃方案「读端把终态 run 的 running 任务渲染为停止」：治标——脏数据永存、导出/其它消费方仍见 running；放弃「给 upsert 加会话级对账」：面大且治不了存量。 - 已知残留：message 覆盖旧值（Optional 字段 latest-wins 既有语义内，可接受）。
