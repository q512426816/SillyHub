---
author: flow-machine-draft
created_at: 2026-10-11T04:11:49.668Z
---
# 提案书（Proposal）— 2026-10-11-junction-fallback-backup-sweep

## 动机

任务原话转写：junction 备份交换的半交换异常路径绕过降级 pull（24h 审查 P2-1）+ .pre-junction-backup-* 备份目录无清理无界增长（P3-1）：261dc22e9 后 spec-sync.ts ensureSpecJunction 在普通目录残留场景 rename(specDir→backup) 成功后，mkdir/symlink 裸抛异常直接飞出函数，而降级 pull 只覆盖 return false 路径——Windows symlink EPERM/EBUSY 等暂态或持久失败时该次 pull 整体失败且永不降级；备份目录全仓无删除路径（sweepStalePullScraps 只清 .tmp-/.trash-）。修复：post-rename mkdir+symlink 收进 try/catch，失败 warn 后 return false 走既有降级 pull（数据留在 backup 不丢）；sweepStalePullScraps 增 .pre-junction-backup- 前缀清扫（保留期 7 天，区别于 tmp/trash 的 10 分钟）。
成功标准：
- rename 成功后 symlink 抛异常（注入 EPERM）时 ensureSpecJunction 返回 false 并 warn，pullSpecBundle 走降级 pull 分支（spec_sync: repo_native_junction_blocked_fallback 日志可达）
- mkdir(dirname(specDir)) 抛异常同上收口，不再有裸异常飞出
- rename 自身失败仍走既有 return false 降级（零回归）
- 源项目 .sillyspec mkdir 失败（:153）保持 fail-loud 不降级——降级 pull 会重新引入平台标记投毒路径（261dc22e9 修的就是这个），此边界显式留档
- sweepStalePullScraps 清扫 7 天前的 .pre-junction-backup-* 目录；10 分钟内的备份不被误删
- .tmp-/.trash- 既有 10 分钟语义零回归；相关测试先红后绿全绿 + tsc 零错

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. rename 成功后 symlink 抛异常（注入 EPERM）时 ensureSpecJunction 返回 false 并 warn，pullSpecBundle 走降级 pull 分支（spec_sync: repo_native_junction_blocked_fallback 日志可达）
2. mkdir(dirname(specDir)) 抛异常同上收口，不再有裸异常飞出
3. rename 自身失败仍走既有 return false 降级（零回归）
4. 源项目 .sillyspec mkdir 失败（:153）保持 fail-loud 不降级——降级 pull 会重新引入平台标记投毒路径（261dc22e9 修的就是这个），此边界显式留档
5. sweepStalePullScraps 清扫 7 天前的 .pre-junction-backup-* 目录；10 分钟内的备份不被误删
6. .tmp-/.trash- 既有 10 分钟语义零回归；相关测试先红后绿全绿 + tsc 零错

## 成功标准（可验证）

1. rename 成功后 symlink 抛异常（注入 EPERM）时 ensureSpecJunction 返回 false 并 warn，pullSpecBundle 走降级 pull 分支（spec_sync: repo_native_junction_blocked_fallback 日志可达）
2. mkdir(dirname(specDir)) 抛异常同上收口，不再有裸异常飞出
3. rename 自身失败仍走既有 return false 降级（零回归）
4. 源项目 .sillyspec mkdir 失败（:153）保持 fail-loud 不降级——降级 pull 会重新引入平台标记投毒路径（261dc22e9 修的就是这个），此边界显式留档
5. sweepStalePullScraps 清扫 7 天前的 .pre-junction-backup-* 目录；10 分钟内的备份不被误删
6. .tmp-/.trash- 既有 10 分钟语义零回归；相关测试先红后绿全绿 + tsc 零错
