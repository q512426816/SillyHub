---
author: flow-machine-draft
created_at: 2026-10-11T04:47:39.765Z
---
# 决策记录（Decisions）— 2026-10-11-task-sweep-daemon-truth

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：部署窗口内 daemon 旧版（无该 RPC method）→ method_not_found 跳过 → 卡死行暂不收敛（回到 v1 之前的滞留态）直到 daemon 升级——安全方向的退化（宁可不收不错收），daemon 经 /daemon 分发自动升级，窗口有限。 - 放弃方案「问询结果缓存 + TTL」：重新引入时间参数且收益微小（清扫触发点低频）；放弃「daemon 周期性全量推送任务表」：广播放大 + 双端状态机，远重于按需问询。 - 已知残留：daemon 注册表本身的丢失窗口（重启后 task_notification 无处可归被跳过——17 条实证根因）仍会让终态事件丢失，但确认清扫在下一触发点把它收敛（这正是本设计的收敛路径）；is_async 列仍恒 false（daemon emit 不带 async 字段——遗留元数据问题，不再是死判依赖，留待后续按需修）。 - 前两代裁决作废声明：run-close-task-sweep 的「run 终态即收」与 task-sweep-liveness-guard 的「5 分钟宽限」死判均被本变更废除，标记/复活机制沿用。
