---
author: qinyi
created_at: 2026-08-20T17:20:00
---

# decisions.md — 2026-08-20-workspace-subpages-style-unify 决策台账

## D-301: 抽公共组件策略（方案 A）
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 8 页共性模式统一用抽公共件还是逐页就地修?
- answer: 抽公共组件先行（ErrorBanner 等）再逐页套用——修一次全页受益，后续新页复用（与 PageContainer 四件套同惯例）
- normalized_requirement: 共性模式必须落公共组件/规范，禁止第 7 处复制错误条模式
- impacts: [design §5-1~5, §6, plan W1]
- evidence: brainstorm step4 AskUserQuestion（用户未及时作答，主代理按其统一诉求与四件套先例判定 A 并如实记录，step5 设计确认用户选"确认，按此执行"涵盖本方案）

## D-302: 批量模式不重复出原型
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 8 页改造是否再出 HTML 原型?
- answer: 不再出——风格已由概览页工作台式+主题系统定型，本变更是模式套用非新视觉设计
- normalized_requirement: 逐项修复对照概览页/§0.5 规范执行，不引入新视觉语言
- impacts: [design §3, plan]
- evidence: brainstorm step5 用户确认设计（设计明示不再出原型）

## D-303: 手写表不换 DataTable
- type: boundary
- status: accepted
- source: architect
- priority: P2
- question: members/mcp-tokens 手写表格是否换共享 DataTable?
- answer: 不换——两页表结构简单（无排序/固定列/分页需求），换动过大；统一表头规格（px-4 py-3 bg-muted/40、行 hover）即可
- normalized_requirement: 两页表头规格逐字段一致；后续新增列表需求按 FRONTEND_PAGE_STYLE §4 走 DataTable
- impacts: [design §5-6]
- evidence: 摸底报告（mcp-tokens:24 注释自认 StatCard 待抽同理；表无复杂交互）

## D-304: FRONTEND_PAGE_STYLE 适用范围（Grill P1-1 补）
- type: definition
- status: accepted
- source: design-grill
- priority: P0
- question: 旧规范 §4/§5/§9/§11 antd 全量条款与本变更 shadcn 方向冲突,以哪个为准?
- answer: FRONTEND_PAGE_STYLE 以 /ppm/projects 列表页为基准,其 antd 全量条款适用于 PPM 类列表页;工作区工作台式页面按 §0.5 主题系统 + 概览页基线（shadcn Button/SectionCard 四件套）执行。规范文件头部已加适用范围声明（本变更顺手落）。
- normalized_requirement: 工作区子页面验收依据=§0.5+概览页基线;PPM 列表页验收依据=旧条款不变
- impacts: [design §5, verify 验收依据, FRONTEND_PAGE_STYLE 头部声明]
- evidence: Grill 二轮 P1-1（CLAUDE.md 规则 20 引发全站误读;概览页 page.tsx:9 实际用 shadcn Button）
