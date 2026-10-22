# 视觉证据 — 2026-10-22-conversation-live-marquee

> UI 变更执行须知（真码契约）：原型与实现同方言。本变更使用项目现有
> Next.js + Tailwind 管线，直接引用实现组件 `TurnLiveMarquee` 渲染原型页，
> 无手绘单文件。

## 原型

- 路由：`frontend/src/app/proto/session-live-marquee/page.tsx`（dev-only，不进导航）
- 入口：`http://localhost:3000/proto/session-live-marquee`（`pnpm dev`）
- 数据：脚本模拟 SSE 事件流（思考 / 工具 / 子代理及内部工具 / stderr / 文件），
  与真实 `TurnSegment` 同构；跑马灯为实际组件 `TurnLiveMarquee` + 真实纯函数
  `deriveLiveMarqueeEntries`。
- 可切换：AI 紫（默认）/ 经典蓝 / 暗夜三主题；暂停/继续事件流；重置。

## 截图（真码渲染，Playwright Chromium 1440×1000 @2x）

- `.proto-staging/marquee-ai.png`：AI 紫整页
- `.proto-staging/marquee-blue.png`：经典蓝整页
- `.proto-staging/marquee-dark.png`：暗夜整页
- `.proto-staging/marquee-bar.png` / `marquee-bar-zoom.png`：跑马灯局部特写

## 对照结论

1. 单行胶囊、状态点、类别图标、条目文案、右侧 LIVE 标识在三主题下均清晰可读。
2. 修正记录：
   - 暗夜主题下 `text-foreground/80` 未生效导致文字偏暗 → 改 `text-foreground`；
   - 左向 mask 渐隐把首两个字（如「警告」）淡化 → 移除 mask，仅保留 truncate；
   - 字号 11 → 12px + `font-medium`，小字号下中文可读性提升；
   - 容器高度 28 → 32px，背景改 `bg-card`，与正文区拉开层次。
3. 动效（2026-10-23 两轮用户反馈后定稿）：
   - 取消「2.2 秒/条停留轮播」→ 改为单行连续滚动轨道，事件到达即进入、
     有多少刷多少；
   - 取消「最近 12 条循环回放」→ 轨道内容不复制、不回跳，只向左推进，
     滚到最新一条右端贴住视口右缘即停；首次打开直接定位到最新；
   - 速度按追赶距离自适应（基础 180px/s，上限 1600px/s）；空档期由容器
     3.6s 低频流光 + 运行状态点维持感知（reduced-motion 全部关闭）。
   - 轨道条目等宽（13rem）+ truncate，保证滚动宽度稳定、长文本不撑破。

## 待用户裁决

- 连续流动速度（基础 180px/s，积压时加速到 1600px/s）观感是否合适。
- 条目等宽 13rem + 截断（约 18 个中文字符）是否可接受。
- 跑马灯与轮头状态条右侧「当前活动」有信息重叠，是否保留状态条摘要（暂保留）。
- 是否需要「暂停/展开详情」交互（当前定位为纯感知，不提供交互）。

> 用户裁决：
> - 2026-10-22：节奏改为按反馈内容直接渲染、有多少刷多少、一直刷。
> - 2026-10-23：保持流动但不循环，只流到最新一条。
> - 2026-10-23：交互形态定为「纯感知、不交互」，用户明确授权直接完成实现与收口。
> 速度/条目宽度按当前实现定稿（基础 180px/s 自适应、条目等宽 13rem 截断）。

## 实现核验

- 接入：`turn-timeline.tsx` 的 `SegmentedTurnBody` 对话视图运行中轮尾（思考占位之后）；
  进度/轨迹视图、终态轮、旧回退路径均不挂载。
- 测试：`turn-live-marquee.test.tsx` 13 用例通过；turn-timeline 相关回归 5 文件 45 用例通过。
- 质量门：`tsc --noEmit` 通过；改动文件 ESLint 无告警。
