---
author: flow-machine-draft
created_at: 2026-10-23T01:35:34.775Z
---
# 设计记录（Design Record）— 2026-10-23-marquee-item-detail

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在已归档的 `2026-10-22-conversation-live-marquee` 基础上细化单条目表现，仍只改 `frontend/src/components/daemon/turn-live-marquee.tsx` + `globals.css` + 测试：

1. **图标**：`LiveMarqueeEntry` 去掉 `glyph` 字符串，渲染层用 `icon` 枚举映射 `lucide-react` 组件（Brain / Terminal / FileText / Search / Bot / FileUp / AlertTriangle / Info / Minimize2 / MessageSquare / Bell）。单色 `currentColor`，走主题 token。
2. **进行中 vs 完成**：
   - running：右侧 CSS 转圈（同 `TurnStatusBar` 的圆环视觉：`border-primary/25 border-t-primary animate-spin`），文本区用 `.sh-live-marquee-ticker` 双份内容横向循环（CSS animation，12s/循环，不触发 React 逐帧渲染）；
   - done/failed：停止滚动，文本单份 `truncate`，右侧显示 `Timer` 图标 + `formatMarqueeDuration(durationMs)`；无耗时不显示。
3. **耗时来源**：
   - 工具/子代理：纯函数 `deriveLiveMarqueeEntries` 直接用段 `startedAt` / `endedAt` 求差（仅两者都有且差 ≥ 0 时写入 `durationMs`）；
   - thinking 等无结束时刻：组件用 `runtimeStartedAtRef` 在首次观察到 running 时记录起点，观察到完成时算客户端时长并写入 `runtimeDurationRef`（`useState` 快照触发一次重渲染）；挂载时已经完成的条目没有起点，不显示时长（不伪造）。
4. **布局**：条目固定宽 `16rem`；内部三栏「固定图标 + 可滚动/截断文本（`min-w-0 flex-1`）+ 固定转圈/耗时」，只有文本区滚动。

依据：
- `frontend/src/components/daemon/turn-live-marquee.tsx`（现有轨道/派生实现）
- `frontend/src/components/daemon/turn-status-bar.tsx`（既有 CSS 转圈视觉）
- `frontend/src/components/daemon/turn-segment-views.tsx`（lucide 图标使用惯例）
- `frontend/src/app/globals.css`（动画 utility + reduced-motion 降级先例）

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `LiveMarqueeEntry` 字段变更：
  ```ts
  export interface LiveMarqueeEntry {
    id: string;
    icon: LiveMarqueeIcon;
    text: string;
    status: "running" | "done" | "failed" | "neutral";
    /** 段真实开始/结束时刻（tool/subagent 可得；thinking 为 null）。 */
    startedAt: number | null;
    endedAt: number | null;
    /** 服务端权威时长（仅 startedAt/endedAt 均可信时有值）。 */
    durationMs: number | null;
  }
  ```
  `glyph: string` **移除**（emoji 字符串不再作为图标）。
- 新增导出 `formatMarqueeDuration(ms: number): string`（`<1s → 820ms` / `<60s → 1.5s` / `≥60s → 1m 05s`）。
- `TurnLiveMarqueeProps` 签名不变（`entries` / `reducedMotion`）。
- `globals.css` 新增 `.sh-live-marquee-ticker` 动画与 reduced-motion 关闭规则。
- 后端 API / daemon 协议 / `api-types.ts` / `openapi.json`：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。条目顺序仍由装配器段文档序决定；工具时长来自段自身 `startedAt/endedAt`，与到达顺序无关。客户端思考计时只在观察到 running→done 的连续生命周期内成立；迟到且已完成的段没有起点 → 不显示时长（宁缺勿假）。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无新增写面。组件只读 props，计时 Map 与用时快照仅存在于组件内存；多标签页/多会话各自独立。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。组件卸载时 effect cleanup 释放 rAF / IntersectionObserver；计时 Map 随实例销毁。运行中途卸载再挂载时，客户端计时会从新挂载点重新开始——这是显式边界：实时轮通常持续挂载，刷新/切换后若该轮已完成则不显示耗时，不会伪造完整时长。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不会。计时键使用当前轮次段 id（含子代理路径前缀），只消费当前 `entries`。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：条目内部滚动与轨道滚动叠加造成视觉噪声。缓解：只有 running 条目内部滚动（通常 1~3 条），完成条目静止；轨道速度仍按追赶距离自适应。
- 短文本循环重复感：用双份文本 + 固定窗口，文本很短时会出现重复片段；属纯感知场景的可接受取舍（用户不需要看清）。
- 时长准确性：thinking 为客户端观测时长，受挂载时机影响（边界已在上文披露）；工具/子代理使用段真实时刻，不伪造。
- 放弃方案：① 继续用 emoji 图标（用户明确要求项目 lucide 图标）；② JS 逐帧滚动内部文本（与轨道 rAF 叠加成本高，改用 CSS animation）；③ 用「当前时间 − 段 ts」填充历史思考耗时（会伪造，违反宁缺勿假）；④ 条目加交互展开（用户已裁决纯感知不交互）。
