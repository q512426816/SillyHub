---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-duration-nan-guard

## 功能需求

### FR-01: duration_api_ms 差分入口改 Number.isFinite 门控（对齐同函数 total_cost_usd 既有口径），非有限值不进基线读写、payload 不携带该键（或保持 undefined 语义与既有「SDK 未报」路径一致），零新日志面

- `duration_api_ms` 差分入口必须在 `typeof === 'number'` 之外叠加 `Number.isFinite` 门控：NaN/Infinity 不得进 payload、不得写入/污染会话基线（后续合法快照不得因残留基线误差分）；有限值差分行为逐字不变；不新增日志/指标面。

#### 场景：NaN 不进 payload 不污染基线

- Given 首轮 resultMeta.duration_api_ms=NaN，次轮合法快照 12000
- When 两轮 onTurnResult
- Then 首轮 payload 不含 duration_api_ms 键，次轮 payload.duration_api_ms=12000（全量，证明基线未被污染）

### FR-02: 新增用例先红后绿：duration_api_ms=NaN 时 payload 不含 duration_api_ms 键且基线 Map 不被污染（后续合法值差分仍正确）；既有 duration 差分用例全绿

- NaN 用例必须在修复前为红（typeof 门放行 NaN → payload 含 NaN 且基线被污染致次轮差分为 NaN）；既有差分/复位/回收用例语义不变全绿。

#### 场景：先红后绿

- When 修复前运行 NaN 用例
- Then 红；修复后全绿

### FR-03: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-interactive-bridge.test.ts 全文件

- 本变更只必须运行该测试文件全文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行该测试文件
- Then 全部通过且 tsc --noEmit 零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 为 NaN → 不进差分不污染基线（Number.isFinite 门，对齐 total_cost_usd 口径，2026-10-12-duration-nan-guard）」
FR-02: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「duration_api_ms 为 NaN → 不进差分不污染基线（Number.isFinite 门，对齐 total_cost_usd 口径，2026-10-12-duration-nan-guard）」
FR-03: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts（全文件回归）
