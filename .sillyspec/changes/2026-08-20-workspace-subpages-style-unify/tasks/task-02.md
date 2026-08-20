---
id: task-02
title: 'A 组·四页套用（skills/mcp/components/members）'
title_zh: 'A 组·四页套用（skills/mcp/components/members）'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-301, D-302]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx
expects_from:
  - task: task-01
    contract: ErrorBanner
    fields: [message, onRetry]
goal: >
  按 plan 任务总表的文件分组（非按模式）套用 A 组四页 skills/mcp/components/members
  的全部共性项——返链入 actions、空态换 EmptyState、列表卡 hover lift、h-7 自写按钮换
  shadcn、mcp amber 语义色（design §5 项 2/3/5/7 + 项 4 的 mcp:124），对齐概览页工作台
  风格与双主题系统（FR-02/03/04/05）。
implementation:
  - 返链规范化（FR-02）——skills:31/mcp:33/components:85 移除 PageHeader title 内嵌 Link hack，统一改放 actions 区，文字链接「← 工作区」规格 text-xs text-muted-foreground hover:text-foreground；返回目标统一为 /workspaces/<id> 工作区详情页（components:86 现指向 /workspaces 列表页，一并收敛）；members 页无此 hack 不动
  - 空态统一（FR-03）——skills:63-72/mcp:65-74/members:167-175/components:172-175 手写居中 div/p 换现成组件 ui/empty-state 的 EmptyState（props 为 icon/title/description/action），原有中文文案逐字保留不新增不改写
  - 列表卡 hover（FR-03）——skills:77,97 与 mcp:82,100 列表项 SectionCard 加 hover 属性值 lift
  - 小按钮规范（FR-05）——skills:41-48/mcp:43-50 的 h-7 自写刷新按钮换 shadcn Button size=sm variant=outline；components:104 的 10 个 NAV Link 用 buttonVariants 组合（先例 changes:442 的 cn(buttonVariants) 写法，从 ui/button 导入）；components:109-114 搜索 input 同步规格对齐（去 h-7 手写规格）
  - 语义色 token 化（FR-05 部分）——mcp:124 text-amber-600 换 text-warning 语义色（themes.ts 双主题跟随，先例 workspace-card 等已在用）
  - 逐页自检——grep 四页确认 h-7 自写按钮类、title 内嵌 Link hack、手写空态 div、amber 硬编码四类清零
acceptance:
  - 四页 PageHeader title 均为纯文本；skills/mcp/components 三处返链位于 actions 且目标一致为 /workspaces/<id> 详情页
  - 四页空态均由 EmptyState 渲染；skills:90/mcp:116 空态文案断言测试通过（文案未变则断言不动，失效则同步）
  - skills/mcp 列表卡悬浮有 lift 效果（边框/阴影/位移过渡，双主题下正常）
  - 四页无 h-7 自写按钮残留；NAV Link 走 buttonVariants；搜索 input 规格对齐
  - mcp:124 密钥脱敏提示为语义 warning 色而非 amber 硬编码
  - 零业务逻辑/API/数据流变更（纯展示层）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/skills src/app/(dashboard)/workspaces/[id]/mcp
  - cd frontend && grep -rn "h-7\|amber" 本卡四个 page.tsx 应清零（命中即回改）
constraints:
  - 不碰错误条——skills:51/mcp:53/members:141/components:119 由 task-01 换 ErrorBanner，本卡只消费（expects_from task-01）
  - members 表头/文案中文化与表格规格不在本卡（task-04）
  - shared-daemon-manager.tsx 内嵌错误条归 task-01，本卡不改该文件
  - 不重设计信息架构、不改信息密度（design §3 非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
