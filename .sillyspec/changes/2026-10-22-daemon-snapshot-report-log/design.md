---
author: flow-machine-draft
created_at: 2026-10-22T00:44:48.379Z
---
# 设计记录（Design Record）— 2026-10-22-daemon-snapshot-report-log

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两件事，都在 daemon 侧、都不动协议：①把 `hub-client.ts` 与 `daemon.ts` 两处仍写着「前端走『仅工具编辑』降级卡」的注释改成新口径（缺 `file_changes` → 后端 `capability="tool_only"`，前端无数据不出卡）；②把 `Daemon._onTurnSnapshot` 的四条出口（session 已收口 / 无 claimToken 无处入箱 / 已入箱 / 真实上报成功或失败）各补一条结构化日志 `turn_file_changes_reported`，与采集器的 `turn_file_changes_collected` 按 `runId` 配对——**有 collected 无 reported ＝ 采到但没落库**，两条都无 ＝ 没采到。

选这个方案的理由：上报侧现在只有失败 warn、成功静默，出问题只能靠猜；而日志是本模块既有的可观测面（`createLogger(level)` → `[daemon.<event>] key=value`），加一条事件即可闭环，零新依赖、零新通道、零协议变更。四条出口统一成一个事件名 + `outcome` 枚举，而不是继续加四个零散 tag（当前 `on_turn_snapshot_*` 四个 tag 无任何文档/测试引用）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `hub-client.ts::notifyRunResult`：**仅注释**——`file_changes` 映射逻辑与 wire 键零变化。
- `daemon.ts::Daemon._onTurnSnapshot`：**仅日志**——上报行为、payload 组装、best-effort 语义（不抛、不重试）零变化；四条原有 tag（`on_turn_snapshot_session_not_found` / `on_turn_snapshot_no_claim_token` / `on_turn_snapshot_notify_unavailable` / `on_turn_snapshot_notify_failed`）合并为统一事件 `turn_file_changes_reported`（带 `outcome` / `drop_reason` / `error`），级别不变（异常路径仍 warn）。
- **新增** 私有方法 `Daemon._logTurnSnapshotReport(outcome, report, extra)`：单点组装日志字段，避免四处手写漂移。
- 采集器 `SessionManager` / `turn-file-changes.ts`：**零改动**（`turn_file_changes_collected` tag 与字段逐字不变）。
- **无**端点、**无** DTO、**无** wire 字段、**无** backend 改动；**无**新事件通道（日志仍走 stdout → `daemon.log`）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 注释改新口径（`file_changes` 缺省 → `capability="tool_only"`，前端无数据不出卡；判「没采到/没落库」看两条日志配对） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_onTurnSnapshot` 方法头注释改新口径 + 四条出口统一打 `turn_file_changes_reported`（新增 `_logTurnSnapshotReport`） |
| 修改 | `sillyhub-daemon/src/interactive/turn-file-changes-types.ts` | 注释改新口径（`unavailable` / `capability` 两处仍写「降级卡 / 仅工具编辑」） |
| 修改 | `sillyhub-daemon/src/interactive/turn-file-changes.ts` | 模块头「降级语义」段改新口径（`unavailable` / `failed` → 前端不出卡） |
| 新增 | `sillyhub-daemon/tests/daemon-turn-snapshot-report-log.test.ts` | 四条出口 + 与 `turn_file_changes_collected` 按 runId 配对 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立且这正是本变更的用途：快照本身就是「后到」的（轮终态之后才采），日志也天然按 runId 独立成对；`collected` 与 `reported` 谁先谁后不影响配对判定（配对按 `runId` 而非时序），乱序只会让 grep 出来的相邻行不连续。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：日志是 `console.info/warn` 的写-写无关输出，无共享可变状态；同一 runId 的重复上报会打印多条 `reported`（覆盖写语义下次日志多条，判定仍成立——最后一条即最终结果）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。日志在 `_onTurnSnapshot` 的每条出口同步/回调里打印，不新增 await 链、不改 fire-and-forget 结构；session 在采集期间被收口 → 走 `dropped/session_not_found` 且照常打日志（这正是要暴露的丢数据形态）。上报回调挂在 `void ... .then/.catch` 上，异常仍被吞掉，不会回灌轮终态链路。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。日志字段只有 `session_id` / `run_id` / 快照头字段，不含路径内容；多 daemon 实例各自 stdout 到自己的 `daemon.log`，跨实例不合并。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：日志量。每轮上报 +1 行（一轮通常也就 1 行 `collected` + 1 行 `reported`），长会话是线性增长；`delivered` 走 info 级、`failed`/`dropped` 走 warn 级，`config.log_level` 调到 warn 时只留异常（正常轮静默），可观测性与噪声可按部署调。另一个风险是**日志不能证明后端落库**——`delivered` 只代表 HTTP 2xx，后端若在事务里 best-effort 吞掉写入仍会丢；故「reported=delivered 但页面无卡」这条仍要靠后端侧查 —— 本变更只把「采到没发」这一半的盲区补上，文档里写明这条边界。
- **试过但放弃**：①继续保留四个零散 `on_turn_snapshot_*` tag 并各自补字段——grep 时要记四个名字，且成功路径仍无 tag，配对不了；②把日志塞进采集器（`turn_file_changes_collected` 里带上报结果）——采集与上报分属两层（SessionManager vs Daemon），采集器拿不到上报结果，硬塞会把上报结果回灌进采集器接口（接口膨胀 + 循环依赖风险）；③用 `console.info` 直接打而不走 `_logger`——绕过 `log_level` 过滤，warn 级部署下也会刷屏。
