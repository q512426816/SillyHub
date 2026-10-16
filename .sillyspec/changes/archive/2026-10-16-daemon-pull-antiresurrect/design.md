---
author: flow-machine-draft
created_at: 2026-10-16T12:31:51.997Z
---
# 设计记录（Design Record）— 2026-10-16-daemon-pull-antiresurrect

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

daemon「按 spec_version 自动取新」（心跳预取/lease/batch 三入口共用 `pullSpecBundle`）在删除 op 未上行窗口内整树覆盖（swap / in-place 兜底），把本地已删 spec 文件写回=复活——与 sillyspec CLI 已修的 `pullSpecBundle` 防复活（da8d2449）同款路径：daemon 的 `hasUnsyncedLocalChanges` 靠 mtime/pending_push 信号，**纯删除不产生新 mtime**，漏判删除 → 跳过回灌 → pull 覆盖。

移植方案对齐 CLI 语义并复用 daemon 现成设施：以 `LocalManifest`（pull/push 落地后均回写 = 上次成功同步的文件全集，与 CLI `spec-sync-base.json` 同构）为基线，回放落地前现算「本地已删面」（manifest 有/盘面无/`!isUploadExcludedPath` 同步面口径），解包产物命中文件不落地；被挡路径 warn 点名（截断 5），`restoreDeleted`（opts 或 env `SILLYHUB_DAEMON_RESTORE_DELETED=1`）显式恢复通道；manifest 缺失/解析失败 = 无抑制面（首拉行为不变）。单咽喉点改一处三入口全生效；不新增依赖、不改 wire 协议。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `PullSpecBundleOptions` 新增可选字段 `restoreDeleted?: boolean`（向后兼容，缺省 undefined=抑制生效）。
- `pullSpecBundle` 行为变化（对外可见）：删除 op 未上行窗口内 pull 不再把已删文件写回；新增 warn 日志 `⚠️ [spec_sync] 防复活抑制：…`（含被挡路径点名，截断 5）。函数签名（参数/返回类型）不变。
- 新增模块内 helper `applyResurrectSuppress(dir, set)`（未导出，纯内部）。
- 环境变量新增约定 `SILLYHUB_DAEMON_RESTORE_DELETED=1`（daemon 常驻进程的恢复通道）。
- LocalManifest 回写点新增「并回被抑制行」行为：pull 末尾落地重建时，被抑制行（落地树确实缺失的）并回基线——delete op 链保活、抑制跨 pull 持久（评审 P2 修复）；仍走既有 `writeLocalManifest` 通道，schema 不变。
- HTTP 端点/文件格式：无（LocalManifest 缓存 schema 不变）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | `PullSpecBundleOptions.restoreDeleted` 字段；`pullSpecBundle` 增防复活抑制（基线现算已删面 + 解包后清理 helper `applyResurrectSuppress`，swap/in-place 兜底双路径）；warn 点名 |
| 新增 | sillyhub-daemon/tests/pull-antiresurrect.test.ts | 防复活抑制 4 用例（抑制核心/无基线全量/恢复通道/排除口径） |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立——抑制集在 pull_start 时刻现算（与 CLI 同构）：pre_swap 二次回灌若成功上行删除，本窗口不重算，但彼时服务器 bundle 通常已不含该文件，误抑制面趋零；bundle 迟到（旧版本号晚到）由既有 spec_version 比对闸挡住，不进回放。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   同工作区并发 pull 由既有 single-flight/心跳预取去重（daemon-spec-prefetch 既有防线）串行化；抑制清理（rm tmpDir 内命中路径）发生在 swap 前的 tmpDir（隔离目录）或 in-place 兜底后的 specDir——与会话进程在途写入的竞态窗口与既有整树覆盖等价（未扩大）；删除后用户秒级手工恢复的极端窗口与 CLI 同构接受。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全——抑制不新增持久状态（现算、不落盘）；pull 中断时 tmpDir/swap 的既有容错语义不变（坏 tar 清 tmp、旧缓存保留）；manifest 由既有 pull/push 回写链维护，本变更不写它。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会——抑制集按 `wsId` 维度取 `readLocalManifest(wsId)`，路径 join 在该 ws 自己的 specDir/tmpDir 下；repo-native（junction）策略在 pull 前已 return 不进本路径；跨仓 daemon 各自持有自己的 manifest。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：**误抑制**（用户删除后又在秒级窗口手工恢复同名文件，pull_start 现算的抑制集会把 bundle 版本挡掉）——与 CLI 同构接受（窗口极窄，且有 restoreDeleted/env 显式恢复通道兜底）。
- 次风险：manifest 长期失真（如历史版本缓存含已不在同步面的路径）导致抑制面偏大——已用 `isUploadExcludedPath` 同口径过滤 + 「删除上行成功自然衰减」收敛；且只影响 pull 恢复面，不损伤任何现存文件。
- 首版缺口（独立评审 P2 实证，已修复）：首版只读 manifest、落地重建不并回被抑制行——delete op 生成条件「缓存有/盘面无」随重建断裂，抑制只活一个 pull 周期，第二次自动 pull 复活照旧。修复：落地重建时并回被抑制行（FR-04 持久性语义），新增第二次 pull 持久性测试断言。
- 试过但放弃：①改 `extractTar` 加 skip 参数（侵入面大、in-place 兜底仍需补刀）→ 放弃，改为解包后对命中路径 rm（两路径统一、签名不动）；②在 `hasUnsyncedLocalChanges` 加删除检测（pending/mtime 信号反推）→ 放弃，删除检测本质需要基线快照，重复造 manifest 已有的能力且动既有判定函数风险更高；③照搬 CLI 在 rm 前读基线文件的形态 → 放弃，daemon 的 manifest 缓存已是等价基线且生命周期管理（pull/push 双点回写）更完备。
