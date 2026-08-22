---
id: task-02
title: wire-global-and-workspace-entries
title_zh: 全局与工作区入口接线
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx
goal: >
  将 /sessions 薄壳化为渲染无参 SessionsPortal，/workspaces/[id]/sessions 改渲染 workspace scope 门户，完成全局与工作区两入口接线。
expects_from:
  task-01:
    - contract: sessions-portal
      needs: [scope-discriminated-union]
provides:
  - contract: entries-wired
    fields: [global-thin-shell, workspace-entry-wired]
implementation:
  - /sessions 页薄壳化——页面外壳逻辑整体让位门户组件，本页仅渲染无参 SessionsPortal
  - 工作区页改渲染 workspace scope 门户——workspaceId 取自路由 params.id，不再消费 WorkspaceSessionSection
  - 两页文件头注释同步改指向门户组件与本变更任务卡
acceptance:
  - 两路由渲染点 grep 均命中 SessionsPortal，WorkspaceSessionSection 在两页零引用
  - pnpm exec tsc --noEmit 零 error
  - sessions 页 18 用例未适配属已知红，记卡点移交 task-08；本任务收尾 tsc 与 lint 绿即可
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -rn "SessionsPortal" 两路由 page.tsx 确认渲染点
constraints:
  - 不动 change 级新路由（归 task-03）
  - 不动旧 section 组件本体与其测试（退役归 task-07）
  - page.test.tsx 适配归 task-08，本卡不修改测试文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
