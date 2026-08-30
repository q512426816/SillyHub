---
id: task-03
title: add-change-scoped-portal-route
title_zh: 变更级门户新路由
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx
goal: >
  新建变更级专属路由门户页（D-002 方案A），薄壳渲染 change scope 的 SessionsPortal，供变更详情入口卡跳转。
expects_from:
  task-01:
    - contract: sessions-portal
      needs: [scope-discriminated-union]
implementation:
  - 新建薄壳路由页——params.id 与 params.cid 组装 ChangeScope（kind=change + workspaceId + changeId）渲染门户
  - 文件头注释写明依据（design §5 文件清单、D-002@v1 专属路由决策）
acceptance:
  - 路由文件存在且 pnpm exec tsc --noEmit 零 error
  - 编译产出可达（next build 或 dev 起服务后可打开该路由，浏览器实证收口在 task-09）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅薄壳无业务逻辑（列表/绑定/深链全在门户组件）
  - 不动 changes/[cid]/page.tsx 变更详情主页与 change-sessions-card（归 task-06）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
