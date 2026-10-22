---
author: zcode-agent
created_at: 2026-10-22T15:16:34.258Z
---
# 设计记录（Design Record）— 2026-10-22-sillyspec-probe-db-missing-evict

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

生产实证：平台已删除的工作区 `urgent`（root_path=/mnt/e/Java/crrc/qmdp/urgent）仍被 centos8 daemon 持久化在 `sillyspec-status-roots.json` 反复探测；该仓未初始化进度库，`sillyspec progress show --json` 恒定 exit 2（envelope `codes=['db_missing']`），daemon 记瞬态失败并进 backoff，日志噪音与 `sillyspec_status_error` 常驻非空。

修法（全部在 daemon 侧，CLI 零改动）：`SillySpecManager._collectOneTarget` 在非零退出时解析 stdout envelope 的 `codes`——含 `db_missing` 视为「项目侧永久缺库」，按 cwd 计连败，连败 3 次后把 cwd 加入进程内 skip 表并经新可选依赖 `statusRootEvict(workspaceId, cwd)` 通知 daemon 从 `_sillyspecStatusRoots` 删除条目并持久化 roots 文件（重启不再恢复）；淘汰路径不计瞬态失败、清心跳 map 槽位。同时在 nonzero_exit 日志附 stdout 首行，让「exit 2 到底是什么」不再靠猜。选择 stdout envelope 而非退出码细分，是因为 CLI 已保证 `progress show --json` 失败时 stdout 恒为合法 JSON envelope（`runStatusOverview` 全路径），零协议改动即可拿到精确原因。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- HTTP / DB：无变更。
- `SillySpecManagerDeps` 新增可选回调 `statusRootEvict?: (workspaceId: string, rootPath: string) => void`——缺省不注入=无淘汰行为（测试/旧调用零回归）。daemon.ts 接线：从 `_sillyspecStatusRoots` 删除条目 + `void _persistSillySpecStatusRoots()` 持久化。
- manager 内部新增：`_dbMissingStreaks`（cwd→连败数）、`_evictedCwds`（skip 表）、常量 `STATUS_DB_MISSING_EVICT_AFTER = 3`。
- 日志：新增 `sillyspec_status_db_missing`（warn，连败计数）、`sillyspec_status_root_evicted`（info）；`sillyspec_status_nonzero_exit` 增加 `stdout_head` 字段（首行 ≤200 字符）。
- `includeLineCounts=false` 退档、超时、跨仓跳过、能力缺失等既有语义不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不涉及事件流。status 采集是串行轮询（同一 manager 实例内顺序执行），连败计数按 cwd 键控无乱序面；CLI 契约保证 `progress show --json` 失败时 stdout 恒为合法 JSON envelope，解析失败按非 db_missing 走既有记账，降级不劣化。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

`_dbMissingStreaks`/`_evictedCwds` 为进程内 Map/Set，daemon 单线程事件循环无竞态；evict 回调在 daemon.ts 删 `_sillyspecStatusRoots` 条目 + 持久化，与 claim 写入同在事件循环内串行。多 daemon 实例各持各的 roots 文件与计数，互不影响。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

淘汰是进程内状态——daemon 重启后从 roots.json 恢复（文件里该键已被 evict 回调删除，不会复活）；若项目之后 `progress init` 且工作区重新 claim，`_noteSillySpecStatusRoot` 重新注册根，采集自然恢复。淘汰不影响会话/轮终态链路（status 采集本就是心跳旁路）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

淘汰按 `workspaceId + cwd` 精确删除单个 LRU 条目，其他工作区根不受影响；workspaceId=null 的 legacy 单槽位只做 cwd 级跳过，不动单槽位本身。环境/配置不参与判定。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：把「暂时没 init 但马上要 init」的项目误淘汰——项目 init 后 workspace 重新 claim 会重新注册根，且淘汰阈值 3 次（默认采集间隔 + backoff）留了观察窗；误淘汰代价仅是面板暂缺该工作区数据，重新 claim 即恢复。
次要风险：CLI 未来在 db_missing 时改掉 stdout envelope 契约 → 解析不到 codes 回退既有 nonzero_exit 记账（降级不劣化）。
放弃方案 A：restore 时向平台批量核对工作区存活状态——boot 增加平台往返与失败面，且运行期删除的工作区仍会残留到下次重启，不如运行期连败淘汰直接。
放弃方案 B：CLI 侧 db_missing 改 exit 0——改机器接口语义，影响其他消费方，违反「CLI 零改动」。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | db_missing 连败淘汰 + evict 依赖 + nonzero_exit 日志带 stdout 首行 |
| 修改 | sillyhub-daemon/src/daemon.ts | 接线 statusRootEvict（删 LRU 条目 + 持久化 roots 文件） |
| 修改 | sillyhub-daemon/tests/sillyspec-manager.test.ts | 淘汰/记账/重置/跳过用例 |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/sillyspec-manager.md | 淘汰语义与诊断增强说明 |
