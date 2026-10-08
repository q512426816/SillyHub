# 视觉证据（visual-evidence）— 2026-10-08-turn-nav-hover-mark

## 变更性质

既有组件（TurnNavList 轮次导航）的交互状态补充：悬停窄轨刻度（横条）时，浮层内给对应轮次行加「指向标记」。非新页面 / 非新形态 / 非布局改版——浮层结构、行内容、active 高亮样式零改动，仅新增一个条件类（ring 描边）与 hover 事件接线。

## 视觉方案与 token 依据

- 指向标记：`ring-1 ring-inset ring-brand-400`（细描边）。
  - token 先例：同文件浮层行既有 `focus-visible:ring-1 focus-visible:ring-brand-400`（键盘焦点描边，2026-09-28 形态引入）——本变更复用同 token 阶，视觉语言一致。
  - 与 active 高亮的区分：active 行 = `bg-muted/60` 底色 + `shadow-[inset_2px_0_0_0_var(--color-brand-600)]` 左竖线（既有）；指向行 = ring 描边。两语义正交可叠加（指向行恰好也是 active 行时，描边 + 底色并存），仅描边不加底色，避免与行既有 `hover:bg-muted/50` 同型打架。
  - 多主题：brand-* 语义阶随 `html data-theme` 换肤（themes.ts 单源），零硬编码色值，符合前端样式铁律。

## 验证方式

- 渲染对照采用组件级 DOM 断言（jsdom 无法呈现描边像素，实页截图对本变更无增量信息——改动是纯条件类叠加，样式 token 全部为既有先例类）：
  - `turn-nav-list.test.tsx`「悬停刻度：浮层指向行 data-hovered + ring 描边；与 active 当前轮高亮视觉区分」：断言指向行 className 含 `ring-inset`、active 行含 `bg-muted/60` 且不含 `ring-inset`（用 `ring-inset` 而非 `ring-brand-400` 作判据——后者是全部行常驻的 `focus-visible:ring-brand-400` 子串，不唯一）。
  - 19/19 用例全绿（14 既有 + 5 新增），既有视觉行为（active 高亮 / hover 底色 / pin / 收起）零回归。

## 降级裁决

无降级——实现与方案一致，无结构收敛 / 范围缩小 / 样式统一级偏离。
