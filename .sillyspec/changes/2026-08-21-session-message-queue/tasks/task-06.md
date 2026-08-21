---
id: task-06
title: 'sessions/page.tsx use SessionPanel'
title_zh: 'sessions 页面改用 SessionPanel'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
goal: >
  将 sessions/page.tsx 改为渲染 SessionPanel 组件
implementation:
  - 在 sessions/page.tsx 中导入 SessionPanel
  - 将原有的 session 展示/交互 JSX 替换为 <SessionPanel /> 组件
  - 传入对应的 props（session, messages, onSendMessage, context, scope 等）
  - 移除已提取到 SessionPanel 中的重复代码
  - 确保 sessions 页面功能与重构前完全一致
acceptance:
  - sessions/page.tsx 渲染 SessionPanel 而非内联 session UI
  - 所有 props 正确传入
  - 页面功能与重构前一致（消息展示、发送、context/scope 切换）
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅修改 sessions/page.tsx
  - 不改变页面功能行为
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
