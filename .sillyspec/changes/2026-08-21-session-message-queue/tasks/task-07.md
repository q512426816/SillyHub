---
id: task-07
title: '/runtimes page replace interactive-session-panel'
title_zh: '/runtimes 页面替换交互面板'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-05]
blocks: [task-10]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/components/daemon/interactive-session-panel.tsx
  # execute 阶段补充（主代理 2026-08-21）：适配层落地后 ISP 域测试经新实现渲染，
  # 旧「running/恢复中禁用输入」「409 回填输入框」断言因 design D-001/D-003 有意
  # 行为变更失效，按 taskcard 规则补 related_tests + 同步 allowed_paths
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-changeid.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx
  - frontend/src/components/daemon/runtime-session-dialog.test.tsx
  - frontend/src/components/changes/__tests__/change-session-section.test.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-changeid.test.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel-offline.test.tsx
  - frontend/src/components/daemon/runtime-session-dialog.test.tsx
  - frontend/src/components/changes/__tests__/change-session-section.test.tsx
goal: >
  将 /runtimes 页面的 interactive-session-panel 替换为 SessionPanel
implementation:
  - 在 runtimes/page.tsx 中导入 SessionPanel 替代 InteractiveSessionPanel
  - 将现有 interactive-session-panel 的 props 映射到 SessionPanel 的 props 接口
  - 移除对 interactive-session-panel 的导入和使用
  - 确保 /runtimes 页面功能与替换前完全一致
  - 评估 interactive-session-panel.tsx 是否变为死代码，如果是则标记移除
acceptance:
  - runtimes/page.tsx 渲染 SessionPanel 而非 InteractiveSessionPanel
  - 页面功能与替换前一致
  - interactive-session-panel 不再被 runtimes 页面引用
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 以 task-05 产出的 SessionPanel props 接口为依据
  - 不改变页面功能行为
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
