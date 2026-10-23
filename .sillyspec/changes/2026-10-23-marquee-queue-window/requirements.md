---
author: flow-machine-draft
created_at: 2026-10-23T06:34:13.008Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-queue-window

## 功能需求

### FR-01: 只保留最近12条过程事件，更早的直接丢弃，渲染条目数恒定不超过12

- `deriveLiveMarqueeEntries` **必须**只返回最近 `LIVE_MARQUEE_MAX_ENTRIES`（12）条；更早条目**必须**直接丢弃，不进入渲染队列。
- 轨道渲染条目数**必须**恒定 ≤ 12；**禁止**保留历史上限（200）导致的长列表。
- 窗口满后新事件到达时**必须**淘汰最旧一条、追加最新一条（队列语义）；已滚出窗口的内容**禁止**回看。

#### 场景：普通会话

- Given 当前只有 5 条过程事件
- When 渲染跑马灯
- Then 轨道显示 5 条，不额外补位

#### 场景：长会话

- Given 已产生 210 条过程事件
- When 渲染跑马灯
- Then 只保留最近 12 条，DOM 条目数为 12

### FR-02: 轨道总宽收敛到约3.3k px，不再出现数万px宽轨道

- 12 条 ×（16rem + gap）**必须**使轨道总宽收敛在约 3.3k px 量级；**禁止**出现 5 万 px 级轨道。
- 窗口满后滑动**必须**保持视觉连续：offset 先补偿一条再平滑滚回 base；**禁止**跳变、回跳、循环。
- 首挂载**必须**直接定位到最新内容附近，不从头回放。

#### 场景：窗口滑动

- Given 轨道已满 12 条并停在最新
- When 第 13 条事件到达
- Then 最旧一条被丢弃，轨道平滑前进一条，最新条最终可见

### FR-03: 更新上限相关测试并全部通过，lint与typecheck通过

- 上限相关测试**必须**由 200 更新为 12（含截断用例与滑动触发条件）。
- 全部 24 个跑马灯用例**必须**通过。
- 前端 lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「条目超过上限时只保留最近 12 条」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「窗口滑动目标回到 base，连续滑动不累积越界（FR-01）」+「轨道按顺序完整渲染全部条目，不复制内容循环」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 整文件 24 用例通过；lint / typecheck 另行核验
