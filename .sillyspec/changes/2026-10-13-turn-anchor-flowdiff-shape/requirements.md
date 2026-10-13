---
author: flow-machine-draft
created_at: 2026-10-13T15:46:23.344Z
---
# 需求规格（Requirements）— 2026-10-13-turn-anchor-flowdiff-shape

## 功能需求

### FR-01: TurnAnchorRecord 新增 totals：files 行数与 additions/deletions 加总（null 不计入），落盘记录携带，既有七用例零改动全绿

- - 系统 MUST 达成该条标准行为（协议夹具行为句）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: toFlowDiffShape 导出纯函数：输入记录返回 rows 与 totals（rows=files 原样，totals 同上语义），可直测

- - 系统 MUST 达成该条标准行为（协议夹具行为句）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: typecheck 绿；新用例覆盖 totals 计算（含 null 行）与投影形状

- - 系统 MUST 达成该条标准行为（协议夹具行为句）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: 不改 JSONL 既有字段与追加格式（additive：旧读者忽略新字段）

- - 系统 MUST 达成该条标准行为（协议夹具行为句）

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「totals：落盘记录携带且 null 行不计入（既有七用例零改动）」
FR-02: sillyhub-daemon/tests/interactive/turn-anchor.test.ts「toFlowDiffShape：投影形状与重算兜底（存量无 totals 记录）」
FR-03: pnpm typecheck（sillyhub-daemon）
FR-04: sillyhub-daemon/tests/interactive/turn-anchor.test.ts 既有断言零改动全绿
