---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-backup-sweep-name-ts

## 功能需求

### FR-01: sweepStalePullScraps 对 .pre-junction-backup-* 条目按 max(mtimeMs, 目录名内嵌创建时刻) 计龄（内嵌 ts 为创建时 Date.now()，13 位数字后缀，解析失败回落 mtime），双信号均老才清扫——保守方向，绝不误删任一信号新鲜的备份

- 备份条目计龄必须取 `max(lstat().mtimeMs, 目录名尾部内嵌时间戳)`（内嵌 ts 可解析且更大时用内嵌值），超 7 天保留期才清扫；内嵌 ts 解析失败必须回落 mtime（与旧行为一致）；tmp/trash 残留 10 分钟语义零变化。

#### 场景：盖戳失败组合不误删

- Given 备份目录名内嵌 ts 新鲜、mtime 为继承的 30 天旧值（utimes 盖戳失败形态）
- When 清扫执行
- Then 备份保留（7 天人工窗口有效）

#### 场景：双旧仍清

- Given 内嵌 ts 与 mtime 均超 7 天
- When 清扫执行
- Then 备份被清（磁盘无界增长防线不弱化）

### FR-02: 新增用例先红后绿：①备份名内嵌 ts 新鲜 + mtime 30 天旧（盖戳失败形态）→ 清扫后仍在（修复前被删）；②内嵌 ts 8 天旧 + mtime 新鲜 → 仍在（保守语义钉）；既有「8 天清/10 分钟留」与盖戳证据用例语义不变

- 用例①必须在修复前为红（按 mtime 判龄会删）修复后为绿；用例②钉 max 语义的保守方向；既有清扫用例（8 天备份清/新鲜备份留/tmp 10 分钟/盖戳 mtime<60s 证据）必须全绿不改语义。

#### 场景：先红后绿

- When 修复前运行用例①
- Then 红（备份被清扫）；修复后绿

### FR-03: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/test_init_lease.test.ts 全文件

- 本变更只必须运行该测试文件全文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/test_init_lease.test.ts「清扫计龄 max(mtime, 名内嵌创建时刻)——盖戳失败形态（名新 mtime 老）不误删、名老 mtime 新保守保留（2026-10-12-backup-sweep-name-ts）」
FR-02: sillyhub-daemon/tests/test_init_lease.test.ts「清扫计龄 max(mtime, 名内嵌创建时刻)——盖戳失败形态（名新 mtime 老）不误删、名老 mtime 新保守保留（2026-10-12-backup-sweep-name-ts）」
FR-03: sillyhub-daemon/tests/test_init_lease.test.ts（全文件回归，含既有 sweep 用例）
