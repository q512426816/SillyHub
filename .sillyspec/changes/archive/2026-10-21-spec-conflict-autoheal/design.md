---
author: flow-machine-draft
created_at: 2026-10-21T04:36:02.760Z
---
# 设计记录（Design Record）— 2026-10-21-spec-conflict-autoheal

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户拍板「以本地为准」且要求**部署即生效、零手工动作**——现行 `SpecPushConflict` 是人工拍板语义（删 manifest / `resolve --keep-local`），把运维动作留给了用户，违背此诉求。本变更把拍板结论代码化：在 `postSpecSync` 包装器（daemon 侧推送唯一汇聚点，2026-10-21-daemon-sync-hardening 已在此设开关）捕获 `SpecPushConflict`，同一工作区**连续 2 次**冲突（impl 内 rebase 恰好一次重试已失败，第二次即真分叉）→ 自动备份并删除本地 manifest 缓存 → 递归重入推送（无缓存自动走全量 tar，无乐观锁，本地为准覆盖服务端）→ 冲突消解，全程零人工。env `SILLYHUB_DAEMON_CONFLICT_AUTOHEAL=0` 可关（默认开）。这是对 spec-sync.ts 内 NFR-02「conflict 后不自动覆盖」设计语义的显式修订——依据用户 2026-10-21 会话原话（B 本地为准 + 部署后就能好），复潮条件成立，记入本变更 decisions D-001。随包修掉上变更收口评审的两条 P3：① `runEventLoopWatch` 的 defaultSleep abort 退出改为循环内优雅 break（不再被 `_fire` 误记 `loop_crashed`）；② off 开关命中日志标明来源（env/flag），`isDaemonSpecSyncOff` 返回值从 boolean 细化为 `'env'|'flag'|null`。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `spec-sync.ts`：新增导出 `parseAutohealDisabledEnv(v)`（'0'/'false' 视为禁用自愈）与常量 `SPEC_SYNC_CONFLICT_AUTOHEAL_THRESHOLD=2`；`isDaemonSpecSyncOff` 返回类型 `Promise<boolean>` → `Promise<'env'|'flag'|null>`（真值语义不变，调用方零改动）；`postSpecSync` 行为变化——连续冲突达阈值时不再上抛 `SpecPushConflict` 而是自愈后返回全量推送结果（签名不变）。manifest 备份新目录 `~/.sillyhub/daemon/manifests-backup/`（best-effort 写，每次自愈一份，不清理——自愈低频，量级可忽略）。
- `event-loop-watch.ts`：defaultSleep 的 abort reject 改由 `runEventLoopWatch` 循环内 catch 后 break——循环体对 abort reason 形态免疫，daemon stop 不再产生假 `loop_crashed`。无导出面变化。
- 无 backend/端点/文件格式变化；`SILLYHUB_DAEMON_CONFLICT_AUTOHEAL` 为新增 env（缺省=开启，向后兼容）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | 冲突自愈（备份+删 manifest+递归全量重推）+ off 日志来源 |
| 修改 | sillyhub-daemon/src/event-loop-watch.ts | abort 退出优雅 break |
| 修改 | sillyhub-daemon/tests/spec-sync-off-switch.test.ts | isDaemonSpecSyncOff 返回值断言更新 + 日志来源断言 |
| 修改 | sillyhub-daemon/tests/event-loop-watch.test.ts | 优雅退出断言补强 |
| 新增 | sillyhub-daemon/tests/spec-sync-conflict-autoheal.test.ts | FR-01 自愈测试 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。自愈判定基于 per-ws 连败计数，计数只在 wrapper 串行路径上累加/清零（推送无并发回执乱序面）；「他端先推」型浅冲突在 impl 内 rebase 重试即收敛，根本到不了计数——能累积到 2 的是持久真分叉，恰好是自愈的目标形态。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   wrapper 在 Node 单线程事件循环内串行执行，计数 Map 无锁需求；备份/删 manifest 是对 daemon 私有缓存（~/.sillyhub/daemon/manifests/）的原子性要求很低的操作（删掉的最坏后果=下轮重走全量，与自愈同语义）；自愈递归重入前已把计数清零，若全量重推又抛冲突（防御性，tar 路径理论上无乐观锁不可能冲突）也只会重新计数、不会递归打转。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。自愈计数为内存态，daemon 重启回零（重启后首次冲突重新计数，最多晚一轮自愈）；manifest 备份落盘后即使进程立即被杀，下次冲突重新备份覆盖亦可，manifest 已删的状态天然让下轮走全量（与自愈等效）；abort/break 修复后 event-loop 循环在 daemon stop 时静默退出，无残留句柄。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。计数与备份均以 wsId 隔离（备份文件名含 wsId+时间戳）；SILLYHUB_DAEMON_DIR 隔离实例的 manifests/ 目录随 env 重定向，互不可见；自愈全量推的内容=该 ws 本地镜像树，不触其他工作区。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：本地为准全量覆盖会**抹掉服务端上他端未同步的改动**（如用户在另一台机器推过、或平台侧直接写过该工作区）——这正是原设计 NFR-02 要求人工拍板的原因。裁决依据：用户 2026-10-21 明确拍板「B 本地为准」且该工作区实况就是本地为工作现场、服务端为陈旧混合快照；缓解=阈值 2 次才触发（浅冲突不触发）+ manifest 备份留档 + warn 日志显式声明 local_wins 语义。
- **放弃方案①**：保留人工拍板、只把操作步骤写成文档——正是用户本轮否决的「乱七八糟」，运维动作必须代码化。
- **放弃方案②**：自愈时先 pull 服务端到临时目录备份再覆盖——pull 整树交换的落地面在 specs/{wsId}，另辟临时目录需复用 extractTar 且多一次大 tar 传输；manifest 备份 + 平台侧服务端有 tar 历史，对账手段已足够，不值得为低频事件加复杂度。
- **放弃方案③**：把 P3 两条留到下一个变更——bundle 重打部署是这次自愈生效的前置，分两次部署让用户多等一轮，违背「一次部署全量生效」诉求；两条 P3 均为一两行改动，随包修零风险。
