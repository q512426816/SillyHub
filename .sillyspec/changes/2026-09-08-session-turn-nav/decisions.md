---
author: WhaleFall
created_at: 2026-09-08 10:38:12
---

# 决策记录 — 2026-09-08-session-turn-nav

## D-003@v2 条目形态改 ZCode 横杠式：默认细横线单行，hover 动画展开详情

- type: ux
- source: user
- question: 目录条目视觉形态（v1 两段常驻摘要卡片 vs ZCode 横杠式）
- answer: 用户看原型后反馈 v1「繁琐、装饰太多」，要求对齐 ZCode：每轮默认只是一条细横线行（轮号 + 一行提问省略 + 失败/运行小圆点 + 未加载小字，行间发丝分隔线）；鼠标移上该行平滑展开（max-height 过渡动画）显示完整信息（提问 2 行钳制 + 助手正文 3 行摘要 + 时间/状态 meta）；点击仍是跳转定位。当前轮高亮只保留左侧 2px 品牌细线 + 轮号着色，不加底色/边框卡片。移动端无 hover：点击直接跳转（小屏预览价值低，跳转即见内容）。
- evidence: 用户 2026-09-08 原型反馈（「参考 zcode 的那个 ui 可以吗 现在这种的有点繁琐」「不是装饰太多 zcode 不是一个一条条横杠的那种 ui 然后鼠标移上去出现动画并展示对应的信息吗」）；原型 v2 目录横杠区（.ci/.bar/.detail hover max-height 过渡）。
- 模块域: frontend_components
- 覆盖: D-003@v1（「提问+正文摘要」的信息保留，改到 hover 展开区；两段常驻可见的形态被取代）

## D-001@v1 常驻左栏 + 移动端/悬浮窗收进菜单

- type: architecture
- source: user
- question: 轮次导航面板形态（ZCode 式常驻左栏 vs header 下拉 vs 仅桌面）
- answer: 桌面 /sessions 聊天区左侧常驻轮次目录栏（可折叠）；移动端 /m 与悬浮窗收进 ⋯ 菜单做成抽屉/下拉，不占屏幕宽度。
- evidence: brainstorm step3 用户 AskUserQuestion 三选一，选「常驻左栏+移动端收进菜单（推荐）」。
- 模块域: frontend_components, frontend_app

## D-002@v1 覆盖全部历史轮次

- type: architecture
- source: user
- question: 目录覆盖范围（仅已加载轮次 vs 全会话历史轮次）
- answer: 覆盖全部历史轮次。已加载轮次直接跳转；未加载的更早轮次用现成 GET /sessions/{id}/runs 补全目录条目，点击时自动连续加载历史日志（复用触顶翻页链）到目标轮再定位。
- evidence: brainstorm step3 用户 AskUserQuestion 选「覆盖全部历史轮次（推荐）」。
- 模块域: frontend_components, frontend_app

## D-003@v1 条目内容 = 用户提问摘要 + 助手正文摘要

- type: ux
- source: user
- question: 每条目录条目显示内容（提问+正文两段 vs 仅提问一行）
- answer: ZCode 式两段：用户提问一行摘要 + 助手回复正文摘要（截断），不点过去即可大致回顾每轮问了什么、答了什么。
- evidence: brainstorm step3 用户 AskUserQuestion 选「用户提问+助手正文摘要（推荐）」。
- 模块域: frontend_components

## D-004@v1 方案 A：前端拼装，零后端改动

- type: architecture
- source: agent
- question: 目录数据来源（前端拼装 displayTurns+runs vs 后端新增轮次摘要端点）
- answer: 选方案 A 前端拼装：已加载轮次从 displayTurns（session-panel-page 既有 useMemo 产物）派生摘要；未加载轮次调既有 listSessionRuns（GET /sessions/{id}/runs，每轮一行含 started_at/status/sender）补全；不新增后端端点。跳转经 TurnRow 新增 data-turn-id 锚点 + scrollIntoView，未加载时循环触发 handleLoadEarlierRef 到目标命中。方案 C（后端摘要端点）payload 更小但引入新契约 + gen:types 全链路，现有接口信息已足够，YAGNI 拒绝；方案 B（仅已加载轮次）不满足 D-002 被排除。
- evidence: brainstorm step4 方案比较；调研报告确认 listSessionRuns 与 handleLoadEarlierRef 均已存在（session-panel-page.tsx:881 翻页链、lib/daemon/sessions.ts:639 runs 客户端）。
- 模块域: frontend_components, frontend_app

## D-005@v1 未加载条目摘要策略：元数据 + 点击回填

- type: ux
- source: agent
- question: SessionRunRead 无 prompt 文本字段，未加载轮次目录条目的摘要怎么显示
- answer: v1 未加载条目显示元数据（轮号/时间/发送者/状态）+「点击加载并定位」标记；点击后加载历史日志回填提问+正文摘要并跳转（回填后与已加载条目同观感）。可选增强=runs 响应加 prompt_preview 字段（轻后端改动，一个字段+gen:types），让未加载条目初始即显示提问摘要——默认不做，作为用户原型确认时的备选项。
- evidence: api-types.ts:20926 SessionRunRead 字段核对（无 prompt）；原型 ci-tag「未加载 · 点击加载」演示回填交互。
- 模块域: frontend_components

## D-006@v1 悬浮窗归 desktop 常驻分支（默认折叠）

- type: architecture
- source: agent
- question: 悬浮窗宿主的轮次导航形态（原设计「收进 ⋯ 菜单」被 Grill 证伪）
- answer: floating-session-host 不传 variant → session-panel/index.tsx:279 默认 desktop variant，mobile ⋯ 菜单守卫在其不渲染，「收进 ⋯ 菜单」无入口。修正：悬浮窗落 desktop 常驻可折叠分支，经新 prop catalogDefaultCollapsed 默认折叠（悬浮窗宽度有限，232px 栏占比过高），用户可展开，展开后与桌面同款。
- evidence: Design Grill 交叉审查缺陷 2（floating-session-host.tsx 全文无 variant、index.tsx:279 默认值）；连带 floating-session-host.tsx 进文件变更清单。
- 模块域: frontend_components, frontend_app

## D-007@v1 形态终版：ZCode 刻度轨（tick rail + hover 飞出卡），取消 232px 面板与折叠

- type: ux
- source: user
- question: 目录形态二稿反馈（v2 横杠列表仍「不对」）
- answer: 用户贴 ZCode 实机截图纠正：不是一列横杠列表，而是聊天区左缘一条极窄「刻度轨」——每轮一条 2px 细横杠刻度（14px 宽，hover 放宽到 20px 并着品牌色），hover 刻度时从右侧飞出深色信息卡（轮号+提问加粗、正文摘要、时间/状态 meta），点击刻度跳转定位。v3 定稿：取消 232px 侧栏与折叠/计数头部（刻度轨仅 ~30px 宽常驻，无需折叠，localStorage 记忆一并取消）；失败刻度红色、运行中琥珀脉冲、未加载空心；滚动联动=当前轮刻度常亮。移动端仍 ⋯ 菜单抽屉（触屏无 hover，点击直接跳转）。悬浮窗因刻度轨极窄可直接用同款（D-006 的默认折叠需求随之消失，floating-session-host 零改动）。
- evidence: 用户 ZCode 截图（左缘刻度轨 + hover 弹出「部署docker…」深色信息卡）；原型 v3 tick-rail/tick-flyout 实现。
- 模块域: frontend_components
- 覆盖: D-003@v2（横杠列表形态）与 D-001@v1 的折叠面板设计；「提问+正文摘要」信息承载不变（移入飞出卡）
