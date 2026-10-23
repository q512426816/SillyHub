---
author: flow-machine-draft
created_at: 2026-10-22T23:40:11.769Z
---
# 设计记录（Design Record）— 2026-10-23-semantic-color-scale-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：左栏「在等你」琥珀点（`bg-warning-500`）与 agent-log 活性徽章（`info/warning/destructive` 的 50/200/500/700 数字阶）使用的类名在 `tailwind.config.ts` 中未定义——`warning`/`info`/`destructive` 只有 DEFAULT + foreground，Tailwind 对这些类静默不生成 CSS，导致状态点透明、徽章软底/描边/深字全丢（全仓仅 liveness-badge.tsx 与 session-list-panel.tsx 使用，globals.css 无手工定义、无 safelist、无插件补足）。

解法（纯配置、调用点零改动）：在 tailwind config 中为三个调色板各补 50/200/500/700 四个数字键。500 直接用既有语义变量 `hsl(var(--warning))`（与 DEFAULT 同值，语义一致）；50/200 以 `color-mix` 向 `hsl(var(--background))` 混出软底（浅色主题为淡彩、深色主题为暗彩）；700 向 `hsl(var(--foreground))` 混出前景字色（浅色加深、深色提亮）。这样三套主题块（purple/blue/dark）无需新增变量，颜色随 `data-theme` 自动切换，也不引入硬编码 hex，符合「双主题铁律：全部走语义色阶，无硬编码色值」。

选择 color-mix 而非补 hex 色阶的理由：globals.css 只在主题块定义基色变量（`--warning`/`--info`/`--destructive`），没有分档变量；写死 Tailwind amber/red/cyan 的 hex 会在双主题下失去语义（深色主题下软底/文字对比会错），且违反既有 token 约定。config 中 brand/slate 已采用函数式 color-mix 派生 alpha，本方案与其同构。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 对外 API/组件 props/类名使用面零变化：只新增 Tailwind 配置键，不改任何调用点（liveness-badge.tsx / session-list-panel.tsx 零 diff）。
- 新增配置键：`colors.warning.{50,200,500,700}`、`colors.info.{50,200,500,700}`、`colors.destructive.{50,200,500,700}`；`DEFAULT`/`foreground` 逐字保留。
- 生成物：无（tailwind 配置在构建期消费，无类型/契约生成物）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用：纯静态样式配置，无运行时输入/事件；颜色值在构建期固化，与事件顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：单一构建期配置文件，无并发写面；多会话并行开发时 git 冲突按常规处理（本变更只新增颜色键，冲突面极小）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：主题切换（`data-theme`）由既有 CSS 变量机制驱动，新增数字阶全部引用同一批变量，切换时随变量重算；无需 JS 状态或重挂载。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：前端构建配置，无跨仓/跨实例数据面；sillyhub-daemon 有独立 tailwind 配置时不受影响（本变更只改 frontend 仓内配置）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`color-mix` 的混合比例是目测估算（10%/35%/50%），与传统 Tailwind amber-50/200/700 的观感存在细微差异；且低版本浏览器不支持 color-mix 时数字阶声明失效（项目既有 brand/slate 透明度已使用 color-mix，基线浏览器要求一致，不新增兼容风险）。缓解：700 档已按评审 P2 以 WCAG AA 复算把基色占比从 75% 降到 50%（两套浅色主题 × 三调色板对 bg-50 的最小对比度从 3.08:1 提升到 5.07:1，全部 ≥4.5:1），并以真实构建 + 对比度复算固化；若某档观感偏差大，后续调比例即可（单点改动）。

试过但放弃的方案：
- 改调用点为 DEFAULT 单色（`bg-warning-500`→`bg-warning`）——只能救实心点，救不了徽章的「软底+描边+深字」三档设计，等于降级视觉；且要改两个组件多点，回归面更大。放弃。
- 在 globals.css 为三套主题各补 12 个分档变量——变量块膨胀 36 行且与「基色变量派生」的既有约定重复，主题新增/调整时需同步多处。放弃。
- 直接写死 Tailwind 默认 amber/red/cyan hex 阶——违反对照原型与「无硬编码色值」铁律，深色主题对比会失真。放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/tailwind.config.ts | warning/info/destructive 各补 50/200/500/700（color-mix 派生）；brand/slate 既有函数色阶补 `as unknown as Record<string, string>` 类型断言（tsc 首次纳入该文件检查所需，运行时零变化） |
| 新增 | frontend/src/lib/__tests__/tailwind-semantic-colors.test.ts | 三调色板数字阶存在性/派生形态 + DEFAULT 零漂移断言 |
| 新增 | .sillyspec/changes/2026-10-23-semantic-color-scale-fix/visual-evidence.md | 真实 tailwind 构建验证记录（类名生成 grep 结果） |
