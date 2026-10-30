---
author: flow-machine-draft
created_at: 2026-10-30T00:49:06.115Z
---
# 需求规格（Requirements）— 2026-10-30-marquee-awaiting-loop-scroll

## 功能需求

### FR-01: marquee-awaiting 条目文本区为双份文本无缝循环滚动：恒速慢速（72px/s 量级）、滚满一份宽度即回卷、任意时刻窗口不出现空白区段

- marquee-awaiting 条目（id="marquee-awaiting"）的运行态文本区必须渲染为双份相同文本拼接（第二份 aria-hidden），rAF 以恒速 72px/s（TICKER_LOOP_SPEED 常量，允许 ±10%）向左平移，offset 达到一份周期宽度（文本宽+间隔）时必须加回周期宽度回卷，保证任意时刻滚动窗口内禁止出现空白区段（现状"一次滚到末尾即停+末尾后空白"的根除项）。

#### 场景：主路径

- Given 会话运行中、最新真实条目非 running（LLM 生成间隙），跑马灯追加 marquee-awaiting 条目且未开启减少动态效果
- When 条目渲染并起排
- Then 文本区 DOM 含两份相同文本，translate3d 持续向 0 以下推进，达到 -周期宽度 时回卷加回周期宽度，循环往复；窗口内始终有文字，不出现末尾空白区段

#### 场景：文本实时变化（秒数/token 每秒更新、>30s 追加提示语）

- Given 循环滚动进行中
- When entry.text 变化导致一份宽度改变
- Then 重测周期宽度并将 offset 折回 [-周期宽度, 0] 区间内继续滚，不中断循环、不越界

#### 场景：短文本（一份文字 ≤ 窗口宽，如等待初期无 token/心跳数据）

- Given 文本宽未超滚动窗口（如「等待模型响应 · 1.2s」）
- When 测量起滚宽度
- Then 必须不起滚（loopScrollWidth=0，静止显示开头）——短文本循环滚动右缘会露空白（一份填不满窗口，评审 P2 修复）；文本增长超窗后自然起滚

### FR-02: 循环滚动尊重 prefers-reduced-motion（静态截断）

- 系统开启"减少动态效果"时，marquee-awaiting 条目必须与现状一致走静态截断分支（不渲染滚动 ticker、不转圈），禁止启动循环滚动。

#### 场景：主路径

- Given matchMedia("(prefers-reduced-motion: reduce)") 命中
- When 渲染 marquee-awaiting 条目
- Then 无 marquee-ticker 双份文本、无 rAF 起排，静态截断展示

### FR-03: 其他 running 条目（thinking 流式等）保持现有单份一次滚行为不变

- 除 marquee-awaiting 外的 running 条目必须保持现有行为：单份文本、从开头一次滚到当前末尾即停、跟随流式增长继续滚（220px/s 起步/落后加速），禁止受本变更影响改变滚动语义；相关既有测试断言（单份文本、不循环）必须原样通过。

#### 场景：主路径

- Given thinking 流式条目 running
- When 渲染与滚动
- Then ticker 仍为单份文本、终点仍为文本末尾贴窗口右缘即停，现有测试用例不改断言全绿

### FR-04: turn-live-marquee 现有测试不回归，新增用例覆盖循环模式渲染与回卷纯函数

- 本变更合入后 frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 既有用例必须全绿（不修改既有断言），并必须新增用例覆盖：marquee-awaiting 双份文本渲染、回卷纯函数 wrapLoopOffset 的边界（区间内不动/越下界回卷/宽度变化折回）。

#### 场景：主路径

- Given main 基线上该测试文件全绿
- When 本变更合入
- Then 既有用例不回归，新增用例覆盖上述三点并全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「等待条目循环滚动：双份文本渲染 + wrapLoopOffset 回卷纯函数」
FR-02: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下等待条目静态截断（沿用既有 reduced 分支，新增 awaiting 场景断言）」
FR-03: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「ticker 一次滚到末尾即停、不复制循环，跟随流式增长（FR-02）」（既有用例不改断言）
FR-04: test/frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「turn-live-marquee.test.tsx 全量用例（本文件）回归」
