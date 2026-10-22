---
author: flow-machine-draft
created_at: 2026-10-22T15:18:57.704Z
---
# 设计记录（Design Record）— 2026-10-22-conversation-live-marquee

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯前端展示层变更，数据源就是现有 `TurnSegment[]`（SSE 实时装配，进度视图同源），后端 / daemon / API 零改动。

新增组件 `frontend/src/components/daemon/turn-live-marquee.tsx`，拆成两部分：

1. **纯函数 `deriveLiveMarqueeEntries(segments)`**：递归遍历段树，产出一维有序条目列表（`{ id, icon, glyph, text, status }`）。thinking / tool / subagent（含 children 内部工具）/ file / stderr / preamble / compact / compact_status / user_msg / turn_trigger 各映射为一条；`text` 答复段跳过。以段 id 为键去重——流式增长的思考、状态翻转的工具只更新原条目。超过 200 条截断最旧。
2. **`TurnLiveMarquee` 组件**：单行连续滚动轨道（2026-10-23 用户反馈修订）。不做逐条停留轮播，也不复制内容循环——条目按时间顺序等宽排列，第一次挂载直接定位到最新内容；新事件到达后轨道只向左推进，滚到最新一条右端贴住视口右缘即停，旧内容滑出、新内容从右侧进入。滚动由单条 `requestAnimationFrame` 直接写 `transform` 实现（不触发 React 每帧渲染），速度按追赶距离自适应（基础 180px/s，上限 1600px/s）。空档期由容器内低频流光与运行状态点维持感知。组件不可见（IntersectionObserver）或 `prefers-reduced-motion` 时停表 / 静态展示最新条。视觉走现有语义 token 与 globals.css 动画 utility 惯例（同 `.sh-typing-dots` / `.sh-stream-caret`）。

接入点在 `turn-timeline.tsx` 的 `SegmentedTurnBody`：`viewMode === "conversation" && isLiveTurn(turnStatus) && entries.length > 0` 时，渲染于 `convoTimeline` 之后、`ThinkingPlaceholder` 之前。进度/轨迹视图、终态轮、旧回退路径均不挂载。

依据：
- `frontend/src/components/daemon/turn-timeline.tsx`（`SegmentedTurnBody` 双视图分支、`isConversationSegment`、`ThinkingPlaceholder`）
- `frontend/src/components/daemon/session-log-assembler.ts`（`TurnSegment` 段模型）
- `frontend/src/components/daemon/turn-status-bar.tsx`（`deriveTurnActivity` 纯函数先例 + 每秒 tick 仅组件内部 state 的渲染经济性约定）
- `frontend/src/app/globals.css`（`.sh-typing-dots` / `.sh-stream-caret` / `prefers-reduced-motion` 降级先例）
- `.sillyspec/docs/frontend/modules/components-daemon.md`（turn-timeline / session-panel 契约）
- `.sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md`（主题 token 铁律）

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出（`turn-live-marquee.tsx`）：
  ```ts
  export type LiveMarqueeIcon =
    | "thinking" | "tool" | "subagent" | "file"
    | "stderr" | "system" | "compact" | "user" | "wakeup";

  export interface LiveMarqueeEntry {
    /** 段 id（子代理内部段带父路径，保证树内唯一）。 */
    id: string;
    icon: LiveMarqueeIcon;
    /** 单行展示图标（emoji；工具按 processLabel 类别区分，保留七类词表语义）。 */
    glyph: string;
    text: string;
    status: "running" | "done" | "failed" | "neutral";
  }

  export function deriveLiveMarqueeEntries(
    segments: TurnSegment[],
  ): LiveMarqueeEntry[];

  export interface TurnLiveMarqueeProps {
    entries: LiveMarqueeEntry[];
    /** 测试/降级注入；缺省走 IntersectionObserver + matchMedia。 */
    reducedMotion?: boolean;
  }
  export const TurnLiveMarquee: React.MemoExoticComponent<
    (props: TurnLiveMarqueeProps) => JSX.Element | null
  >;
  ```
- 导出常量：`LIVE_MARQUEE_MAX_ENTRIES = 200`、`LIVE_MARQUEE_BASE_SPEED = 180`、`LIVE_MARQUEE_MAX_SPEED = 1600`。
- `turn-timeline.tsx`：`SegmentedTurnBody` 内部新增局部派生与渲染，不新增对外 props、不改 `TurnTimelineProps`。
- `globals.css`：新增 `.sh-live-marquee`（相对定位 + 低频流光伪元素）与 `sh-live-marquee-sheen` keyframes，附 `prefers-reduced-motion` 覆盖。
- 后端 API / daemon 协议 / `api-types.ts` / `openapi.json`：**无变化**，无需 `pnpm gen:types`。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。组件不自行排序，只按装配器给出的段文档序入队，与「进度」视图同源；迟到段追加到队尾并可能在下一拍展示，不丢、不崩。段 id 去重保证同一段不会因多次装配重复入队。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无新增写面。组件只读 `segments` props，无网络请求、无本地持久化；多标签页各自独立渲染。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。轮次终态或切视图时组件不渲染，`cancelAnimationFrame` / `IntersectionObserver.disconnect` 在 effect cleanup 中释放；会话切换随父层重挂载重置。SSE 断线重连重建 segments 时按 id 去重，不累积旧条目。React StrictMode 双跑 effect 由 cleanup 兜底。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。只消费当前轮次传入的 `segments`，无全局 store、无跨会话缓存。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：流式高频更新导致派生/重渲染成本。缓解：派生 `useMemo` 只依赖 `segments` 引用，条目上限 200；滚动由单条 rAF 直接写 `transform`，不触发 React 每帧 state 更新；组件 `memo` 隔离。
- 交互风险：跑马灯持续动效可能干扰阅读。缓解：单行低矮、低调配色、`aria-live="off"` 不打扰读屏；终态立即消失；用户上滚使轮尾离开视口时 IntersectionObserver 自动停表。
- 视觉风险：窄屏下超长工具参数撑破。缓解：条目等宽 13rem + `truncate` + `min-w-0`，轨道容器 `overflow-hidden`，整行不产生横向滚动。
- 动画正确性风险：轨道内容变化（新增条目）时目标位置需重算，否则最新条可能停不进视口。缓解：`entries` 变化即重算 target，只向更负方向推进、不回滚；首次挂载直接定位到最新。
- 放弃方案：① 吸底悬浮（用户明确选择"运行中轮末尾"）；② 多行信息牌 / 竖向事件流（用户选择单行横向跑马灯）；③ 每条思考 delta 都入队（会刷屏，改为按段 id 就地去重）；④ 复用「进度」视图的完整时间线（信息密度过高，违背"不必看清"的目标）；⑤ 固定节奏逐条停留 + 循环回放（用户裁决改为连续流动、不循环、只流到最新）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 新增 | frontend/src/components/daemon/turn-live-marquee.tsx | 纯函数派生 + 单行轮播组件 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | SegmentedTurnBody 对话视图轮尾接入 |
| 修改 | frontend/src/app/globals.css | 跑马灯动画 utility + reduced-motion 降级 |
| 新增 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx | 纯函数 + 组件测试 |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-*.test.tsx | 对话/进度视图接入断言（按现有测试文件就近追加） |
| 新增 | .sillyspec/changes/2026-10-22-conversation-live-marquee/visual-evidence.md | UI 真码渲染对照记录 |
