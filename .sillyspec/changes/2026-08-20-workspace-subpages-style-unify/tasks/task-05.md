---
id: task-05
title: 'sessions 容器 SectionCard 化 + explorer 锚点与按钮修正'
title_zh: 'sessions 容器 SectionCard 化 + explorer 锚点与按钮修正'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-06]
decision_ids: [D-302]
allowed_paths:
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx
goal: >
  会话页右侧自写容器换 SectionCard、explorer 高度锚与 antd Button 混用修正（design
  §5 项 9，FR-06）。W3 任务，与 W2 共文件（explorer）靠 Wave 串行错开，须 W2 完成后执行。
implementation:
  - workspace-session-section.tsx:242 自写容器（flex min-h-[420px] flex-col overflow-hidden rounded-md border bg-card 的 div）换 SectionCard——bodyPadding 取 p-0，className 透传 flex/min-h/overflow 类；注意 SectionCard 内层 body div 会包一层，需保证 InteractiveSessionPanel 的 flex 高度链路不断（内层可用 flex/min-h-0 适配）
  - explorer:166 高度锚 h-[calc(100vh-56px)] 换 h-[calc(100vh-64px)]（TopBar 已改 h-16，旧锚过时）；:7 与 :163-164 相关注释同步更新避免注释与实现不一致
  - explorer:23 的 antd Button 导入与 :180-187 刷新按钮换 shadcn Button（从 ui/button 导入，size=sm 配 variant=outline，RefreshCw 图标保留），移除 antd 依赖导入
  - 「刷新」按钮文案逐字保留——explorer-page.test:191 的 getByRole button name 刷新 断言依赖；alert 角色断言（test:254）依赖 task-01 的 ErrorBanner，本卡不动错误条即不破坏
acceptance:
  - 右侧会话面板容器为 SectionCard 渲染（rounded-lg shadow-sm 基类），面板 flex 布局不塌、高度撑满正常
  - explorer 页面高度锚为 64px，树/预览区内部滚动正常、页面本体不整体滚动（R-03）
  - explorer 无 antd Button 残留（import 与用法均清零），刷新按钮文案仍为「刷新」
  - explorer-page.test 与 workspace-session-section.test 全部通过
  - 零业务逻辑/交互行为变更（loading 态等行为等价，R-04）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx src/components/__tests__/workspace-session-section.test.tsx
  - cd frontend && grep -n "antd\|100vh-56" src/app/(dashboard)/workspaces/[id]/explorer/page.tsx 应清零（命中即回改）
constraints:
  - 不动 ExplorerStatePanel 三降级卡与错误条（错误条已由 task-01 换 ErrorBanner 并保留 role=alert）
  - 「刷新」文案不可改（explorer-page.test:191 断言）
  - 高度锚改动须在 Docker 环境实测该页滚动/分栏（plan R-03），错位即回退
  - sessions 页其余部分（SessionListLayout 等）不动，仅 :242 容器行
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
