---
author: qinyi
created_at: 2026-09-27 00:32:02
---

# Decisions — 2026-09-26-core-pages-visual-redesign

## D-001@v1 设计风格选型

- **type**: design
- **status**: accepted
- **source**: user
- **question**: 五个核心页面（变更中心列表/变更详情/工作区列表/工作区概览/会话门户）重设计采用哪种设计语言？
- **answer**: 用户要求先出四种风格高保真原型对比（Linear 式高级极简 / Vercel-Geist 黑白极简 / Notion 轻盈文档感 / GitHub 工程师实用风，原型存档于 prototype/ 目录 + 五视图完整版 prototype-github-redesign.html），对比后选定 **G：GitHub 式·工程师实用风（Primer 设计语言）**——Issues 列表行式、PR 详情时间线、Counter 胶囊、UnderlineNav 橙色指示条、状态色语义精准。落地铁律：布局/组件语言直接复刻 Primer 结构，颜色全部走现有三主题 token（semantic 五阶 + brand 阶），不新增硬编码 hex。
- **normalized_requirement**: 五页面 UI 采用 Primer 布局组件语言；全部色值经 themes.ts 三主题 token；原型 prototype-github-redesign.html 为 execute 对照基准。
- **impacts**: frontend 全部五页面 + 新建 primer 组件库 + themes.ts semantic 扩展 + FRONTEND_PAGE_STYLE.md 规范回写
- **evidence**: 四风格原型对比轮（2026-09-26 夜），用户答复「G GitHub 式 · 工程师实用风」
- **priority**: P1
- **模块域**: frontend
- **锚点**: frontend/src/styles/themes.ts（semantic 结构）

## D-002@v1 实施方案选型

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: 五页面重设计按什么策略实施？（方案一：样板页先行+最小共享原语，两批交付 / 方案二：全量组件库+五页一次性迁移 / 方案三：逐页就地改造无共享层）
- **answer**: 用户选定**方案二：先建完整 GitHub/Primer 风格共享组件库（frontend/src/components/primer/），然后五个页面一次性全部迁移完再交付**。用户接受中途不可见进度的代价，换取交付时一次看全、组件库最完整。会话门户 8000+ 行只动 render/样式层，状态机数据流零改动（风险边界）。
- **normalized_requirement**: Wave 1 全量 primer 组件库（含单测）先行；Wave 2-4 五页面一次性迁移；Wave 5 规范回写；交付前不逐页露出半成品。
- **impacts**: frontend/src/components/primer/（新建目录）+ 五页面全部 + 测试
- **evidence**: 方案对比轮（2026-09-27 凌晨），用户答复「方案二」
- **priority**: P1
- **模块域**: frontend
- **锚点**: frontend/src/components/primer/index.ts

## D-003@v1 改造深度与范围

- **type**: scope
- **status**: accepted
- **source**: user
- **question**: 改造深度到哪层？范围含哪些页面？
- **answer**: 深度=彻底重设计含交互（布局信息架构重排+交互改进，非仅视觉皮肤）；范围=三个主页面+两个核心详情页（变更中心列表、变更详情、工作区列表、工作区概览、会话门户）。明确不做：后端 API 改动、路由 URL 变化、WorkspaceTabs 17-tab 导航壳、会话门户功能重构。
- **normalized_requirement**: 五页面布局重排+交互改进；四项明确不做写入 design 非目标并作为 verify 范围边界。
- **impacts**: 五页面 + top-bar（仅 token 替换级修复）
- **evidence**: 需求澄清轮（2026-09-26 夜）AskUserQuestion 用户选择
- **priority**: P1
- **模块域**: frontend
- **锚点**: .sillyspec/changes/2026-09-26-core-pages-visual-redesign/design.md（非目标节）

## D-004@v1: 执行期收敛深度降级（详情页/会话门户）

- **type**: architecture
- **status**: accepted
- **source**: user
- **question**: FR-04 的 MetaPanel 六组全收敛与 FR-07 中栏消息块全量重做的工程量在单会话 execute 中风险过高（detail/ 14 组件 + 门户 8400 行），是否降级？
- **answer**: 变更详情页保留下方既有步骤时间线卡与右侧次线五卡（信息零丢失），重排聚焦 checks 横条+硬编码清理+卡头统一；会话门户三任务（09/10/11）按「样式类规范化」执行（选中态/字号下限/硬编码色/brand 阶统一），不做消息块结构重写。行为与信息字段零损失，视觉统一目标达成。
- **normalized_requirement**: FR-04 判定 partial（checks ✓/两栏 ✓/MetaPanel 收敛=保留五卡），FR-07 达成样式统一级（DOM 结构保留）；verify 阶段如实记录剩余项。
- **impacts**: [task-06, task-10, task-11, verify]
- **evidence**: execute Wave 5 执行期裁决（2026-09-27），主代理依据红线「只动 render 与样式类」与单会话风险控制
- **priority**: P2
- **模块域**: frontend
