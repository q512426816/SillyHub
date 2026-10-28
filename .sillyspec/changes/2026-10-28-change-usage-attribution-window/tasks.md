---
author: flow-machine-draft
created_at: 2026-10-28T05:47:18.650Z
---
# 任务注册表（Tasks）— 2026-10-28-change-usage-attribution-window

- [x] task-01: linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入
- [x] task-02: linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入
- [x] task-03: 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计
- [x] task-04: 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计
- [x] task-05: dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run
- [x] task-06: 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更
- [x] task-07: 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值
- [x] task-08: 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破
