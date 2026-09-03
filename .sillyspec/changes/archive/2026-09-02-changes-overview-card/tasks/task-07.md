---
id: task-07
title: '工作台挂载——/workspaces/[id] page SectionCard 网格挂卡片 + 引导跳变更中心'
title_zh: '工作台挂载——/workspaces/[id] page SectionCard 网格挂卡片 + 引导跳变更中心'
author: 'qinyi'
created_at: 2026-09-03 08:46:57
priority: P0
depends_on: ['task-06']
blocks: [task-08]
requirement_ids: [FR-01, FR-06]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
goal: >
  工作台详情页挂载「活跃变更总览」卡片——/workspaces/[id] page 的 SectionCard 网格区
  挂 task-06 组件并引导跳变更中心，FR-01 前端落地收口。
implementation:
  - page.tsx 段③ SectionCard 网格区（WorkspaceStatsRow / WorkspaceConfigCard 一带，现状 L629-680）挂 ChangesOverviewCard，传 workspaceId 按 FR-06 机器绑定过滤数据源
  - 卡片入口引导跳变更中心 /workspaces/[id]/changes（分工=卡是门铃、变更中心是操作台，design §1）
  - page.test.tsx 新增挂载断言（vi.mock 子组件 data-testid 隔离内部，仿 WorkspaceConfigCard mock 先例）；既有断言因页面 DOM 变化失效的同步更新
acceptance:
  - page 渲染 ChangesOverviewCard（mock 隔离），既有区块（统计行/基本信息/默认智能体/守护进程共享）断言零回归
  - 卡片可见入口指向变更中心路由 /workspaces/[id]/changes
  - page 测试全绿 + tsc 0 错
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/page.test.tsx"（若 vitest 把 [id] 误读 glob 致 0 命中，退化跑 pnpm exec vitest run src/app）
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 changes-overview-card.tsx 组件内部（task-06 产物）；不新增 API/类型/端点
  - 仅跑本 page 相关测试不跑全量（全量留 CI）
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
expects_from:
  - task-06: ChangesOverviewCard 组件（props 契约与挂载形态）
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
