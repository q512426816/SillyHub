---
author: flow-machine-draft
created_at: 2026-10-11T04:11:49.668Z
---
# 设计记录（Design Record）— 2026-10-11-junction-fallback-backup-sweep

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查 P2-1 + P3-1：261dc22e9 引入的 junction 备份交换在 `rename(specDir→backup)` 成功后，`mkdir(dirname(specDir))` 与 `symlink(...)`（:537/:541/:543）是裸 await——异常直接飞出 `ensureSpecJunction`，而 `pullSpecBundle` 的降级 pull（:161-162）只覆盖 `return false` 路径，半交换失败时该次 pull 整体失败且持久性失败（杀软长锁等）永不降级；同时 `.pre-junction-backup-<ts>` 备份目录全仓无删除路径，磁盘无界增长。修复：post-rename 两调用收进单一 try/catch，失败 warn（`junction_create_failed_fallback`）后 `return false` 走既有降级 pull（旧数据已在 backup，不丢，下次 pull 重试 junction 可自愈）；`sweepStalePullScraps` 增 `.pre-junction-backup-` 前缀（7 天保留期，区别于 in-flight tmp/trash 的 10 分钟——备份是用户数据的完整快照，留人工检查窗口），并在 `pullSpecBundle` 顶部（策略分支前）增一次清扫调用——既有调用点（:225）在 repo-native junction 成功早返回路径上不可达。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `sillyhub-daemon/src/spec-sync.ts` `ensureSpecJunction`（内部函数，未导出）：post-rename `mkdir`+`symlink` 收进 try/catch → 失败 `return false`（新增 warn 日志键 `spec_sync: junction_create_failed_fallback`）；`return true` 路径行为不变。备份 rename 成功后 `utimes(backup, now)` 盖创建时刻戳（评审 P3 清偿：rename 继承旧目录 mtime 会让老残留的 7 天保留窗形同虚设；best-effort，失败退化 mtime 原值）。
- `sweepStalePullScraps`（内部函数）：过滤增 `.pre-junction-backup-` 前缀，按前缀选保留期（backup 7 天 / tmp·trash 10 分钟既有）；docstring 同步。
- `pullSpecBundle`（导出）：函数体顶部（resolveSpecDir 之后、策略分支之前）增一次 `sweepStalePullScraps` 调用；既有 :225 调用保留（双清扫幂等，成本一次 readdir）。
- 模块导出面、daemon.ts 调用方、backend、前端：零改动（「无」）。repo-native 分支 `mkdir(sourceSillyspec)`（:153）保持 fail-loud（见边界裁决）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

清扫按 mtime 判龄（tmp 名含 pid+ts 必然新鲜；备份在 rename 成功后以 utimes 显式盖创建时刻戳——rename 会继承旧目录 mtime，老残留不盖戳则 7 天窗口形同虚设；盖戳 best-effort 失败退化 mtime 原值），并发 pull 的在途目录不受影响；半交换降级后下次 pull 重试 junction，迟到到达不改变收敛方向。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

pullSpecBundle 有 single-flight（daemon.ts:1830 同工作区去重），同 ws 并发清扫不重叠；清扫 best-effort（失败静默），误删面仅限「mtime 超 7 天的备份」——同 ws 7 天内不可能既有新备份又被并发清扫（mtime 是创建时刻，新备份恒新鲜）。跨 ws 清扫按 (parent, base) 前缀隔离不串台。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

半交换失败态（specDir 缺位、数据在 backup）本身就是旧实现已存在的形态，本变更只是把「抛异常」改成「降级 pull 重建 specDir」——比旧态更安全；7 天保留期内 backup 可人工取回，超期按废弃缓存清理（源项目 repo-native 场景数据本就在源项目，备份只是旧缓存快照）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

清扫前缀按 wsId（base）锚定，只清本 workspace 的兄弟目录；junction/symlink 目标恒为源项目绝对路径，不跨仓。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：7 天保留期是拍的工程值——太长磁盘压力延续、太短丢人工检查窗口；选 7 天依据是「缓存快照 + repo-native 真数据在源项目」的双重冗余，误删后果有限。声明边界：repo-native 分支 `mkdir(sourceSillyspec)` 失败保持 fail-loud 不降级——降级 pull 会把缓存落回普通目录、sillyspec CLI 自指守卫（realpath 穿透 junction）失效、重新打开 261dc22e9 收口的平台标记投毒面；fail-loud 由调用方 catch 记日志，会话无 spec 缓存但不投毒，两害取轻（可接受：投毒写脏源项目 vs 本会话读不到 spec）。

放弃的方案：① symlink 失败时回滚（rename backup→specDir 复原）——回滚 rename 同样可能 EBUSY 失败，引入第二层半交换态，复杂度不划算；降级 pull 重建 specDir 等价且更简单。② 清扫复用 10 分钟保留期——备份是完整数据快照非 in-flight 残留，10 分钟等于变相「删备份」，与 261dc22e9「数据不丢」的承诺冲突。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/spec-sync.ts | ensureSpecJunction 半交换收口 + sweep 备份前缀/7 天期 + pullSpecBundle 顶部清扫 |
| 修改 | sillyhub-daemon/tests/test_init_lease.test.ts | fs/promises 透传式 mock + 半交换降级两用例 + 备份清扫用例（tmp/trash 零回归断言） |
