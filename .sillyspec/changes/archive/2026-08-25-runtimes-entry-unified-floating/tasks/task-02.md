---
id: task-02
title: 'add runtime scope to session list panel'
title_zh: 'SessionListPanel 加 RuntimeScope 判别联合与 runtime_id 过滤'
author: 'qinyi'
created_at: 2026-08-25 15:35:26
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-02, FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
provides:
  - contract: SessionListScope
    fields: [RuntimeScope]
goal: >
  SessionListPanel 的 SessionListScope 判别联合新增 RuntimeScope 变体（kind=runtime 带 runtimeId），
  查询透传 runtime_id 过滤参，runtime scope 下组头新建按钮禁用（FR-02/FR-03）。
implementation:
  - SessionListScope 联合加 RuntimeScope 类型（kind 为 runtime、runtimeId 字符串）
  - 导出 RuntimeScope 类型供宿主消费
  - sessionsQuery 查询条件加 runtime_id 透传（真值才下发，对齐 workspace_id 模式）
  - 分组逻辑不变（仍按 workspace_id 分组，跨工作区会话分组展示）
  - runtime scope 下组头新建按钮不渲染（canNew 置 false 或 onNew 禁用）
  - session-list-panel.test.tsx 补 runtime scope 测试
acceptance:
  - scope 为 runtime 时 listAgentSessions 收到 runtime_id 参数
  - runtime scope 下组头不渲染新建按钮
  - 全局/workspace/change scope 行为零回归（既有测试绿）
  - pnpm exec vitest run session-list-panel 全绿
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 零 backend 改动（runtime_id 为 listAgentSessions 既有过滤参，lib/daemon.ts:1669）
  - 不改全局/workspace/change 三分支既有行为
  - 视图过滤与数据层过滤语义不变（runtime_id 走数据层端点过滤）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
