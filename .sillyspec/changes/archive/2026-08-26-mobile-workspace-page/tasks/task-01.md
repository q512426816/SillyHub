---
id: task-01
title: 'add-drill-routes-bare-branch-to-mobile-layout'
title_zh: 'm/layout 加 DRILL_ROUTES 钻取裸容器分支（无底部 Tab）+ 正则纯函数与测试'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: [task-09, task-11, task-15]
requirement_ids: [FR-09, FR-11]
decision_ids: [D-004@V1, D-001@V1]
allowed_paths:
  - frontend/src/app/m/layout.tsx
  - frontend/src/app/m/layout.test.tsx
goal: >
  给 app/m/layout.tsx 加钻取页（changes/[cid]、sessions/[sid]）裸容器分支，隐藏底部
  Tab 并导出正则纯函数供测试，既有 /m 路径零命中零回归。
implementation:
  - layout.tsx 导出纯函数 isDrillRoute(pathname)，内部复用 stripMobilePrefix 后匹配 ^/workspaces/[^/]+/(changes|sessions)/[^/]+；列表页 /workspaces/:id/changes、/workspaces/:id/sessions（无第四段）不得命中
  - MobileLayoutShell 在 !accessToken 判空之后加分支，isDrillRoute 命中时返回裸容器（mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col 直出 children，不裹 MobileAppShell）
  - 同步 layout.tsx 头部 R-10 防漂移注释锚，登记 DRILL_ROUTES 分支语义（design §5.5）
  - layout.test.tsx 新增 describe——纯函数命中/不命中用例 + 渲染用例（钻取路径 children 直出且无 mobile-app-shell，列表页仍裹 Shell）
acceptance:
  - isDrillRoute 对 /workspaces/w1/changes/c1、/workspaces/w1/sessions/s1 返回 true；对 /workspaces/w1/changes、/workspaces/w1/sessions、/login、/workspaces、/ppm/workbench 返回 false
  - pathname 为 /m/workspaces/w1/changes/c1 时 children 渲染且 queryByTestId("mobile-app-shell") 为 null
  - layout.test.tsx 既有 13 条用例零修改全绿（FR-11 零回归）
verify:
  - cd frontend && pnpm test -- src/app/m/layout.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 route-guard.ts 守卫逻辑本身（/workspaces/:id/** 已在 route-guard.ts:96 放行，零改动）
  - 不改 MobileAppShell 与 mobile-tab-bar，普通页渲染路径零变化
  - 正则只消费 strip 后的桌面形态路径，与 stripMobilePrefix 保持单一约定
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
