---
id: task-10
title: 前端测试（machine-card/runtime-card/use-daemon-machines + page 适配）（覆盖 FR-4,5,6,7）
author: WhaleFall
created_at: 2026-07-07 16:30:00
priority: P0
depends_on: [task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [FR-4, FR-5, FR-6, FR-7]
decision_ids: [D-002, D-003, D-004, D-006, D-007]
allowed_paths:
  - frontend/src/components/daemon/__tests__/machine-card.test.tsx
  - frontend/src/components/daemon/__tests__/runtime-card.test.tsx
  - frontend/src/lib/__tests__/use-daemon-machines.test.ts
  - frontend/src/app/(dashboard)/runtimes/page.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
provides: {}
expects_from:
  task-06:
    - contract: useDaemonMachines
      needs: [items, sessions, refetchInterval=15000]
  task-07:
    - contract: RuntimeCard
      needs: [runtime, usage, 无 Daemon 版本行]
  task-08:
    - contract: MachineCard
      needs: [machine, expanded, 聚合费用, runtime 数胶囊]
---

goal: > 为新两级结构补齐前端单测并适配既有 page 测试，使 design §11 前端验收点全部可验证、pnpm test 全过。

implementation:
  - machine-card.test.tsx：折叠头默认折叠，点 chevron 展开后渲染内嵌 RuntimeCard 网格；expanded prop 受控记忆（切页保留由 page 测试覆盖）；聚合费用胶囊 = sum(该机器 runtimes usage.total_cost_usd)；runtime 数胶囊显示 online/total；0-runtime 机器展开体显空态文案；离线机器升级按钮 disabled（onUpgrade 不触发）。
  - runtime-card.test.tsx：用量统计区 4 数字（输入/输出/缓存/费用）k/M 格式化 + sparkline 空/非空分支；可写目录渲染；操作按钮组（会话/审计/启禁/移除）在位；meta 无「Daemon 版本」行（C-002，反向断言不出现）。
  - use-daemon-machines.test.ts：data shape 返回 items/total/sessions；params 变化走新 queryKey（仿 use-daemon-runtimes.test.tsx）；listAgentSessions 失败降级 sessions=[]；refetchInterval=15000 配置在（用 vi.useFakeTimers 验轮询触发或断言选项传入）。
  - page.test.tsx/page-usage.test.tsx 适配：mock /api/daemon/machines（listDaemonMachines）替换 listDaemonRuntimes*；机器级 SummaryCard 计数（按 machine.status）；机器级分页器/筛选；?session=<id> 自动展开所属 machine（machines.flatMap(m=>m.runtimes) 查找）后开弹窗；移除/会话/审计交互从 machine 展开体内 runtime 卡触发，沿用现有 within(dialog) Modal 模式。

## 验收标准
  - pnpm test 全过，新增 3 文件 + 既有 2 文件全绿。
  - 覆盖 design §11 前端验收点：折叠/展开、展开态记忆、聚合费用、runtime 数胶囊、0-runtime 空态、离线升级 disabled、runtime 卡用量 4 数字+sparkline、去 Daemon 版本行（C-002）、SummaryCard 机器级、机器级分页/筛选、?session= 自动展开+开弹窗。
  - 既有 page.test.tsx / page-usage.test.tsx 适配两级结构后用例通过（含移除 409 中文 message、审计 href、时间窗切换、codex「—」）。

verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit

constraints:
  - 不修改被测实现（task-06/07/08/09 产物）来迁就测试；测试先行暴露问题走 task 回修。
  - 复用既有 mock 脚手架：vi.hoisted + vi.importActual("@/lib/daemon") + next/navigation mock + QueryClientProvider（retry:false/gcTime:0）+ EventSource stub + useSession.setState，禁止自造一套。
  - 测试断言的中文文案必须与组件实际 UI 文案一一对齐（空态/胶囊/按钮 aria-label），避免误绿。
  - 不引入 msw（现有 page 测试用 vi.mock 函数级 mock，保持一致）；hook 测试沿用 renderHook + waitFor 模式。
