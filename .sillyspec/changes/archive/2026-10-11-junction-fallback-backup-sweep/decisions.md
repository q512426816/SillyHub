---
author: flow-machine-draft
created_at: 2026-10-11T04:30:18.066Z
---
# 决策记录（Decisions）— 2026-10-11-junction-fallback-backup-sweep

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：7 天保留期是拍的工程值——太长磁盘压力延续、太短丢人工检查窗口；选 7 天依据是「缓存快照 + repo-native 真数据在源项目」的双重冗余，误删后果有限。声明边界：repo-native 分支 `mkdir(sourceSillyspec)` 失败保持 fail-loud 不降级——降级 pull 会把缓存落回普通目录、sillyspec CLI 自指守卫（realpath 穿透 junction）失效、重新打开 261dc22e9 收口的平台标记投毒面；fail-loud 由调用方 catch 记日志，会话无 spec 缓存但不投毒，两害取轻（可接受：投毒写脏源项目 vs 本会话读不到 spec）。 放弃的方案：① symlink 失败时回滚（rename backup→specDir 复原）——回滚 rename 同样可能 EBUSY 失败，引入第二层半交换态，复杂度不划算；降级 pull 重建 specDir 等价且更简单。② 清扫复用 10 分钟保留期——备份是完整数据快照非 in-flight 残留，10 分钟等于变相「删备份」，与 261dc22e9「数据不丢」的承诺冲突。
