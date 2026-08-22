---
id: task-06
title: change-entry-card-with-preview
title_zh: 变更会话入口卡（含测试同波适配）
author: qinyi
created_at: 2026-08-22 17:10:00
priority: P1
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-003@v1, D-004@v1]
expects_from:
  task-01:
    - contract: sessions-portal
      needs: [session-deeplink]
allowed_paths:
  - frontend/src/components/changes/detail/change-sessions-card.tsx
  - frontend/src/components/changes/detail/__tests__/change-sessions-card.test.tsx
goal: >
  变更详情侧边卡改入口形态（design §4.D）——listChangeSessions 按仅本人过滤取
  前 3 条预览，条目经 ?session= 深链直达变更级门户选中，「打开会话工作台」跳
  专属路由，其测试同波适配保绿。
implementation:
  - '卡片改入口形态——删 Dialog 与 ChangeSessionSection 内嵌装配，数据源 listChangeSessions(workspaceId, changeId)，客户端按 author 仅本人过滤后取前 3 条（D-003 语义入口侧落地，缺 author 项保留，同旧 workspace-section 过滤口径）'
  - '每条预览渲染 id 短码/状态/相对时间，点击经 Link 至 /workspaces/[id]/changes/[cid]/sessions?session=<id> 直达门户选中态（深链能力由 task-01 提供）'
  - '卡尾「打开会话工作台」Link 至变更级会话路由（不带 session 参数）'
  - '同波适配 change-sessions-card.test.tsx——现 :21-27 内嵌 section 断言改入口断言（预览条目渲染/链接指向/仅本人过滤三分支），mock listChangeSessions 与 useSession，保绿收尾'
acceptance:
  - '卡片渲染仅本人最近前 3 条预览（他人会话不出现）与「打开会话工作台」按钮'
  - '预览条目链接指向变更级门户路由并携带 ?session= 参数'
  - 'change-sessions-card.test.tsx 全绿；pnpm exec tsc --noEmit 零 error'
verify:
  - 'cd frontend && pnpm exec vitest run src/components/changes/detail/__tests__/change-sessions-card.test.tsx'
  - 'cd frontend && pnpm exec tsc --noEmit'
constraints:
  - '不动 app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx——卡片由其渲染，props 不变则无需动'
  - '门户本体归 task-01、变更级新路由归 task-03（同 Wave 并行），本卡只产入口不重复实现；ChangeSessionSection 随本卡失去唯一消费方，文件删除归 task-07'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
