---
author: qinyi
created_at: 2026-08-29 14:19:26
---

# 决策记录（Decisions）

## D-003@v2: 磁盘旁路探测方式与 disk_change 直启路径（Grill B1/B2 修正）
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-003@v1
- source: design-grill
- question: 探测比对基准（--version 输出 semver 与 BUILD_ID 不同源）与 disk_change 反应路径（防降级 noop 挡降级）
- answer: 探测=读 bundle 文件正则提取 BUILD_ID（gen-build-id.mjs 格式 regex 兼容，无 spawn）；disk_change 触发后走独立直启路径——不下载不查 manifest，空闲即 stop+respawn 到盘上版本（操作者换文件即意图，multica trySelfReload 同款）；server_command 仍走现有下载链
- normalized_requirement: 比对基准必须与 respawn 后新进程内存 BUILD_ID 同源；探测失败/空值≠版本变化；disk_change 直启不经过 runDaemonSelfUpdate 的 noop/防降级判定
- impacts: [FR-03]
- evidence: Grill B1/B2（--version 实跑输出 0.1.1 证伪；preflight.ts:207-224 防降级 noop）

## D-001@v1: 空闲屏障的忙定义
- type: term
- priority: P0
- status: accepted
- source: user
- question: 什么状态算「忙」需推迟升级？
- answer: 仅进行中算忙——在跑 interactive 轮次 + 在跑 batch lease 才推迟；空闲 active 会话不算忙（stop 前 suspend-batch 自动挂起、daemon 回来自动恢复，恢复链路 2026-08-29-daemon-platform-resilience 已就绪）
- normalized_requirement: daemon 升级前置检查=无在跑轮次且无在跑 batch lease 即可放行；空闲会话经挂起/恢复链路无损穿越升级窗口
- impacts: [FR-01]
- evidence: 用户 AskUserQuestion 第 1 轮（2026-08-29）

## D-002@v1: 忙时推迟策略
- type: term
- priority: P0
- status: accepted
- source: user
- question: 忙时推迟到何时？
- answer: 无限等空闲——每 30s 复查，空闲即升级，无强制上限（不做 pending-restart 状态机；multica 实证 drain-hook 状态机会卡死已弃）
- normalized_requirement: 推迟用「每轮从零重探测」的轻量定时器实现，无超时强制打断
- impacts: [FR-01]
- evidence: 用户 AskUserQuestion 第 1 轮（2026-08-29）

## D-003@v1: 磁盘旁路探测默认开启
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: bundle 被外部替换/降级的磁盘探测默认开还是关？
- answer: 默认开启（10min 周期 spawn `node bundle --version` 与内存 BUILD_ID 比对；版本差异含降级即触发升级；探测失败或任一侧版本为空≠版本变化，绝不据此重启——防替换窗口自杀）；配置项可关
- normalized_requirement: self_reload_check_interval_sec 配置（默认 600，0=关闭）；探测目标必须是重启将真正加载的 bundle 路径
- impacts: [FR-03]
- evidence: 用户 AskUserQuestion 第 1 轮（2026-08-29）

## D-004@v1: 方案选型 A3 完整形态
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 四项安全层做纯 daemon 侧（A1）还是含平台透传（A3）？
- answer: A3——A1 全部（空闲屏障/所有权 CAS+失败释放/磁盘探测/pending 本地 status 可见）+ 心跳上报 pending_update 字段 + backend 机器视图透出 + 前端机器卡展示「等待空闲升级」原因
- normalized_requirement: 跨三端：daemon（屏障/CAS/探测/pending 文件+心跳字段）、backend（心跳接收落库+machines/runtimes 响应透出）、frontend（MachineCard 状态提示）
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05]
- evidence: 用户 AskUserQuestion 第 2 轮（2026-08-29）

## D-005@v1: 保留既有优势语义
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 与现有 SELF_UPDATE 链路的关系？
- answer: 保留「拉起失败旧进程保活」（multica 没有的优点）并补全其半边语义——交接失败必须释放更新所有权与屏障，让下一条 SELF_UPDATE 指令可再触发；下载原子替换/防降级/noop 保活等既有行为不变
- normalized_requirement: 全部非重启路径释放所有权；仅成功交接（respawn 排定）持有到进程退出。「下一条指令可再触发」仅对 stop 前失败（下载失败/noop）成立；respawn 失败时进程已 stop 停摆（WS/心跳已关）——保活指进程不退出待人工/看护介入，backend 45s 判 offline 可见（Grill M07 措辞修正）
- impacts: [FR-02]
- evidence: preflight.ts:184/308 + daemon.ts:3997-4031 现状链路；preflight.ts:308-341 respawn 在 stop 之后
## D-006@v1: 设计整体确认
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 五段设计（S1 更新编排器/S2 磁盘探测/S3 可见性/S4 backend 透传/S5 前端机器卡）是否确认？
- answer: 确认。变更名 2026-08-29-daemon-selfupdate-safety，原型 prototype-machine-update-status.html
- normalized_requirement: 按 S1-S5 实施；关键语义：tryUpdate 单入口+所有权占位（JS 单线程原子）、仅进行中算忙、30s 复查无限等、探测失败≠版本变化、pending_update JSON 列 nullable、前端三状态同一横幅位
- impacts: [design.md 全文]
- evidence: 用户 AskUserQuestion 第 3 轮（2026-08-29）
