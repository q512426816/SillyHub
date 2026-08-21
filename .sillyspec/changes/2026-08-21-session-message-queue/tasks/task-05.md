---
id: task-05
title: 'extract SessionPanel shared component'
title_zh: '提取 SessionPanel 共享组件'
author: 'qinyi'
created_at: 2026-08-21 08:52:48
priority: P0
depends_on: [task-04]
blocks: [task-06, task-07]
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/app/(dashboard)/sessions/page.tsx
goal: >
  从 sessions/page.tsx 提取 SessionPanel 共享组件，props 接口覆盖两页面差异
implementation:
  - 参照 diff-analysis.md 的 props 接口草案
  - 新建 frontend/src/components/daemon/session-panel.tsx
  - 定义 SessionPanelProps 接口：session, messages, onSendMessage, context, scope, onContextChange, onScopeChange 等
  - 从 sessions/page.tsx 中提取共用 UI 逻辑到 SessionPanel 组件
  - 确保 props 接口同时兼容 sessions 页面和 /runtimes 页面的 interactive-session-panel 场景
  - 更新 sessions/page.tsx 使其改为渲染 SessionPanel（此步也可在 task-06 完成）
acceptance:
  - session-panel.tsx 文件存在且导出 SessionPanel 组件
  - SessionPanelProps 覆盖两页面所有差异点
  - 组件包含消息展示、输入框、context/scope 选择等核心 UI
  - tsc --noEmit 零 error
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 以 task-04 diff-analysis.md 为设计依据
  - 不改变现有功能行为
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
