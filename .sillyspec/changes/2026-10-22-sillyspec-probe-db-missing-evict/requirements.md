---
author: zcode-agent
created_at: 2026-10-22T15:16:34.258Z
---
# 需求规格（Requirements）— 2026-10-22-sillyspec-probe-db-missing-evict

## 功能需求

### FR-01: progress show 失败且 stdout envelope codes 含 db_missing 时，连续 3 次后该工作区根从采集目标淘汰（回调通知 daemon 删 _sillyspecStatusRoots 并持久化），不再探测、心跳 map 清除该槽位，日志留 evicted 记录

- `progress show --json` 非零退出且 stdout envelope `codes` 含 `db_missing` 时（项目侧永久缺库，非瞬态），**必须**按 cwd 计连败次数；连续 **3** 次**必须**：淘汰该目标（若 workspaceId 非空则回调 evict 通知 daemon 删除 `_sillyspecStatusRoots` 条目并持久化 roots 文件）、清心跳 map 对应槽位、打 `sillyspec_status_root_evicted` 日志，此后对该 cwd **禁止**再发起探测；淘汰路径**禁止**计入 `_recordStatusError` 瞬态失败（对齐跨仓跳过语义）。

#### 场景：连续 db_missing 后淘汰
- Given workspaceId=d2c7f421 的根连续 3 次返回 exit 2 + codes=[db_missing]
- When 第 3 次采集完成
- Then evict 回调收到 (d2c7f421, rootPath)；后续轮次不再对该 cwd 运行 CLI；心跳 `sillyspec_status_map` 不含该槽位

#### 场景：淘汰后重新 claim 恢复采集
- Given 该工作区根已被淘汰
- When daemon 在该工作区重新 claim（`_noteSillySpecStatusRoot` 注册同名根）
- Then 恢复对该根的正常采集（skip 表不再拦截）

### FR-02: 非 db_missing 的非零退出保持既有 nonzero_exit 记账不变，且日志附带 stdout 首行便于诊断

- 非 db_missing 的非零退出**必须**保持既有行为（`sillyspec_status_nonzero_exit` warn + `_recordStatusError('nonzero_exit')`），且 warn 日志**必须**附带 stdout 首行（≤200 字符）；db_missing 连败未达 3 次期间**必须**打 `sillyspec_status_db_missing` warn（带连败计数），且不计瞬态失败。

#### 场景：未知非零退出
- Given progress show 返回 exit 3 且 stdout 为空
- When 采集收口
- Then 记 `nonzero_exit` 瞬态失败，日志含 `stdout_head` 字段，不触发淘汰

### FR-03: 采集成功重置连败计数；淘汰后若根被重新 claim 注册则恢复采集

- 同一 cwd 采集成功（exit 0）**必须**清空其连败计数。

#### 场景：成功重置
- Given 某 cwd 已有 2 次 db_missing 连败
- When 该根采集成功能正常渲染
- Then 连败计数清零，后续再有 db_missing 需重新计满 3 次才淘汰

### FR-04: daemon 定向测试全绿，既有采集/降级语义零回归

- **必须**补齐 manager 定向测试（淘汰/计数重置/未知退出记账）；既有跨仓跳过、超时、能力缺失等语义**必须**零回归。

#### 场景：回归
- Given 既有 manager 测试面
- When 运行定向测试
- Then 全绿（含新增用例）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/sillyspec-manager.test.ts「db_missing 连续 3 次 → 第 3 次淘汰（evict 回调/心跳槽位清除/日志），第 4 轮不再探测」
FR-02: sillyhub-daemon/tests/sillyspec-manager.test.ts「非 db_missing 非零退出：保持 nonzero_exit 记账、日志带 stdout_head、不淘汰」
FR-03: sillyhub-daemon/tests/sillyspec-manager.test.ts「采集成功重置连败计数：2 次失败 → 成功 → 再 2 次失败不淘汰」
FR-04: sillyhub-daemon/tests/sillyspec-manager.test.ts「db_missing 连续 3 次 → 第 3 次淘汰（evict 回调/心跳槽位清除/日志），第 4 轮不再探测」
