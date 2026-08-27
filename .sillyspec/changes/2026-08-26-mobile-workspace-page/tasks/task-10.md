---
id: task-10
title: 'add-deep-link-sessions-redirect-shells'
title_zh: '深链兜底 redirect 薄壳 ×2（changes/[cid]/sessions、quicklog/[qlId]/sessions → 会话列表）'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-001@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/page.tsx
  - frontend/src/app/m/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/[cid]/sessions/__tests__/page.m-sessions-fallback.test.tsx
  - frontend/src/app/m/workspaces/[id]/quicklog/[qlId]/sessions/__tests__/page.m-sessions-fallback.test.tsx
goal: >
  为桌面变更级/quicklog 级会话门户深链补两条移动 redirect 薄壳，兜底到
  /m/workspaces/[id]/sessions 会话列表（X-02 / Grill C-11），不落 404。
implementation:
  - 新建 changes/[cid]/sessions/page.tsx（"use client"，取 params.id/cid），useEffect 内 router.replace 到 /m/workspaces/${id}/sessions，渲染 null
  - 新建 quicklog/[qlId]/sessions/page.tsx 同型（取 params.id/qlId），redirect 目标同为会话列表
  - 形态与 m/ 段既有 client redirect 一致（m/login:156、m/account:44 均 useRouter().replace，本段无 server redirect 先例）
  - 两个 colocate 测试（同名 page.m-sessions-fallback.test.tsx）——mock next/navigation 断言各自 replace 目标
acceptance:
  - 渲染 changes/[cid]/sessions 页时 router.replace 被调到 /m/workspaces/w1/sessions
  - 渲染 quicklog/[qlId]/sessions 页时 router.replace 被调到 /m/workspaces/w1/sessions
  - 两页面零数据请求（不 import @/lib 请求函数）、零 UI 渲染
verify:
  - cd frontend && pnpm test -- page.m-sessions-fallback
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - redirect 页自身不做数据请求、不渲染 UI（上层 task-02 layout 预取属路由嵌套副作用，不在此处理）
  - 不消费 cid/qlId（scope 丢失可接受，design §9.4）
  - 不改 middleware 与 route-guard
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
