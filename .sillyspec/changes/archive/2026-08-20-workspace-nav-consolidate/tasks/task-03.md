---
id: task-03
title: 'layout standalone 收窄为仅 topology+验证 components/changes/[cid] 回包裹'
title_zh: 'layout standalone 收窄为仅 topology+验证 components/changes/[cid] 回包裹'
author: 'qinyi'
created_at: 2026-08-20 20:28:05
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - isStandalone 改为仅 pathname.includes 斜杠 /components/topology（精确匹配该整屏页）
  - 删旧注释并注明收窄依据（ql-20260707-004 宽度理由与现码不符+topology h-screen 例外）
  - 验证 components/changes 页在包裹布局渲染正常
acceptance:
  - components 与 changes 页渲染 WorkspaceTabs
  - changes/[cid] 深层页含菜单
  - topology 页保持整屏无菜单
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
