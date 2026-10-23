---
author: flow-machine-draft
created_at: 2026-10-23T06:18:54.173Z
---
# 设计记录（Design Record）— 2026-10-23-marquee-blank-track-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

**根因**：`applyTarget` 在「达到 200 条上限后的窗口滑动」分支执行
`next = min(previousTarget, base) - step`。每新增一条事件都会滑动一次，目标就在上一次目标基础上再减一条宽度，
长期运行后 target/offset 无限负向，超过 track 内容总宽，整条轨道被推出视口——只剩状态点与 LIVE。

**修复**：把目标规则抽成纯函数 `resolveMarqueeTarget`：

- 滑动（`slideStep != null`）→ 目标**回到 base**（最新条贴右缘的位置），不再累减；
- 普通内容增长 → `min(previousTarget, base)`（只向更负，不回滚）。

视觉连续性由 offset 补偿实现：滑动瞬间 DOM 内容整体左移一条，先把 `offset += step`（并 clamp ≤ 0）
抵消视觉跳变，再把目标设为 base，由现有 rAF 缓出从补偿后的 offset 平滑滚回 base——每次滑动只前进一条，
位移不累积。原型页新增「长会话（210 条）」入口用于复现与核验。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出：
  ```ts
  export function resolveMarqueeTarget(
    base: number,
    previousTarget: number,
    slideStep: number | null,
  ): number;
  ```
- `applyTarget` 内部改为使用该函数，并在滑动时补偿 `offsetRef` 后立即写一次 transform。
- 组件 props、其余导出、后端 API / daemon 协议：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。滑动识别基于首条 id 变化（窗口已满时），与事件内容顺序无关；目标始终回到 base。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无写面；仅组件内 ref。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。offset 补偿只在 initialized 后写 transform；卸载时 rAF cleanup 不变。内容未满一屏时滑动分支不会触发。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不涉及数据；每个组件实例独立 ref。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：offset 补偿瞬间若测量宽度为 0（字体未加载/隐藏容器），step 回退 208，可能有一次轻微跳动；已在 clamp 与 rAF 缓出下弱化。
- 放弃方案：① 每次滑动直接重置 offset=base（画面会瞬移一条，不流畅）；② 无限保留历史条目（DOM 无界增长）；③ 用 CSS 循环轨道（无法满足“只到最新不循环”）。
