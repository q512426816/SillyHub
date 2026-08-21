---
id: task-02
title: 'WorkspaceTabs 扩 13 项+滑动容器+overview 双高亮修'
title_zh: 'WorkspaceTabs 扩 13 项+滑动容器+overview 双高亮修'
author: 'qinyi'
created_at: 2026-08-20 20:28:05
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/workspace-tabs.tsx
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - TABS 数组按序补 4 项——扫描文档 /scan-docs、运行时 /runtime、智能体档案 /agent-profiles、方案文件 /files（href 拼 base 同宫格原值）
  - nav 容器加 flex-nowrap overflow-x-auto 与滚动条隐藏（scrollbar-none 类组合 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden）
  - overview isActive 改 pathname === base（修双高亮，R-04）
acceptance:
  - 菜单 13 项 label 与 href 逐一正确
  - 容器可左右滑动且滚动条不可见
  - 子页下仅当前项 aria-current（概览不再并置高亮）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 边界约束 1（如：不加测试）
  - 边界约束 2（如：不修改传入参数）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
