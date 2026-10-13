---
author: flow-machine-draft
created_at: 2026-10-13T16:57:00.479Z
---
# 需求规格（Requirements）— 2026-10-14-ci-flaky-probe-mock

## 功能需求

### FR-01: 「连续 before 翻页到头」用例 mock 必须对 limit=1 页顶探查返回空响应且不计入 beforeCursors

- mock 必须区分 `limit === 1` 的页顶探查请求（0bd70bc47 轮边界对齐引入，非翻页本体）：返回空响应且不得 push 进 `beforeCursors`，口径同同文件 105 行既有先例；
- 探查之外的处理逻辑（翻页游标记账、older1/older2 页序）必须保持原样。

#### 场景：满页翻页含探查的完整序列

- Given：mock 对带 before 的翻页返回 older1（400 满页）与 older2（100 不满页）
- When：点击回到会话开头直至到头
- Then：实际 API 序列为 翻页(limit=400) → 探查(limit=1) → 翻页(limit=400)，而 beforeCursors 只含 2 次翻页游标且单调递减

### FR-02: 该用例及同文件全部 11 用例必须本地转绿，且断言不再依赖竞速窗口

- 修复后 `beforeCursors.length` 必须是翻页本体的单调稳定值（0→1→2 后不再变化），`waitFor(toBe(2))` 必须命中终态而非微任务级瞬态窗口；
- 禁止改动组件与生产代码。

#### 场景：CI 慢机下断言稳定

- Given：探查调用不再计入计数
- When：waitFor 以 5s 上限轮询 `beforeCursors.length === 2`
- Then：计数到达 2 后恒定（探查不回填、循环已到头停止），断言不再依赖检查时机

### FR-03: 零生产代码改动

- 禁止触碰 `frontend/src/` 非测试文件；允许面仅限 `session-history-scroll.test.tsx` 与 SillySpec 治理工件。

#### 场景：交付面审查

- Given：flow done 冻结面采集 baseline..HEAD
- When：审查 diff 文件清单
- Then：仅含该测试文件与 .sillyspec 治理工件

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部（FR-03）」
FR-02: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部（FR-03）」
FR-03: 不适用：负向约束面——由冻结面 diff 文件清单审查保证，非测试可判定
