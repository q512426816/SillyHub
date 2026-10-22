---
author: flow-machine-draft
created_at: 2026-10-22T01:40:22.147Z
---
# 决策记录（Decisions）— 2026-10-22-daemon-snapshot-report-log

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：日志量。每轮上报 +1 行（一轮通常也就 1 行 `collected` + 1 行 `reported`），长会话是线性增长；`delivered` 走 info 级、`failed`/`dropped` 走 warn 级，`config.log_level` 调到 warn 时只留异常（正常轮静默），可观测性与噪声可按部署调。另一个风险是**日志不能证明后端落库**——`delivered` 只代表 HTTP 2xx，后端若在事务里 best-effort 吞掉写入仍会丢；故「reported=delivered 但页面无卡」这条仍要靠后端侧查 —— 本变更只把「采到没发」这一半的盲区补上，文档里写明这条边界。 - **试过但放弃**：①继续保留四个零散 `on_turn_snapshot_*` tag 并各自补字段——grep 时要记四个名字，且成功路径仍无 tag，配对不了；②把日志塞进采集器（`turn_file_changes_collected` 里带上报结果）——采集与上报分属两层（SessionManager vs Daemon），采集器拿不到上报结果，硬塞会把上报结果回灌进采集器接口（接口膨胀 + 循环依赖风险）；③用 `console.info` 直接打而不走 `_logger`——绕过 `log_level` 过滤，warn 级部署下也会刷屏。
