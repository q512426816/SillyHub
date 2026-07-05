<!--
author: qinyi
created_at: 2026-07-04 17:23:26
change: 2026-07-04-daemon-version-management
-->

# decisions.md — daemon 版本可见 + 远程升级入口

本次变更的决策台账。只记录有实现/验收影响的决策。

## D-001@V1: 上报内容 = 语义版本 + 构建标识双字段

- type: architecture
- status: accepted
- source: code
- question: daemon 上报版本用 DAEMON_VERSION（语义版本）还是 BUILD_ID（git SHA）？
- answer: 两个都上报。语义版本对人友好（展示），构建标识对机器升级判断精确（self-update 现有逻辑比较 BUILD_ID）。
- normalized_requirement: daemon register/heartbeat 同时上报 `daemon_version`（语义）+ `daemon_build_id`（SHA）。
- impacts: [design §7.1, Wave 1, daemon hub-client]
- evidence: sillyhub-daemon/src/daemon-version.ts:23 (DAEMON_VERSION)、build-id.ts (BUILD_ID)、preflight.ts:183 (self-update 用 BUILD_ID 比较)
- priority: P0

## D-002@V1: 上报时机 = register + heartbeat 都带

- type: architecture
- status: accepted
- source: code
- question: 版本只在 register 带，还是 heartbeat 也带？
- answer: register + heartbeat 都带。开销可忽略（两字段几十字节），最稳；daemon 自更新 exit 重启会 re-register 刷新，heartbeat 兜底覆盖边缘情况。
- normalized_requirement: register 与 heartbeat payload 都含 daemon_version/daemon_build_id。
- impacts: [design §7.5, Wave 1]
- evidence: hub-client.ts:37 RegisterBody、:85 HeartbeatBody
- priority: P1

## D-003@V1: 存储 = 复用 version 列 + 新增 build_id 列

- type: data-model
- status: accepted
- source: code
- question: daemon 版本信息怎么存？
- answer: 复用已存在的 daemon_instances.version 列存语义版本；新增 build_id 列存 SHA。一个 alembic migration（down_revision=b16bf63a5d05）。
- normalized_requirement: daemon_instances 新增 build_id String(50) nullable 列；version 列开始被写入。
- impacts: [design §8, Wave 1, model.py, migration]
- evidence: model.py:64 (version 列已存在)、migrations/202607031200:38、alembic head b16bf63a5d05
- priority: P0

## D-004@V1: latest 分发 = 扩展 GET /version 返回 latest_version + latest_build_id

- type: architecture
- status: accepted
- source: code
- question: 前端怎么知道「最新版本」用于比对？
- answer: 扩展 GET /api/daemon/version，_compute_daemon_version 同时从部署 bundle 提取 BUILD_ID（SHA）与 DAEMON_VERSION（语义），返回 latest_version + latest_build_id；保留旧 latest/minRequired/downloadUrl 不破坏 install.sh。
- normalized_requirement: DaemonVersionResponse 新增 latest_version + latest_build_id；_compute 双提取。
- impacts: [design §7.2, Wave 2, router.py:100-135]
- evidence: router.py:100 _compute_daemon_version、:130 DaemonVersionResponse、:113 正则 BUILD_ID
- priority: P1

## D-005@V1: 升级入口位置 = runtimes 管理页 runtime 行

- type: ui
- status: accepted
- source: code
- question: 升级按钮放哪个页面？daemon instance 维度还是 runtime 维度？
- answer: 放 runtimes/page.tsx，按 runtime 行展示（self-update 端点是 runtime_id 维度，runtime_id 直接可得）。每行显示其 daemon instance 版本 + 徽标 + 升级按钮。同一 instance 多 runtime 重复显示版本可接受（标注「升级将重启整个 daemon 进程」）。
- normalized_requirement: runtimes/page.tsx runtime 行含 daemon 版本显示 + 升级按钮；DaemonRuntimeRead 扩展返回 daemon_version/daemon_build_id。
- impacts: [design Wave 3, §6 文件清单, schema DaemonRuntimeRead]
- evidence: router.py:511 self-update(runtime_id)、frontend runtimes/page.tsx、无独立 daemon instances 管理页（grep 确认）
- priority: P1

## D-006@V1: 升级反馈 = 异步 toast + 心跳刷新，不做实时进度

- type: boundary
- status: accepted
- source: design
- question: 升级过程要不要实时进度反馈（WS 推送各阶段事件）？
- answer: 不做。YAGNI——升级是低频运维操作，点击后 toast「升级指令已下发，daemon 重启后版本将自动更新」，版本经心跳（re-register）自动刷新。实时进度需 daemon 上报事件 + backend 转发 + 前端展示，三端加链路，过度工程。
- normalized_requirement: 升级按钮点击后仅 toast 提示，前端轮询/刷新版本经现有 runtime 列表查询。
- impacts: [design §3 非目标, Wave 3]
- evidence: YAGNI 原则
- priority: P2

## D-007@V1: 升级端点维度 = 直接用现有 runtime_id 端点

- type: architecture
- status: accepted
- source: code
- question: 要不要新增 POST /daemon-instances/{id}/self-update 更符合 entity-binding 模型？
- answer: 不新增。现有 POST /runtimes/{runtime_id}/self-update 已按 daemon_instance_id 路由 WS（router.py:532），升级是进程级（整个 daemon 重启），取 instance 下任一 runtime 调用即可。新增端点是冗余。
- normalized_requirement: 复用现有 self-update 端点，不新增 instance 维度端点。
- impacts: [design §7.3, §3 非目标]
- evidence: router.py:511-541、ws_hub.send_self_update(daemon_id)
- priority: P1

## D-008@V1: 兼容 = 字段 Optional，旧 daemon 显示「未知」不阻塞

- type: compatibility
- status: accepted
- source: design
- question: 已部署的旧 daemon（不上报版本）如何处理？
- answer: daemon_version/daemon_build_id 在 schema 为 Optional（default=None），旧 daemon 不上报时存 NULL，前端显示「未知」灰色徽标，不阻塞注册/心跳/升级。本项目未上线不要求历史兼容（CLAUDE.md 规则 10），但保留 Optional 兼容更稳。WS breaking 不扩大（与 daemon-entity-binding D-007 不同，本变更纯增量 Optional）。
- normalized_requirement: 新字段全部 Optional；前端 NULL→「未知」徽标；不扩大 WS breaking。
- impacts: [design §9, Wave 1/3]
- evidence: CLAUDE.md 规则 10、schema.py 现有 Optional 模式
- priority: P1

## D-009@V1: latest 来源拆分 — get_daemon_latest_version 保持返回 SHA

- type: consistency
- status: accepted
- source: design-grill
- question: 扩展 GET /version 后，self-update 端点（router.py:527）的 `latest = get_daemon_latest_version()` 用于 WS 推送，能否改为返回语义版本？
- answer: 不能。daemon preflight.ts:183 用 BUILD_ID（SHA）比对，WS 推送的 version 必须是 SHA，否则 self-update 永远判定「需升级」或「已最新」错误。get_daemon_latest_version() 保持返回 SHA（self-update 端点复用不变）；新增 get_daemon_latest_semver() 返回语义版本，仅供 GET /version 展示。
- normalized_requirement: get_daemon_latest_version 不变（返回 SHA）；新增 get_daemon_latest_semver（返回语义版本，bundle 提取失败="unknown"）；DaemonVersionResponse.latest_build_id 调前者，latest_version 调后者。
- impacts: [design §5 Wave 2, §7.2, R-07, router.py]
- evidence: router.py:527/533 self-update 用 latest 推 WS、preflight.ts:183 BUILD_ID 比较、router.py:119 get_daemon_latest_version
- priority: P1
