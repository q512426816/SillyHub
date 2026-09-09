---
author: qinyi
created_at: 2026-09-09 11:46:42
---

# 决策记录（Decisions）

## D-001@v1: P0 成果直接复用不返工
- type: premise
- priority: P0
- status: accepted
- source: code
- question: 完整焕新是否推翻 P0（ql-20260909-009）已落地的气泡/代码块/composer 改动
- answer: 不推翻。P0 已定气泡宽度 80%、shadow-primary、深色代码块、composer 阴影，本变更在其上叠加 P1/P2
- normalized_requirement: 本变更不回滚 turn-timeline.tsx / turn-segment-views.tsx / markdown-text.tsx / globals.css --codeblock-* / session-input-bar.tsx 的 P0 改动
- impacts: [FR-全部, task-全部]
- evidence: commit aca101718

## D-002@v1: 三主题一致性约束
- type: boundary
- priority: P0
- status: accepted
- source: docs
- question: 焕新样式如何兼容 blue/ai-native/dark 三主题
- answer: 一切取值走 themes.ts/CSS 变量 token；禁止组件散落 hex；dark 主题 brand 阶翻转特性（brand-600=亮青）在选色时必须逐主题核对对比度
- normalized_requirement: 新增/修改的样式类仅使用 brand-* 语义阶、语义色 token、主题阴影 token；hex 只允许进 themes.ts 或 globals.css 主题变量块
- impacts: [FR-全部, task-全部, verify-?]
- evidence: FRONTEND_PAGE_STYLE.md §0.5、.claude/CLAUDE.md 规则 20

## D-003@v1: 消息形态 = 气泡 + 头像
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: Agent 消息展现形态（气泡+头像 vs Claude 式文档流）
- answer: 用户选定「气泡 + 头像」——现有气泡骨架保留，agent 消息加品牌渐变头像（Bot/引擎图标），用户消息维持右对齐品牌色气泡
- normalized_requirement: v2 段路径（SegmentedTurnBody）与旧回退路径的 agent 文本气泡左侧均挂头像；用户气泡右对齐样式不变
- impacts: [FR-01, task-?]
- evidence: 2026-09-09 AskUserQuestion 第 1 问用户选择「气泡 + 头像（推荐）」

## D-004@v1: 范围含群聊面板
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 是否顺带统一群聊面板观感
- answer: 会话页 + 群聊一起改——group-chat-panel 的消息行同步焕新（头像/气泡层级/代码块已由 MarkdownText 共享自动获益）
- normalized_requirement: 群聊时间线行的视觉层级（头像/气泡/阴影）与单聊一致；两面板共用可复用的头像/气泡构件
- impacts: [FR-01, FR-05, task-?]
- evidence: 2026-09-09 AskUserQuestion 第 2 问用户选择「会话页 + 群聊一起改」

## D-005@v1: dark 主题底色一起调
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 深色主题层级对比是否动 themes.ts 主题底色
- answer: 连主题底色一起调——dark 主题 card/border 取值微调拉大页面底与卡片反差（themes.ts darkTheme + globals.css dark 变量块同步，取值仍限 Tailwind v3 zinc 阶默认值）；全站受益，回归面经 build+主页面实拍控制
- normalized_requirement: dark 主题 card/bg 亮度差拉大（候选：card zinc-800→zinc-800 保持、bg zinc-900→zinc-950，或 card→zinc-700/60 方向——设计稿定稿时锁定，取值必须为 Tailwind 默认值）；themes.ts 与 globals.css 三处同步
- impacts: [FR-06, task-?, verify-?]
- evidence: 2026-09-09 AskUserQuestion 第 3 问用户选择「连主题底色一起调」

## D-006@v1: 实现方案 = 抽共享聊天构件（方案 B）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 焕新实现路径——A 各组件内直改（快但样式三处拷贝）/ B 抽共享 chat 构件（单聊群聊同源）/ C 只动样式层（做不了结构化焕新）
- answer: 用户选定方案 B——新建 frontend/src/components/chat/ 共享构件（ChatMessageAvatar / 轮次分隔胶囊 / 运行态徽标等），单聊（turn-timeline + turn-segment-views）与群聊（group-chat-panel）统一消费；不选 A（样式三处拷贝易漂移）、不选 C（达不到焕新目标）
- normalized_requirement: 单聊与群聊的消息头像/气泡观感出自同一共享构件源码，不允许两处拷贝实现
- impacts: [FR-01, FR-05, task-?]
- evidence: 2026-09-09 AskUserQuestion 方案选择轮，用户选「B：抽共享聊天构件（推荐）」

## D-007@v1: 高级感设计语言（v2 原型定调）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: v1 原型用户反馈「还是不够有高级感」，高级感从哪些杠杆来
- answer: v2 原型定调六根杠杆——①环境极光背景（品牌色径向渐变光晕，浅/dark 双套取值）；②多层弥散阴影替代硬边框（边框统一降透明 --border-soft）；③玻璃拟态（顶栏/面板头/列表列 backdrop-blur + saturate）；④渐变点睛收敛到三处：标题「智能体」渐变字、agent 光环头像、发送按钮；⑤macOS 风深空代码块（三色窗点+语言标签+复制钮）；⑥微交互（发送钮 hover 浮起/点击回弹、plus 钮 hover 渐变填充、composer 聚焦光环+弥散阴影）
- normalized_requirement: 落地时阴影/光晕/边框透明度全部走 globals.css token（--border-soft/--shadow-glow 等新增共享 token），不在组件写死 rgba 散值；dark 主题同构双套取值
- impacts: [FR-全部, task-?]
- evidence: 2026-09-09 用户对 v1 原型反馈「不够高级」→ v2 原型（prototype-sessions-visual-refresh.html 重写）

## D-008@v1: v3 修正——玻璃可读性 + 删流光顶条
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 用户看 v2 反馈「玻璃拟态没看出来」「panel-accent 流光条好丑」
- answer: ①玻璃拟态不可读的根因是极光只铺内容区、玻璃面板底下是纯色底没有东西可透——v3 把极光铺满整个应用底（body background-attachment: fixed），侧栏/列表列/面板整体降透明 + backdrop-blur，玻璃下有色彩可透才读得出玻璃感；②panel-accent 渐变流光顶条整体删除——运行态氛围收敛为脉冲状态点 + 任务条 spinner 两个既有元素，克制优先，不再加新动效载体
- normalized_requirement: 落地时极光背景挂在应用壳（dashboard layout / 页面容器）而非单页内容区；侧栏/列表列/会话面板用半透明 + backdrop-blur；不实现任何形式的面板顶部渐变条/流光动画
- impacts: [FR-02, FR-04, task-?]
- evidence: 2026-09-09 用户对 v2 原型反馈「玻璃拟态没看出来；panel-accent running 什么玩意好丑」

## D-009@v1: v4 自查修正（用户要求"你自己看看效果图"后的逐项自审）
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 用户要求 AI 自审 v3 效果图——自查出的问题与修法
- answer: 自审五条——①浅色下用户气泡紫色面积太大太吵（max-width 76%→72% + shadow-primary 降重：阴影 alpha 减半）；②composer 聚焦光环 v3 过浓且原型硬编码常驻焦点态（dark 下呈 RGB 霓虹圈游戏感）——改 3px/10% 透明度柔环、阴影不再跳档、原型展示常态；③列表/导航选中态两主题都太弱——inset 描边从 border-soft 换品牌色 22%/30% 透明度（--row-active-ring 新 token）；④浅色右上极光泛紫过浓（13%→9%）；⑤dark 极光太弱整体死黑（四团光晕各加 3-4 个百分点）
- normalized_requirement: 落地 token 口径——shadow-primary 两主题降重取值随本决策；选中态描边走 --row-active-ring 语义 token；composer 聚焦环 3px/10% 品牌色
- impacts: [FR-01, FR-03, FR-05, task-?]
- evidence: 2026-09-09 用户贴 v3 双主题截图要求自审
