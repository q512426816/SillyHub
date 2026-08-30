---
id: task-06
title: 'build-mobile-changes-list-page'
title_zh: '变更列表移动页（三Tab+计数+搜索+MobileFilterDrawer 筛选+智能轮询复用）（FR-03）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-02', 'task-04', 'task-05']
blocks: ['task-07']
requirement_ids: [FR-03]
decision_ids: [D-001@V1, D-002@V1, D-004@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx
provides:
  - contract: 'changes/page.tsx 移动版列表骨架'
    fields: ['三Tab 结构与切换', '搜索词状态', 'MobileWorkspaceHeader 接线']
expects_from:
  task-05:
    - contract: PENDING_REVIEW_LABEL
      needs: [PENDING_REVIEW_LABEL]
goal: >
  新建移动版变更列表页（三 Tab+计数+搜索+筛选抽屉+智能轮询），数据层 100% 复用
  桌面 query key 与纯函数，让手机端获得可用的变更中心列表（FR-03）。
implementation:
  - '新建 frontend/src/app/m/workspaces/[id]/changes/page.tsx（"use client"）：MobileWorkspaceHeader（task-04，tab="changes"）作顶栏，工作区数据从 task-02 layout Provider 取；Tab 值对齐桌面 TABS（active 进行中/archive 已归档/quicklog 快速修复，page.tsx:52）与 STAGE_OPTIONS（:70，模块私有就地内联不 export）'
  - '主列表 useQuery key 逐字对齐桌面 page.tsx:149：["changes", workspaceId, { location: tab, search, currentStage: stageFilter, sort: sortDir, pendingReviewOnly: tab === "active" && focusMine, page, pageSize }]；queryFn 与桌面同构（listChanges 全参 + getWorkspace 的 Promise.all），同 key 下缓存条目形状一致、共享 ["changes"] 失效前缀'
  - '计数 useQuery key 逐字对齐桌面 page.tsx:209：["changesTabTotals", workspaceId]（active/archive/quicklog 三计数，retry:false 不轮询不随筛选变化）；快速修复 Tab 本卡仅渲染计数与空态占位，卡片列表由 task-07 同文件续作'
  - '智能轮询复用：refetchInterval: (q) => changesRefetchInterval(q.state.data)（page.tsx:106 已导出 import，非终态 30s/全终态停，R-07 语义）'
  - '搜索框 + MobileFilterDrawer（props：open/onOpenChange/onApply/onReset，children = 阶段选择 + 只看待我处理 focusMine 开关）；应用即改 state → key 变化自动重取，重置回默认对齐桌面 handleResetClick'
  - '列表用 MobileChangeCard（task-05）渲染，点击 router.push 到 /m/workspaces/[id]/changes/[cid]；分页用底部「加载更多」递增 page（key 含 page 参数与桌面同构）；空态引导跳 /m/workspaces/[id]/sessions（对齐桌面 :443 行为）'
  - '新增 colocate 测试 __tests__/page.test.tsx：tab 切换与计数徽标、主列表/计数 query key 形态逐字断言、筛选抽屉应用与重置、卡片点击导航、changesRefetchInterval 接线（全终态 false）、空态引导'
acceptance:
  - 三 Tab 切换列表与计数徽标（["changesTabTotals", workspaceId]）刷新；进行中 Tab 按 changesRefetchInterval 智能轮询、全终态停
  - 主列表 query key 与桌面 page.tsx:149 逐字一致（含 pendingReviewOnly 仅 active+focusMine 生效），测试锁 key 形态
  - 搜索与筛选抽屉（阶段/只看待我处理）应用后列表按条件过滤，重置回默认
  - 卡片点击全屏钻取 /m/workspaces/[id]/changes/[cid]；空态引导跳移动会话列表
verify:
  - cd frontend && pnpm test -- "src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 禁止修改桌面 (dashboard)/workspaces/[id]/changes/page.tsx（PENDING_REVIEW_LABEL export 已由 task-05 完成，本卡只 import 既有导出）
  - 数据函数与轮询纯函数一律 import 既有导出（listChanges/changesRefetchInterval/isTerminalChange 等），禁止复制第二份实现；query key 逐字对齐，禁止增删槽位
  - quicklog Tab 卡片列表不在本卡范围（task-07 续作），本卡仅 Tab 壳+计数+空态占位
  - 零后端改动：不新增 API 调用、不改 api-types（D-001 纯渲染层）；样式只用语义 token
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
