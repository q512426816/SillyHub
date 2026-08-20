---
id: task-03
title: workspace-quick-entry-grid-component
title_zh: 工作区详情页快速入口宫格组件 quick-entry-grid（六入口图标卡）
author: qinyi
created_at: 2026-08-20 15:50:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-201, D-202]
allowed_paths:
  - frontend/src/components/workspace/quick-entry-grid.tsx
provides:
  - contract: QuickEntryGrid
    fields: [workspaceId]
goal: >
  新增六入口宫格组件 QuickEntryGrid（frontend/src/components/workspace/quick-entry-grid.tsx），
  为四段式段③——把现状 flex flex-wrap 文本链接按钮堆（page.tsx 521-540 行共 6 项）升为
  图标卡片宫格，入口集与 href 与现状一字不差，供 task-04 替换原 Quick nav 区。
implementation:
  - 新建 quick-entry-grid.tsx 导出 QuickEntryGrid，"use client" 纯展示组件；与 ppm/workbench/_components/quick-entry-grid.tsx 同名不同目录互不影响，本组件不做 Toast 占位（六入口全为真实路由）
  - props 按设计 §6 仅 workspaceId（string），六入口 href 全部由其模板拼接
  - 六入口 label 与 href 模板与现状 521-540 行一字不差——项目组件 /workspaces/<workspaceId>/components、变更中心 /workspaces/<workspaceId>/changes、扫描文档 /workspaces/<workspaceId>/scan-docs、运行时 /workspaces/<workspaceId>/runtime、智能体档案 /workspaces/<workspaceId>/agent-profiles、方案文件 /workspaces/<workspaceId>/files
  - 宫格 grid 布局 lg:grid-cols-3（桌面 3 列两行，窄屏自适应降列）
  - 每入口为 lucide 图标+中文标签的卡片 Link，悬浮强化三件套与 workspace-card 同款（先例 workspace-card.tsx 150-152 行）——hover:border-brand-300 + hover:shadow-lg + hover:-translate-y-1，配 transition 过渡
  - 图标选型按语义（lucide-react 实际导出为准，可等价替换）——项目组件=Boxes、变更中心=ClipboardList、扫描文档=FileSearch、运行时=Cpu、智能体档案=Bot、方案文件=FolderOpen；图标软底统一 bg-brand-50 text-brand-600（与统计卡一致品牌调）
acceptance:
  - tsc --noEmit 0 error 且 eslint 该文件 0 error
  - 恰为 6 个入口，label 与拼接后 href 与现状 521-540 行一字不差（含智能体档案与方案文件两个后加入口）
  - grid 类含 lg:grid-cols-3；每卡三件套 hover:border-brand-300、hover:shadow-lg、hover:-translate-y-1 齐全
  - 六入口全部为 next/link 的 Link，无 router 副作用、无 API 调用、无 Toast 占位
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/workspace/quick-entry-grid.tsx
constraints:
  - 入口集维持 6 项不加戏不减项（设计 §3 YAGNI 定案）
  - 与 ppm 版 QuickEntryGrid 严格区分——本组件 props 仅 workspaceId 且全部入口为 workspace 作用域真实路由
  - 样式全走 brand 语义阶与主题化 shadow token，不硬编码 blue-* 色值
  - 本卡只新建组件文件，不改 page.tsx 与任何测试（接线与断言属 task-04/05）；UI 文案中文
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
