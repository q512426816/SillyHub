# 决策知识 — spec-sync

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-10-repo-native-no-platform-markers
锚点：未记录
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c
理由：- 最大风险：给用户源项目建空 `.sillyspec` 是对源项目的写操作——但 repo-native 语义即「扫描直接写源项目」，创建工作区时 ⚠ 警示已明示，属授权范围内最小写面（仅空目录）。次风险：备份目录在 specs/ 根堆积（每次策略切换最多一个），低频可接受，注释明示。 - 放弃的方案：① 改 sillyspec CLI 加 `--strategy` flag 显式跳过三写——跨仓接口变更，且自指守卫已存在，修前置条件即可闭合，不扩战线；② isSelfReferentialSpecRoot 在 cwd/.sillyspec 不存在时弱化判定（resolve 字符串比对）——junction 路径字符串本就不等，弱判定不可靠，治标不治本；③ 普通目录残留直接 rm 后建 junction——违背 R-01 防误删原则（残留可能含历史托管数据），rename 备份保数据。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-11-junction-fallback-backup-sweep
锚点：未记录
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714
理由：最大风险：7 天保留期是拍的工程值——太长磁盘压力延续、太短丢人工检查窗口；选 7 天依据是「缓存快照 + repo-native 真数据在源项目」的双重冗余，误删后果有限。声明边界：repo-native 分支 `mkdir(sourceSillyspec)` 失败保持 fail-loud 不降级——降级 pull 会把缓存落回普通目录、sillyspec CLI 自指守卫（realpath 穿透 junction）失效、重新打开 261dc22e9 收口的平台标记投毒面；fail-loud 由调用方 catch 记日志，会话无 spec 缓存但不投毒，两害取轻（可接受：投毒写脏源项目 vs 本会话读不到 spec）。 放弃的方案：① symlink 失败时回滚（rename backup→specDir 复原）——回滚 rename 同样可能 EBUSY 失败，引入第二层半交换态，复杂度不划算；降级 pull 重建 specDir 等价且更简单。② 清扫复用 10 分钟保留期——备份是完整数据快照非 in-flight 残留，10 分钟等于变相「删备份」，与 261dc22e9「数据不丢」的承诺冲突。
