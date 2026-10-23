---
author: flow-machine-draft
created_at: 2026-10-23T06:18:54.173Z
---
# 需求规格（Requirements）— 2026-10-23-marquee-blank-track-fix

## 功能需求

### FR-01: 条目达到 200 条上限后，每次窗口滑动只平滑前进一条，位移不得累积越过内容边界

- 达到条目上限后，窗口滑动（淘汰最旧 + 追加最新）时**必须**把滚动目标回到「最新条贴住右缘」的基准位置（base），**禁止**在上一次目标基础上继续累减。
- 视觉连续**必须**通过「先把当前 offset 右移一条抵消 DOM 内容左移，再平滑滚回 base」实现；offset **必须**保持在 `[base, 0]` 区间内。
- 新增纯函数 `resolveMarqueeTarget(base, previousTarget, slideStep)` 承载该规则：
  - `slideStep != null` → 返回 `base`；
  - 否则 → 返回 `min(previousTarget, base)`（普通内容增长只向更负推进、不回滚）。
- 长会话持续新增事件时，跑马灯**必须**始终显示最近条目，**禁止**出现空白轨道。

#### 场景：超过 200 条后继续新增

- Given 轨道已有 200 条并停在最新位置
- When 第 201 条到达触发窗口滑动
- Then 目标回到 base，offset 补偿并平滑前进一条；屏幕上仍有内容且最新条最终可见

#### 场景：连续多次滑动

- Given 长时间运行，窗口已连续滑动多次
- When 继续新增事件
- Then 目标每次都回到 base，位移不累积、不越界，轨道持续有内容

### FR-02: 长会话持续新增事件时，跑马灯始终能显示最近条目，不再出现空白轨道

- 真实会话中事件总数超过 200 条后，跑马灯**必须**保持可见内容；仅状态点与 LIVE 的空白条**禁止**出现。
- 原型页**必须**提供“长会话（210 条）”演示入口，用于快速复现与核验。

#### 场景：真实长会话

- Given 会话已运行数十分钟、过程事件超过 200 条
- When 观察对话视图轮尾跑马灯
- Then 轨道显示最近条目，不空白

### FR-03: 新增回归测试模拟 200→201 条滑动，断言轨道位移不越界；现有 23 用例通过

- **必须**新增 `resolveMarqueeTarget` 的单元测试，覆盖：滑动时回到 base、普通增长只向更负、连续滑动不累积。
- 现有 23 个跑马灯用例**必须**全部通过。
- 前端 lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成修复
- When 运行相关测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「窗口滑动目标回到 base，连续滑动不累积越界（FR-01）」
FR-02: 不适用：真实长会话渲染依赖浏览器布局与滚动，jsdom 无法复现；已用原型“长会话（210 条）”入口 + Playwright 核验
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道速度随距离缓出，接近目标时减速（FR-01）」+「窗口滑动目标回到 base，连续滑动不累积越界（FR-01）」（整文件 24 用例通过；lint / typecheck 另行核验）
