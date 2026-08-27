---
id: task-09
title: '前端守护进程页面——「共享给我的」区块（shared-machines-section，仅会话操作）+ 平台共享智能体管理卡（platform-shared-agents-card：创建表单/生效列表/停用）+ 统计计数 + lib/daemon.ts sharedAgents API 封装 + 两组件测试'
title_zh: '前端守护进程页面——「共享给我的」区块（shared-machines-section，仅会话操作）+ 平台共享智能体管理卡（platform-shared-agents-card：创建表单/生效列表/停用）+ 统计计数 + lib/daemon.ts sharedAgents API 封装 + 两组件测试'
author: 'qinyi'
created_at: 2026-08-28 01:24:05
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v2]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/components/daemon/shared-machines-section.tsx
  - frontend/src/components/daemon/platform-shared-agents-card.tsx
  - frontend/src/components/daemon/__tests__/shared-machines-section.test.tsx
  - frontend/src/components/daemon/__tests__/platform-shared-agents-card.test.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
related_tests:
  - frontend/src/app/(dashboard)/runtimes/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
provides:
  - contract: SharedAgentsApi
    fields: [fetchSharedAgentsActive, createSharedAgent, disableSharedAgent]
goal: >
  /runtimes 页落地 FR-01「共享给我的」区块与 FR-04 平台共享智能体管理卡（含「共享给我」统计计数），并在 lib/daemon.ts 封装 sharedAgents API 供管理卡与档案选择器复用。
implementation:
  - lib/daemon.ts 按 task-08 生成的 api-types 新增 sharedAgents 封装（fetchSharedAgentsActive / createSharedAgent / disableSharedAgent 及 admin 全量列表），端点对齐 /api/daemon/shared-agents 系列
  - 新组件 shared-machines-section.tsx——props 接收共享机器列表，虚线卡对齐原型 .machine.shared（共享人/来源工作区/在线徽标），操作仅「会话」（useFloatingSessionStore.openRuntimeSession 唤起悬浮助手），离线禁用
  - 新组件 platform-shared-agents-card.tsx——仅 platform admin 渲染（useSession user.is_platform_admin === true，先例 agent-profiles/page.tsx 52 行）；创建表单（档案/自己名下在线 runtime/源码工作区/writable_dir）+ 生效列表 + 停用
  - page.tsx 统计行加「共享给我」SummaryCard（品牌高亮对齐原型 .stat.hl）+ 挂载两区块；shared_to_me 数据经 react-query 复用 daemonMachines.list 同 queryKey 直读响应（useDaemonMachines 的 sharedToMe 透传归 task-10，不重复请求）
  - 两组件测试（渲染/修改类按钮不渲染/表单校验/停用交互）+ 既有 page 测试 mock 补 shared_to_me 字段适配
acceptance:
  - 共享机器卡仅渲染「会话」操作——别名/可写目录/升级/禁用/移出一律不渲染（FR-03，测试断言按钮不存在）
  - 管理卡仅 platform admin 渲染，非 admin 页面不出现该卡（测试断言）
  - 统计行出现「共享给我」计数且等于 shared_to_me 条数
  - 无共享数据时页面渲染与现状一致（既有 page 测试断言不改即通过，兼容红线）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/shared-machines-section.test.tsx src/components/daemon/__tests__/platform-shared-agents-card.test.tsx
  - cd frontend && pnpm test "src/app/(dashboard)/runtimes/__tests__/page.test.tsx" "src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx" "src/app/(dashboard)/runtimes/page.test.tsx"
constraints:
  - 共享机器卡仅渲染「会话」操作，别名/可写目录/升级/禁用/移出一律不渲染（FR-03）
  - 样式遵循 FRONTEND_PAGE_STYLE.md §0.5——brand-* 语义阶、antd 组件经 ConfigProvider、阴影走主题 token，不硬编码 hex（原型虚线卡/徽标即此风格）
  - 管理卡仅 platform admin 渲染；统计行加「共享给我」计数
  - sharedAgents 类型一律用 task-08 生成的 api-types（SharedAgentView/SharedAgentActiveView），禁止手写 DTO
  - 不改 use-daemon-machines.ts（sharedToMe 透传属 task-10），shared_to_me 读取复用同 queryKey 缓存
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
