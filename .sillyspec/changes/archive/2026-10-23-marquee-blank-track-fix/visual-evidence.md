# 视觉证据 — 2026-10-23-marquee-blank-track-fix

## 现象

真实长会话（运行数十分钟、过程事件超过 200 条）中，对话视图轮尾跑马灯只剩状态点与 LIVE，
轨道内容整体被推出视口（用户截图 2026-10-23）。

## 根因

`applyTarget` 在「达到 200 条上限后的窗口滑动」分支执行 `next = min(previousTarget, base) - step`。
每新增一条事件滑动一次，目标就在上一次目标基础上再减一条宽；累计后 target/offset 超过 track 内容总宽，
整条轨道被推出视口。

## 修复

- 新增纯函数 `resolveMarqueeTarget(base, previousTarget, slideStep)`：滑动时目标**回到 base**；
  普通内容增长仍只向更负推进。
- 滑动瞬间先把 offset 右移一条（clamp ≤ 0）抵消 DOM 内容左移，再由 rAF 平滑滚回 base——
  每次滑动只前进一条，位移不累积。
- 原型页新增「长会话（210 条）」入口，并强制重挂载跑马灯，模拟刷新后直接加载 200+ 历史事件。

## 核验（Playwright Chromium，真码原型）

- 点击「长会话（210 条）」后：`items=200`、`trackWidth=55180px`、`viewportWidth=759px`；
- 轨道位移 `-54177px`，合法下界 `-54421px`——**未越界**，且已定位到最新内容附近；
- 截图 `.proto-staging/marquee-long-session.png`：可见工具/子代理条目、转圈与耗时，不空白；
- 回归测试：`turn-live-marquee.test.tsx` 24 用例通过（新增滑动目标用例）；
- lint / typecheck 通过。
