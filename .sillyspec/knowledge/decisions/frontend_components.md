# 决策知识 — frontend_components

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 会话轮次导航 = 桌面常驻左栏 + 移动端收 ⋯ 菜单抽屉
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：ZCode 式导航用户定案；桌面常驻（刻度轨仅 ~30px 不占聊天宽度），mobile 触屏无 hover 走 ⋯ 菜单抽屉行式列表（点击即跳），dialog 宿主不挂载。

## D-002@v1 : 目录覆盖全部历史轮次（runs 补全 + 点击循环加载定位）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：高轮次回顾是核心痛点，仅已加载轮次不解决；未加载轮次由 runsMeta 补全为空心刻度，点击时复用触顶翻页链循环加载（≤8 页、suppress 触顶自动加载）到命中再 scrollIntoView。

## D-004@v1 : 目录数据 = 前端拼装（displayTurns + runsMeta），零后端改动
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：runsMeta（attach/每轮完成已全量拉刷）+ displayTurns 信息足够拼目录；方案 C（后端摘要端点）引新契约 YAGNI 拒绝、方案 B（仅已加载）违 D-002 排除；runs 接口无 prompt 字段，未加载条目 v1 元数据+点击回填（D-005）。

## D-006@v1 : 悬浮窗归 desktop variant 分支（Grill 修正，D-007 后零改动复用刻度轨）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/index.tsx`
最近确认：fd96ae48
理由：floating-session-host 不传 variant → index.tsx 默认 desktop，mobile ⋯ 菜单守卫在其不渲染；修正后的刻度轨仅 ~30px 宽，悬浮窗直接复用 desktop 形态无需折叠或特殊处理。

## D-001@v1 conventions.md 仅作原型演示样本，不沉淀新约定
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户确认「只做演示样本」——原型 HTML 用 `.sillyspec/knowledge/conventions.md` 真实内容（含表格/标题/加粗/代码块）演示卡片渲染效果；不往 conventions.md 新增「卡片格式规范」条目。

## D-002@v1 卡片正文渲染全文，不折叠、不卡片内滚动
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户确认渲染全文即可——卡片本就按 md H2 小节拆分（一个小节一张卡，entry-card-list.tsx detectEntryCardForm manual 形态），单卡内容天然可控；外层卡片列表容器已有滚动（page.tsx max-h + overflow-y-auto），无需折叠或卡片内二级滚动。

## D-003@v1 实现方案选 C——CardMarkdown 薄壳渲染 + 卡片视觉重构
状态：implemented
变更：2026-09-23-md-card-render
锚点：未记录
最近确认：322c55edd
理由：用户看完三方案原型（prototype-card-render.html 三 tab 对比，演示数据为 conventions.md 真实内容）后选定方案 C——含 B 的全部渲染能力（CardMarkdown 薄壳：MarkdownText compact + 表格横向滚动 + 字号对齐）+ 卡片视觉重构（卡片头品牌色条与 brand-50 底、小节标题 brand-700、锚点复制图标、frontmatter 元信息条、表头品牌色卡片化）。
故障面：①视觉重构触及卡片 DOM 结构，现有锚点定位（data-entry-anchor + scrollIntoView）与条目级 🔥 徽标渲染需回归验证；②frontmatter 元信息条新增解析依赖——无 frontmatter 的文件须优雅降级（不显示元信息条，不炸卡片）；③双主题（blue/ai-native）下品牌色条与表头色需经 brand-* 语义阶取值，禁硬编码 hex（FRONTEND_PAGE_STYLE §0.5 铁律）。
退役判据：若后续知识库/扫描文档页整体改版（如换卡片布局系统），本视觉规范随页面基线一并重估。
