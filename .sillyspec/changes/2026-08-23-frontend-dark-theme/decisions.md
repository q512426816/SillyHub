---
author: qinyi
created_at: 2026-08-23 23:10:00
---
# 决策台账 — 2026-08-23-frontend-dark-theme

## D-001@v1 暗色作为第三主题

- type: 架构
- status: accepted
- source: brainstorm Step 3 用户选择（AskUserQuestion）
- question: 暗色主题与现有双主题（明亮蓝/AI紫）如何共处？
- answer: 作为第三个主题并列（blue / ai-native / dark 三选一），不做明暗×品牌独立维度四象限。
- normalized_requirement: ThemeName 联合类型扩 'dark'；切换控件三选一；localStorage 单键存储格式不变。
- impacts: themes.ts / theme-toggle.tsx / store 取值域 / layout 脚本白名单
- evidence: 现有双驱动架构（store persist + data-theme）天然支持 N 主题注册；四象限需两套暗色取值，成本翻倍且用户明确不要。
- priority: P0

## D-002@v1 首次访问跟随系统明暗

- type: 行为
- status: accepted
- source: brainstorm Step 3 用户选择（AskUserQuestion）
- question: 未选过主题时默认浅色还是跟随系统？
- answer: 跟随 prefers-color-scheme：系统暗色→dark，否则 ai-native；手动选择后以 localStorage 记录为准。不做运行中实时监听（非目标）。
- normalized_requirement: store merge 与 layout 防闪烁脚本成对实现「无记录时 matchMedia 判定」，兜底口径一致（异常→ai-native）。
- impacts: stores/theme.ts / app/layout.tsx
- evidence: 需求场景即「夜间自动舒适」；zustand persist 仅在 set 时写库，「无记录=从未选择」语义可靠。
- priority: P0

## D-003@v1 实现走扩展 data-theme 变量体系

- type: 架构
- status: accepted
- source: brainstorm Step 4 用户选择（方案对比 A/B/C）
- question: 暗色主题实现方案？
- answer: 方案 A——扩展现有 data-theme CSS 变量体系（第三套取值+变量块+slate 变量化+bg-white 清理+antd darkAlgorithm）。否决 B（dark: 前缀类，200+ 处散改且两套机制并行违反单一源）与 C（仅重映射语义变量，65 处 bg-white 卡片不变，夜间不达标）。
- normalized_requirement: 换肤唯一机制仍是 html data-theme + CSS 变量 + themes.ts 单一源。
- impacts: 全部文件（见 design §6 清单）
- evidence: 2026-08-20 主题系统即按多主题预留设计（D-101@v1 双驱动/D-102@v1 persist 边界），本变更是自然扩展。
- priority: P0

## D-004@v1 暗色取值 = Tailwind 默认阶对称翻转

- type: 设计
- status: accepted
- source: brainstorm Step 5 设计方案（用户确认）
- question: 暗色色阶怎么定？
- answer: slate 50↔900 / brand(violet) 50↔950 对称翻转；primary=violet-500(#8b5cf6)、hover 提亮 violet-400；accent cyan-600→cyan-400（两档）、语义色各提亮一档；bg/card/border=slate-900/800/700；全部 Tailwind v3 默认值，不自行调色。
- normalized_requirement: 现存 slate-*/brand-* 类名不改即得正确暗色对应；themes.test.ts 断言翻转对称性。
- impacts: themes.ts dark def / globals.css dark 块 / 原型
- evidence: 对称翻转让全站类名语义在明暗两态一致（浅底↔深底、深字↔浅字）；原型验证对比度达标（text-brand-600 暗色下≈7:1）。
- priority: P0

## D-005@v1 tailwind slate 阶变量化

- type: 架构
- status: accepted
- source: brainstorm Step 4/5 方案推演（方案 A 组成部分）
- question: slate 阶写死 hex 如何随主题换肤？
- answer: 改 var(--color-slate-*) 函数映射，照抄 brand 阶现成模式（含 color-mix 透明度分支）；globals.css :root 补声明，浅色取值与现状逐值相等。
- normalized_requirement: 浅色两主题观感零变化（测试断言逐值相等）；暗色翻转在变量层发生。
- impacts: tailwind.config.ts / globals.css / themes.test.ts
- evidence: brand 阶同模式已稳定运行；slate 是暗色全站生效的关键路径（~100 处类名零改动受益）。
- priority: P0

## D-006@v1 antd dark 经 darkAlgorithm

- type: 实现
- status: accepted
- source: brainstorm Step 5 设计方案（用户确认）
- question: antd 组件暗色适配走哪条路？
- answer: dark 主题时 ConfigProvider algorithm=theme.darkAlgorithm（antd 组件灰阶自动适配）；组件 token（表头/行悬浮/Menu 选中 brand-50 等）继续查 themes[theme].color 表，不加 if 分支——翻转阶自动给出深紫底亮紫字。
- normalized_requirement: antd-providers 仅增 algorithm 三元；token 查表逻辑不动。
- impacts: antd-providers.tsx
- evidence: darkAlgorithm 是 antd v5+ 官方暗色路径（项目 antd ^6.4.4）；查表复用避免 token 双轨。
- priority: P1

## D-007@v1 dark 固定调色板工具类覆盖层

- type: architecture
- status: accepted
- source: execute Wave 2 实证（task-08 报告发现 + 主代理量化 grep）
- question: 全站 260 处固定调色板状态色类（bg-red-50 等八族，95 文件，§9 错误条模板产物）在 dark 下如何处理？
- answer: 在 globals.css 的 [data-theme="dark"] 块内追加工具类覆盖（.bg-red-50 等选择器特异度 0,2,0 胜过 tailwind 0,1,0），仅 dark 生效浅色零影响；映射规则：bg 50→950/100→900、border 200→900/300→800、text 500→400/600 与 700→300/800→200，全部 Tailwind v3 默认值；覆盖集=grep 实际使用清单，非全阶。
- normalized_requirement: FR-01「无残留刺眼浅色块」达成；浅色两主题渲染零变化（覆盖选择器仅 dark 命中）；映射规则写入 globals.css 注释供后续类按规则补。
- impacts: frontend/src/app/globals.css（task-02 文件增补）；design.md §5.2 ⑤
- evidence: grep 实证 bg-red-50=128/bg-amber-50=45/bg-emerald-50=28 等共 260 处 95 文件；text/border 配套类同分布；选择器特异度规则保证覆盖生效且隔离。
- priority: P1
