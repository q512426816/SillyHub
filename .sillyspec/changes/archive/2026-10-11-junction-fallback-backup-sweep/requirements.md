---
author: flow-machine-draft
created_at: 2026-10-11T04:11:49.668Z
---
# 需求规格（Requirements）— 2026-10-11-junction-fallback-backup-sweep

## 功能需求

### FR-01: rename 成功后 symlink 抛异常（注入 EPERM）时 ensureSpecJunction 返回 false 并 warn，pullSpecBundle 走降级 pull 分支（spec_sync: repo_native_junction_blocked_fallback 日志可达）

- junction 备份交换的半交换路径（rename(specDir→backup) 成功后）的 `mkdir(dirname(specDir))` 与 `symlink(...)` 调用**必须**整体收进 try/catch：任一抛异常时 warn（`spec_sync: junction_create_failed_fallback`）并 `return false`，使 `pullSpecBundle` 走既有降级 pull 分支；**禁止**裸异常飞出函数绕过降级（24h 审查 P2-1：Windows symlink EPERM/EBUSY 等失败时该次 pull 整体失败且永不降级）。

#### 场景：半交换 symlink 失败降级

- Given repo-native 工作区、缓存为普通目录残留（含旧数据）、源项目有 .sillyspec
- When symlink 抛 EPERM（测试注入）
- Then 旧数据完整保留在 backup 目录；warn 含 junction_create_failed_fallback 与 repo_native_junction_blocked_fallback；init lease 结果 ok=true（经降级 pull，getSpecBundle 被调）

### FR-02: mkdir(dirname(specDir)) 抛异常同上收口，不再有裸异常飞出

- 半交换后 `mkdir(dirname(specDir), {recursive:true})` 抛异常**必须**与 FR-01 同一 try/catch 收口（同一降级路径）；同一 catch 覆盖两调用，**禁止**分别裸抛。

#### 场景：mkdir 失败同降级

- When mkdir(dirname(specDir)) 抛错（测试注入）
- Then 行为与 FR-01 场景一致（return false + 降级 pull）

### FR-03: rename 自身失败仍走既有 return false 降级（零回归）

- `renameWithRetry(specDir→backup)` 失败路径**必须**保持既有 `return false` 降级语义逐字不变（261dc22e9 既有行为零回归）。

#### 场景：rename 失败

- When rename 重试穷尽仍失败（既有 catch）
- Then warn `junction_backup_rename_failed_fallback` + return false（既有断言不改动即覆盖）

### FR-04: 源项目 .sillyspec mkdir 失败（:153）保持 fail-loud 不降级——降级 pull 会重新引入平台标记投毒路径（261dc22e9 修的就是这个），此边界显式留档

- repo-native 分支的 `mkdir(sourceSillyspec)` 失败**必须**保持异常上抛（调用方 catch 记日志）；**禁止**为它加降级——降级 pull 会把缓存落回普通目录、使 sillyspec CLI 自指守卫失效、重新打开 261dc22e9 收口的平台标记投毒面。该边界为显式设计取舍，非遗漏。

#### 场景：源项目根只读

- When 源项目 .sillyspec 不存在且 mkdir 失败
- Then 异常上抛（fail-loud），不落降级 pull

### FR-05: sweepStalePullScraps 清扫 7 天前的 .pre-junction-backup-* 目录；10 分钟内的备份不被误删

- `sweepStalePullScraps` **必须**增配 `.pre-junction-backup-` 前缀（保留期 7 天，mtime 判定），到期备份 best-effort 删除；**禁止**误删保留期内的备份；且 `pullSpecBundle` 顶部（策略分支之前）**必须**也执行一次清扫——既有调用点（pull 主路径中段）在 repo-native junction 成功早返回路径上永远不执行，清扫必须覆盖该路径。

#### 场景：repo-native 成功路径清扫过期备份

- Given repo-native 工作区、同级存在 mtime 8 天前的 .pre-junction-backup-* 与 10 分钟内的同名前缀备份、mtime 11 分钟的 .tmp- 与 5 分钟的 .tmp-
- When handleInitLease repo-native 成功（junction 早返回）
- Then 8 天备份与 11 分钟 tmp 被清；10 分钟备份与 5 分钟 tmp 保留

### FR-06: .tmp-/.trash- 既有 10 分钟语义零回归；相关测试先红后绿全绿 + tsc 零错

- tmp/trash 既有 10 分钟清扫语义**必须**零回归；本变更新增用例在旧实现上**必须**先红（半交换降级用例与备份清扫用例）、实现后全绿；`tsc --noEmit` 零错。

#### 场景：先红后绿

- When 在旧实现上运行 FR-01/FR-05 新用例
- Then 失败（红）；实现后全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/test_init_lease.test.ts「半交换 symlink 失败降级 pull：数据留 backup + 双 warn 可达」
FR-02: test/sillyhub-daemon/tests/test_init_lease.test.ts「半交换 mkdir 失败同降级」
FR-03: test/sillyhub-daemon/tests/test_init_lease.test.ts「repo-native 残留备份交换（既有用例零改动回归）」
FR-04: test/sillyhub-daemon/tests/test_init_lease.test.ts「源缺失不降级（既有用例零改动回归）」
FR-05: test/sillyhub-daemon/tests/test_init_lease.test.ts「repo-native 成功路径清扫过期备份/保留期内不误删」
FR-06: test/sillyhub-daemon/tests/test_init_lease.test.ts「备份清扫：tmp/trash 10 分钟语义零回归」
