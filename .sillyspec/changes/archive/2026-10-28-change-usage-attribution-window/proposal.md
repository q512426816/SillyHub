---
author: flow-machine-draft
created_at: 2026-10-28T05:47:18.650Z
---
# 提案书（Proposal）— 2026-10-28-change-usage-attribution-window

## 动机

任务原话转写：变更详情执行用量统计取大约 40 倍：2026-10-28-session-list-loadmore-fetch 实际 13:17:51 诞生至 13:24:33 归档全程仅 6.7 分钟（SillySpec 档案 timeline.md + git 双证），页面统计却显示 3.3 小时/636 轮/输入 6.96M/缓存读 180M——usage_service 会话链接分支把变更绑定前数小时的无锚 run 全量摊入（新变更背历史账）；且变更终态后 current_change_id 永不清除，同会话后续轮继续打锚、统计持续增长。修复=统计侧时间窗截断+源头终态清锚，两者互补（截断自动修正存量显示，清锚防未来污染）。

成功标准：
- linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入
- linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入
- 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计
- 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计
- dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run
- 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更
- 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值
- 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破

## 变更范围

按成功标准机械推导，共 8 条验收面：
1. linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入
2. linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入
3. 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计
4. 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计
5. dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run
6. 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更
7. 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值
8. 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破

## 成功标准（可验证）

1. linked 分支只认领 started_at 晚于该 (change, session) link 行 created_at 的 run，绑定前历史轮不再摊入
2. linked 分支窗口上界=变更 archived_at 与同会话下一变更 link 时刻的较小者，归档后/切下一变更后的无锚 run 不再计入
3. 单会话先后绑定多变更时无锚 run 只归「轮时刻最近绑定的变更」，不双计
4. 同一变更绑定多会话时按各 link 行 created_at 独立开窗统计
5. dispatched 分支对已归档变更只统计 started_at 早于等于 archived_at 的 run
6. 轻量族命令 flow done 与全量族命令 run archive 触发终态时清除会话 current_change_id（识别需覆盖两族命令解析通道），后续轮不再打锚已终态变更
7. 存量虚高统计（如 2026-10-28-session-list-loadmore-fetch）部署后无需数据修正自动回落至真实值
8. 后端单测覆盖上述全部场景并通过，既有 usage_stats 测试回归不破
