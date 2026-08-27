---
id: task-02
title: 'add-workspace-context-provider-and-home-redirect'
title_zh: 'm/workspaces/[id] 工作区上下文 Provider（getWorkspace 预取）+ 主页 redirect → /changes'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: [task-06, task-09, task-12, task-15]
requirement_ids: [FR-02]
decision_ids: [D-004@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/layout.tsx
  - frontend/src/app/m/workspaces/[id]/page.tsx
  - frontend/src/app/m/workspaces/[id]/__tests__/layout.m-workspace-id.test.tsx
provides:
  - useMobileWorkspace()（workspaceId/workspace/isLoading/error）@ frontend/src/app/m/workspaces/[id]/layout.tsx，供 task-04/06/09/12/15 消费
goal: >
  新增 /m/workspaces/[id] 段骨架——layout 用 react-query 预取 getWorkspace 并以
  Context 供子页共享，page 薄壳 redirect 到 /changes（D-004 主页入口）。
implementation:
  - 新建 layout.tsx（"use client"，取 params.id），useQuery 预取 getWorkspace(id)，queryKey 为 ["workspaces", "detail", id]（逐字对齐桌面 (dashboard)/workspaces/[id]/git-log/page.tsx:64 共享缓存）
  - 创建并导出 MobileWorkspaceContext 与 useMobileWorkspace() hook（暴露 workspaceId/workspace/isLoading/error），Provider 包裹 children；预取中/失败不阻塞子页渲染
  - 新建 page.tsx（"use client"），useEffect 内 router.replace 到 /m/workspaces/${id}/changes、渲染 null（client redirect 形态对齐 m/login 与 m/account，本段无 server redirect 先例）
  - 新建 colocate 测试 layout.m-workspace-id.test.tsx——mock @/lib/workspaces 的 getWorkspace 断言 queryKey 与 context 注入值；mock next/navigation 断言 page replace 目标
acceptance:
  - 使用 lib/workspaces.ts:182 真实导出的 getWorkspace(id)，禁止自写请求；queryKey 为 ["workspaces", "detail", id]
  - 渲染 /m/workspaces/ws-1 的 page 时 router.replace 被调到 /m/workspaces/ws-1/changes
  - 子组件经 useMobileWorkspace() 取到 workspaceId="ws-1" 与解析后的 Workspace 对象
verify:
  - cd frontend && pnpm test -- layout.m-workspace-id
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 仅新增 2 实现文件 + colocate 测试；不改 m/layout.tsx 与 route-guard.ts
  - page.tsx 薄壳零数据请求、零 UI；layout 不渲染视觉元素（纯 Provider）
  - 不新造 query key 形态——桌面不存在 ["workspaces", id] 直挂写法，必须用既有 "detail" 三段形态
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
