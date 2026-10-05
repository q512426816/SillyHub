## FR-styles-001 agent 回复文本无框化（双路径一致）
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：v2 段模型文本段（主路径）；旧数据回退路径；连续多文本段
依据决策：D-001@v1、D-002@v1、D-004@v1、D-005@v1
场景正文：
- 场景：v2 段模型文本段（主路径） — Given 会话时间线渲染含 text 段的 turn（segments 非 undefined）；When TextSegmentView 渲染文本段；Then 容器为 `.seg-text-body`：无 border/底色/阴影/气泡内边距，铺在时间线背景上，max-width 为 min(100%, 48rem)；
- 场景：旧数据回退路径 — Given 孤儿 turn / 旧会话数据（segments undefined）且有 output 答复；When 旧路径渲染答复；Then 容器同为 `.seg-text-body` 无框样式，内容自适应宽度（不取 w-full），行尾时间戳仍尾随内容边缘；与 v2 路径视觉形态一致
- 场景：连续多文本段 — Given 一轮内多个 text 段（可能直接相邻）；When 渲染为多个 `.seg-text-body`；Then 段间由既有 space-y 间距分隔，可辨识边界；不新增分隔线/背景块装饰
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-01
最近确认：fbbf02f4b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulct608:frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-09-20-agent-reply-no-bubble
  status: active

## FR-styles-002 mobile 可读性规则随类名迁移
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：默认场景
依据决策：D-003@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 会话时间线以 mobile 变体渲染（data-variant="mobile"）；When agent 文本段显示；Then `.seg-text-body` 应用 font-size 14px / line-height 24px；规则不携带 max-width 覆盖（阅读限宽由 m
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-02
最近确认：fbbf02f4b

## FR-styles-003 用户侧气泡完全不变
变更：2026-09-20-agent-reply-no-bubble
状态：active
摘要：用户消息气泡；轮内引导消息三态气泡
依据决策：D-001@v1
场景正文：
- 场景：用户消息气泡 — Given 会话时间线渲染用户消息（turn.prompt）；When 用户气泡渲染；Then 类名 `.turn-bubble` 与品牌色右对齐气泡样式与改前一致
- 场景：轮内引导消息三态气泡 — Given 轮内 steering 引导注入的 user_msg 段（steering/delivered/ended 三态）；When 引导消息渲染；Then 三态气泡样式与类名与改前一致（不因本变更变化）
全文：.sillyspec/changes/archive/2026-09-20-agent-reply-no-bubble/requirements.md#FR-03
最近确认：fbbf02f4b

## FR-styles-004 暗色主题（dark）全站可用
变更：2026-08-23-frontend-dark-theme
状态：superseded
superseded_by：FR-styles-009
取代链：FR-styles-004 ← FR-styles-009（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 用户处于任一页面（列表页/工作区/会话/监控/登录页） dark 主题下的 antd 组件（Table/Menu/Tabs/Modal/Form 等）；When 切换到 dark 主题 渲染或交互（悬浮/选中/聚焦）；Then 页面底、卡片、边框、表格、表单、弹窗、菜单、气泡、图表文字全部呈现暗色取值（bg=zinc-950 系，slate 阶=zinc 翻转），无残留纯白大色块；品牌强调为亮青（brand-600=cyan-400 #22d3ee，ql-20260824-014 去紫改青）
全文：.sillyspec/changes/archive/2026-08-23-frontend-dark-theme/requirements.md#FR-01
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulctb26:frontend/src/styles/themes.test.ts
  tests: frontend/src/styles/themes.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-08-23-frontend-dark-theme
  status: superseded

## FR-styles-005 三主题切换控件与记忆
变更：2026-08-23-frontend-dark-theme
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 顶栏主题切换按钮（Palette 图标） 用户已手动选择任一主题；When 点击 刷新页面
全文：.sillyspec/changes/archive/2026-08-23-frontend-dark-theme/requirements.md#FR-02
最近确认：6a6cc9fc6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcth8e:frontend/src/stores/theme.test.ts
  tests: frontend/src/stores/theme.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-08-23-frontend-dark-theme
  status: active

## FR-styles-006 首次访问跟随系统明暗
变更：2026-08-23-frontend-dark-theme
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given localStorage 无 `sillyhub-theme` 记录（从未手动选择） localStorage 无记录且系统为浅色 matchMedia 不可用；When 打开页面且系统为暗色模式（prefers-color-scheme: dark） 打开页面 打开页面；Then 首帧直接呈现 dark 主题（防闪烁脚本判定，React hydrate 后不回跳浅色） 默认 ai-native 主题（现状不变） 回落 ai-native（
全文：.sillyspec/changes/archive/2026-08-23-frontend-dark-theme/requirements.md#FR-03
最近确认：6a6cc9fc6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulctomc:frontend/src/stores/theme.test.ts
  tests: frontend/src/stores/theme.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-08-23-frontend-dark-theme
  status: active

## FR-styles-007 浅色两主题零回归
变更：2026-08-23-frontend-dark-theme
状态：superseded
superseded_by：FR-styles-009
取代链：FR-styles-007 ← FR-styles-009（2026-09-26-core-pages-visual-redesign 承接）
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given blue 或 ai-native 主题；When 本变更上线后渲染任意页面；Then slate 阶 CSS 变量取值与现状逐值相等；bg-card 场景仍为纯白；斑马纹/spinner 等修正点在浅色下与现状视觉等值；观感与上线前一致
全文：.sillyspec/changes/archive/2026-08-23-frontend-dark-theme/requirements.md#FR-04
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulctuly:frontend/src/styles/themes.test.ts
  tests: frontend/src/styles/themes.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 473c0b3113e666b6e068323b092fd5467ee889a2
  source_change: 2026-08-23-frontend-dark-theme
  status: superseded

## FR-styles-008 primer 共享组件库
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景；StateLabel 六变体
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given frontend/src/components/primer/ 目录新建完成；When 任意页面 import primer 组件；Then MUST 提供 StateLabel/Counter/UnderlineNav/IssueRow/Timeline/MetaPanel/PageHead/Sta
- 场景：StateLabel 六变体 — Given StateLabel 的 variant 取 open/merged/attention/done/error/neutral 任一；When 渲染；Then MUST 输出浅底深字细边框胶囊（含 12px 状态图标 withIcon 默认 true），色值经 themes.ts semantic soft 阶；thi
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-01
最近确认：f41468b59

## FR-styles-009 themes.ts semantic soft 阶扩展
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given themes.ts 现有 semantic 五档单值结构；When 扩展 soft 浅底阶；Then 三主题（blue/ai-native/dark）MUST 各配 soft 值（dark 用语义色半透明底模式）；既有 semantic 单值字段 MUST 保留
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-02
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-core-pages-visual-redesign:task-01:acc-0-75fae08a
  tests: frontend/src/styles/themes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active
- row: 2026-09-26-core-pages-visual-redesign:task-01:acc-1-69bbfc29
  tests: frontend/src/styles/themes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active
- row: 2026-09-26-core-pages-visual-redesign:task-01:acc-2-8da07d1b
  tests: frontend/src/styles/themes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active

## FR-styles-010 变更中心列表页重排
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户进入工作区变更中心页；When 页面渲染；Then MUST 呈现四层结构（面包屑→PageHead 标题+计数+主按钮→工具条→UnderlineNav 状态 tab+IssueRow 列表）；antd Tab
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-03
最近确认：f41468b59

## FR-styles-011 变更详情页重排
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户进入某变更详情页；When 页面渲染；Then MUST 呈现六阶段 checks 横条（当前阶段高亮、可点筛选，阶段-时间线联动语义承接）+ 左主列 Timeline（事件流+Agent 执行日志内嵌可折叠
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-04
最近确认：f41468b59

## FR-styles-012 工作区列表页重排
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户进入工作区选择页；When 页面渲染；Then MUST 呈现 Repositories 行式列表（状态点+名称+路径 mono+技术栈+守护状态 StateLabel+进行中 Counter+更新时间），w
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-05
最近确认：f41468b59

## FR-styles-013 工作区概览页重排
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户进入某工作区概览页；When 页面渲染；Then MUST 呈现白底页头（方块头像+名称+可见性胶囊+操作组）+守护状态横幅+StatGrid 统计四格+左右两栏（活跃变更/最近会话+About 侧栏）；深色渐
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-06
最近确认：f41468b59

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-core-pages-visual-redesign:task-08:acc-0-ed614a42
  tests: frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active
- row: 2026-09-26-core-pages-visual-redesign:task-08:acc-1-b8697a82
  tests: frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active
- row: 2026-09-26-core-pages-visual-redesign:task-08:acc-2-f55d14c1
  tests: frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-core-pages-visual-redesign
  status: active

## FR-styles-014 会话门户展示层重做
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户进入会话门户；When 三栏渲染；Then 左栏条目 MUST 为两段式（状态点+标题+相对时间/引擎+轮数）且选中态左缘 2px 指示条；中栏四分支（群聊/真会话/预会话/空门户）MUST 全部 Pri
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-07
最近确认：f41468b59

## FR-styles-015 交互统一修复
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 五页面内存在删除/危险操作与列表操作；When 触发；Then 删除类操作 MUST 走 antd Modal（高危场景名称输入确认，对齐 FRONTEND_PAGE_STYLE §8）；列表行 hover MUST 浮现快
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-08
最近确认：f41468b59

## FR-styles-016 规范回写与硬编码色清零
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 五页面迁移完成；When 规范回写；Then FRONTEND_PAGE_STYLE.md MUST 增补 primer 组件用法章节并改写 D-304 双体系豁免条款（按钮统一 primer preset
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-09
最近确认：f41468b59

## FR-styles-017 三主题兼容验证
变更：2026-09-26-core-pages-visual-redesign
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given blue/ai-native/dark 三主题；When 逐页切换主题查看五个页面；Then 观感 MUST 达标（GitHub 布局语言不变、色值随主题），dark 主题 MUST NOT 依赖新增的逐类补丁；浅色两主题既有页面 MUST 零回归（FR
全文：.sillyspec/changes/archive/2026-09-26-core-pages-visual-redesign/requirements.md#FR-10
最近确认：f41468b59
