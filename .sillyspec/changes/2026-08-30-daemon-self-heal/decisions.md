---
author: qinyi
created_at: 2026-08-30 17:21:47
---

# 决策（decisions.md）— 唯一真相源

## D-001@v1: 缺口①触发形态 — 心跳恢复事件触发
- type: architecture
- priority: P0
- status: accepted
- source: brainstorm（用户 AskUserQuestion 拍板方案 A）
- question: 心跳闪断后 suspended 会话的恢复触发形态？
- answer: `_sendHeartbeatOnce` 成功分支、degraded 累计 >720s 守卫、复用 boot
  恢复链全量跑 fresh 记录；本机制针对的 suspended 来源是 offline sweep 档
  （Grill X-07 修正：suspend-batch 优雅停止是第二来源但必然伴随重启、boot
  恢复已覆盖，入 Non-Goals）。
- normalized_requirement: FR-01
- impacts: [FR-01, FR-02]
- evidence: daemon.ts:3498/3526/1339、sweep.py:86/:80、service.py:4498

## D-002@v1: 恢复与 selfupdate 双向互斥
- type: consistency
- priority: P0
- status: accepted
- source: brainstorm
- question: 恢复与自更新并发时谁让谁？
- answer: `_isBusyForUpdate` 增"恢复进行中"算忙（更新推迟走 30s 复查）；更新
  已推进后心跳已停、无恢复触发点（天然互斥）。
- normalized_requirement: FR-04
- impacts: [FR-04]
- evidence: daemon.ts:1998/1377、selfupdate-safety D-001 同语义

## D-003@v1: 下载校验口径 — 零子进程
- type: architecture
- priority: P0
- status: accepted
- source: brainstorm
- question: 下载内容可信性怎么校验？
- answer: buffer ≥64KB 且 `BUILD_ID` 正则可提取（与 `DISK_BUILD_ID_RE` 同款，
  daemon.ts:210）；任一不过不 rename 不 respawn。实测主 3,572,030B / mcp
  1,157,632B，17 倍余量。
- normalized_requirement: FR-05、FR-06 前半
- impacts: [FR-05, FR-06]
- evidence: preflight.ts:434、daemon.ts:210、实测 bin 尺寸

## D-004@v1: 备份轮换保留 3 份
- type: risk
- priority: P1
- status: accepted
- source: brainstorm
- question: 坏盘时人工兜底路径？
- answer: rename 前 copy target → `target.bak-<yyyyMMdd-HHmmss>`，同前缀字典序
  保留最近 3 份；同秒覆盖视为同名替换；mcp 伴生同款；备份失败不阻塞替换。
- normalized_requirement: FR-06 后半
- impacts: [FR-06]
- evidence: 8-30 靠 .bak-20260829 手工恢复的实证路径制度化

## D-005@v1: respawn 最后防线 — 不退出保活
- type: architecture
- priority: P0
- status: accepted
- source: brainstorm（Grill F1 修正：去掉"返回 false"表述）
- question: `respawnDaemonAndExit` 拉起前校验不过的行为？
- answer: spawn 前同款校验，不过 → error 日志 + 提前 return 不退出；返回类型
  维持 void（两调用点语义均为"排定交接"，拦截即保活无需回传）。覆盖
  `runPreflight` 启动路径（preflight.ts:110，无 stop）。
- normalized_requirement: FR-07 最后防线
- impacts: [FR-07]
- evidence: preflight.ts:334、daemon.ts:110（启动路径调用）

## D-006@v1: 测试隔离 + fixture 合法化
- type: feasibility
- priority: P0
- status: accepted
- source: brainstorm（Grill X-14 修正：补 fixture 更换）
- question: 根因（测试写真实 bin）怎么修？
- answer: `runPreflight` 增可选 binDir 参数透传（生产调用点 daemon.ts:1525
  不传，行为不变）；集成用例全部传临时目录；既有 `NEW BUNDLE BODY` fixture
  换 `validFakeBundle`（≥64KB 且含 BUILD_ID）。
- normalized_requirement: FR-08
- impacts: [FR-08, FR-09]
- evidence: preflight.test.ts:645（mock spawn/fetch/build-id 未 mock fs）、preflight.ts:190

## D-007@v1: 恢复忙门控（推迟无损）
- type: consistency
- priority: P1
- status: accepted
- source: design-grill B-01（主代理按推荐代行，用户可翻案 --reopen）
- question: 断连期间本地仍在跑的长 turn 会被恢复链驱逐终止（session-manager.ts:3546-3550），怎么处理？
- answer: 触发点检查 `_isBusyForUpdate()`，忙则置 `_recoverPendingAfterDegraded`
  + warn，心跳每拍成功路径复查，空闲后补触发；与 selfupdate 忙推迟同模式，
  无新定时器。触发点不设 `_recoverInFlight` 外层门（GAP-2，统一 pending 收口）。
- normalized_requirement: FR-02
- impacts: [FR-02, FR-04]
- evidence: session-manager.ts:3546-3550 驱逐语义、daemon.ts:1999 hasRunningTurn

## D-008@v1: 凭证断连补覆盖
- type: feasibility
- priority: P1
- status: accepted
- source: design-grill B-02（主代理按推荐代行，用户可翻案）
- question: 401/403 提前 return 在 failSince 置位前，纯凭证断连恢复后不触发 recover？
- answer: `heartbeat_auth_rejected` 分支 return 前补置 `_heartbeatFailSince`
  （原 null 时才置）；期间 sweep 同样翻 suspended，恢复后语义与网络断一致；
  FATAL 日志语义不变。
- normalized_requirement: FR-03
- impacts: [FR-03]
- evidence: daemon.ts:3541-3549（提前 return）/3555-3557（置位处）

## D-009@v1: respawn 前校验提前到 stop 之前（主拦截点）
- type: architecture
- priority: P1
- status: accepted
- source: design-grill B-03（主代理按推荐代行，用户可翻案）
- question: 若只在 stop 后校验，拦截时进程已停摆且 `_updateBusy` 永久 true →
  后续触发全被 skipped_inflight（daemon.ts:2122-2124），坏盘成永久僵尸？
- answer: 新增 `validateBundleOnDisk` 导出；`_tryUpdate` 在 stop() **之前**调用：
  不过 → warn + 释放 `_updateBusy` + 清 pending + return，旧进程完整在线、
  盘修复后可重试。顺序钉扎（GAP-1）：校验在忙终检之前或校验后重跑忙检，
  禁止插在忙终检与 stop 之间（保住前作"终检与 stop 首动作间无 await"不变量）。
- normalized_requirement: FR-07 主拦截
- impacts: [FR-07]
- evidence: daemon.ts:2143/2145/2177/2179（stop→respawn 顺序）、2122-2124（所有权跳过）、2111-2113（无 await 不变量注释）
