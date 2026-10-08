---
author: qinyi
created_at: 2026-09-23 01:33:44
generated_by: sillyspec-fourpiece-init
change: 2026-09-23-md-card-render
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: conventions.md 仅作原型演示样本，不沉淀新约定
- type: boundary
- priority: P0
- status: accepted
- source: user
- 模块域: frontend_components
- question: 「出原型的时候用 conventions.md 给出对应的卡片格式」是指把卡片格式规范写入 conventions.md，还是仅用该文件内容做原型演示数据？
- answer: 用户确认「只做演示样本」——原型 HTML 用 `.sillyspec/knowledge/conventions.md` 真实内容（含表格/标题/加粗/代码块）演示卡片渲染效果；不往 conventions.md 新增「卡片格式规范」条目。
- normalized_requirement: 本变更不改 `.sillyspec/knowledge/conventions.md` 的约定内容；原型产物（prototype HTML）以 conventions.md 为演示数据源。
- impacts: [FR-02, task-原型]
- evidence: 用户 2026-09-23 对话回答（AskUserQuestion「文档角色」选「只做演示样本」）；frontend/src/components/knowledge/entry-card-list.tsx:539-543（manual 小节卡正文纯文本现状）

## D-002@v1: 卡片正文渲染全文，不折叠、不卡片内滚动
- type: boundary
- priority: P1
- status: accepted
- source: user
- 模块域: frontend_components
- question: md 渲染后长文档会把卡片撑长，卡片内容展示策略选哪种（折叠/截断/全文）？
- answer: 用户确认渲染全文即可——卡片本就按 md H2 小节拆分（一个小节一张卡，entry-card-list.tsx detectEntryCardForm manual 形态），单卡内容天然可控；外层卡片列表容器已有滚动（page.tsx max-h + overflow-y-auto），无需折叠或卡片内二级滚动。
- normalized_requirement: 卡片正文用 MarkdownText（compact 档）渲染全文；不新增折叠/展开交互；SingleCard（无 H2 小节的整文件单卡）同样全文渲染，与现状纯文本全文展示行为对齐。
- impacts: [FR-01, task-渲染改造]
- evidence: 用户 2026-09-23 对话回答（AskUserQuestion「长文策略」自定义回答）；frontend/src/components/knowledge/entry-card-list.tsx:613-629（SingleCard）

## D-003@v1: 实现方案选 C——CardMarkdown 薄壳渲染 + 卡片视觉重构
- type: architecture
- priority: P0
- status: accepted
- source: user
- 模块域: frontend_components, frontend_app
- question: 卡片 md 渲染实现方案三选一（A=4 处直接替换 / B=薄包装 CardMarkdown 组件 / C=渲染+卡片视觉重构）？
- answer: 用户看完三方案原型（prototype-card-render.html 三 tab 对比，演示数据为 conventions.md 真实内容）后选定方案 C——含 B 的全部渲染能力（CardMarkdown 薄壳：MarkdownText compact + 表格横向滚动 + 字号对齐）+ 卡片视觉重构（卡片头品牌色条与 brand-50 底、小节标题 brand-700、锚点复制图标、frontmatter 元信息条、表头品牌色卡片化）。
- normalized_requirement: entry-card-list.tsx 4 处纯文本正文换 CardMarkdown 渲染（继承统一 sanitize）；卡片头视觉重构（品牌色条+元信息条+锚点图标）；原型 prototype-card-render.html panel-c 为视觉验收基准（D-008@v1 先例：原型细节示意方向，非逐像素硬性契约；热度徽标等与现有元素重复处在 design 收敛）。
- impacts: [FR-01, FR-03, task-渲染改造, task-视觉重构, task-原型]
- evidence: .sillyspec/changes/2026-09-23-md-card-render/prototype-card-render.html（panel-c）；用户 2026-09-23 对话选择「我想用方案C」；frontend/src/components/ui/markdown-text.tsx:196（MarkdownText）；frontend/src/components/knowledge/entry-card-list.tsx:539-543（现状纯文本输出）
- 故障面: ①视觉重构触及卡片 DOM 结构，现有锚点定位（data-entry-anchor + scrollIntoView）与条目级 🔥 徽标渲染需回归验证；②frontmatter 元信息条新增解析依赖——无 frontmatter 的文件须优雅降级（不显示元信息条，不炸卡片）；③双主题（blue/ai-native）下品牌色条与表头色需经 brand-* 语义阶取值，禁硬编码 hex（FRONTEND_PAGE_STYLE §0.5 铁律）。
- 退役判据: 若后续知识库/扫描文档页整体改版（如换卡片布局系统），本视觉规范随页面基线一并重估。