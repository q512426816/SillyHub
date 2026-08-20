---
author: qinyi
created_at: 2026-08-20T14:40:00
---

# decisions.md — 2026-08-20-workspace-overview-redesign 决策台账

## D-201: 工作台式四段信息架构
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 工作区详情页九块平铺如何重排?
- answer: 用户选 A 工作台式——头部横幅（渐变深底+名称+操作组）→ 统计卡行置顶（四卡图标+跳转）→ 快速入口宫格（图标卡片网格）→ 分组信息区（基本信息展开+配置折叠），对齐原型第 02 节版式
- normalized_requirement: 四段顺序固定；统计卡整卡可点击跳对应页；配置类内容默认折叠不占首屏
- impacts: [design §5, page.tsx 重排, 三个新组件]
- evidence: brainstorm step3 AskUserQuestion 用户选"A 工作台式（推荐）"

## D-202: 展示组件拆分（方案 B）
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: page.tsx 543 行单文件重排还是拆组件?
- answer: 用户选 B 组件拆分——新增 hero-header/stats-row/quick-entry-grid 三个展示组件，page.tsx 降为编排层约 250 行；hook 逻辑全留 page.tsx
- normalized_requirement: 新组件纯展示（props 进/JSX 出，不引数据 hook）；可测试可复用；业务逻辑零迁移
- impacts: [design §5 文件清单, §6 接口]
- 修订注：page.tsx 预计行数后修正为 450-480（Grill 复核：基本信息编辑表单等有状态 JSX 留编排层，拆走需迁 handler 得不偿失）
- evidence: brainstorm step4 AskUserQuestion 用户选"B 组件拆分（推荐）"

## D-203: 配置区折叠收纳
- type: boundary
- status: accepted
- source: user
- priority: P1
- question: 五块配置内容（基本信息/提供方/关联项目/规范配置/守护共享）在四段式中如何安置?
- answer: antd Collapse 两组——「基本信息」默认展开（高频+含编辑态），「配置」默认折叠含四面板（默认提供方/关联 PPM 项目/规范配置/守护共享，既有子组件原样塞入不改内部）
- impacts: [design §5 段④, R-03]
- evidence: brainstorm step5 设计确认（用户选"确认，按此设计"，设计含此条）
