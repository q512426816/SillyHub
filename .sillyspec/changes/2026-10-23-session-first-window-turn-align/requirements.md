---
author: flow-machine-draft
created_at: 2026-10-23T03:00:27.832Z
---
# 需求规格（Requirements）— 2026-10-23-session-first-window-turn-align

## 功能需求

### FR-01: 首屏加载后，窗口最旧行所在轮若被窗口截断，自动补拉该轮全量日志并装配，保证该轮 prompt 用户消息气泡在场

- 首屏历史加载**必须**由「固定 400 行硬窗口」改为「轮次对齐 + 预算自适应」：窗口最旧行所在轮被截断时**必须**补拉该轮（与窗口行合并去重，不删窗口已有行）；小会话（合并后总行数不超过预算）**必须**全量显示；向前补拉**必须**受三个硬上限约束——预算 3000 行、单轮直达 2000 行、单次最多 8 个更早轮（候选并行拉取，避免短轮会话串行数百次请求）；到达会话开头、预算耗尽或轮数上限后**必须**停止，并保留顶部「加载更早消息」入口。设计对齐 deepseek-harness 的「最小消息数 + 最小轮数 + 硬上限」自适应分页语义（其首屏为 50 条消息 / 2 轮 / 500 条消息上限）。

#### 场景：单轮超窗口全量显示

Given 会话整场仅 1 轮、日志 546 条，首屏窗口 400 条（生产会话 f815989f 实证）
When 用户重新进入会话
Then 该轮 546 条全部装配，轮首 user_input（用户提问）与后续回复均可见，无需点击「加载更早消息」

#### 场景：多轮会话自适应覆盖最近 2 轮

Given 会话 8 轮，最新轮 696 条日志，窗口起点落在最新轮中段
When 首屏加载
Then 补全最新轮并向前覆盖到上一完整轮，首屏至少显示最近 2 个完整轮次，最近一次用户发言可见

### FR-02: 已完整落在窗口内的轮次装配结果不变，零回归

- 已完整落在窗口内的轮次**禁止**重复直达补拉，其装配结果**必须**与改动前逐字段一致；向前补更早轮**必须**在到达会话开头、预算耗尽或触达单次 8 轮上限时停止，停止后**禁止**再发起任何直达请求（已到头的会话零额外请求）。

#### 场景：窗口已满足自适应条件

Given 首屏窗口起点轮完整且起点轮已是会话第一轮
When 首屏加载完成
Then 不发起任何 `{ runId }` 直达拉取，turns 与改动前一致

### FR-03: 直达拉取存在上限截断时按既有 okRuns 采纳闸降级，不静默丢窗口段最新内容

- 窗口起点轮的直达结果**必须**与窗口行合并去重（直达 ASC 上限截断丢尾部时，窗口尾部行保留）；向前补拉更早轮时，直达行数触达单轮上限 2000 条（可能截断）**必须**停止向前并不采纳该轮，避免在轮间留下无法回补的洞；**禁止**用截断行集覆盖或替换窗口已加载行；窗口起点轮直达不完整（行集最大时间戳早于底窗中该轮最新行）时，翻页游标**必须**保持底窗最旧行，**禁止**前移到轮首，否则轮首与底窗之间的中段缺口经「加载更早」永久不可回补。

#### 场景：直达截断安全降级

Given 某轮直达返回行数达到 2000 条上限
When 首屏自适应补拉执行
Then 窗口起点轮仍按合并结果装配（尾部不丢），更早轮停止补拉且 hasEarlier 保持为真，可由「加载更早消息」继续

### FR-04: 相关 vitest 全绿，tsc 零错

- 本次变更影响的 vitest 用例**必须**全绿，`tsc --noEmit` **必须**零错。

#### 场景：质量门

Given 变更完成
When 执行相关 vitest 与 tsc
Then 全部通过且零类型错误

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「首屏自适应：单轮日志超窗口 → 补全整轮，轮首用户消息进入首屏（FR-01）」
FR-01: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「小会话总行数不超预算 → 持续向前补到全量（评审 P1：不做 2 轮即停）」
FR-01: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「多轮窗口起点截断 → 补全该轮并向前覆盖最近 2 轮（FR-01）」
FR-02: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「首屏自适应：已到会话开头且起点轮完整 → 不发起单轮直达（FR-02）」
FR-02: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「已到会话开头且窗口起点轮完整 → 不发起直达补拉（FR-02）」
FR-02: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「向前补拉受轮数上限约束 → 只并行拉最近 maxRuns 个更早轮（评审 P2 请求量）」
FR-03: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「直达触达 2000 上限 → 与窗口行合并去重，不丢窗口尾部（FR-03）」
FR-03: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「向前补更早轮触达单轮上限 → 停止且不采纳该轮（避免轮间留洞，FR-03）」
FR-03: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「满页（400 条）→ 触顶自动加载更早 prepend + 加载提示；到头后触顶不再请求」（hasEarlier 保持为真的既有翻页回归）
FR-04: 不适用：汇总门，由上述用例与 tsc --noEmit 执行结果判定
