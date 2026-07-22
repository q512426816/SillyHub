---
id: task-08
title: 工作台移动视图 app/m/ppm/workbench 卡片流（待办/快捷入口/统计，纵向单列）
title_zh: 工作台移动视图
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P1
depends_on: [task-05, task-07]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003, D-008]
allowed_paths:
  - frontend/src/app/m/ppm/workbench/page.tsx
provides: [{contract: WorkbenchMobilePage, fields: [WorkbenchMobilePage]}]
expects_from: [{contract: MobileLayout, needs: [MobileLayoutShell]}, {contract: MobileComponents, needs: [MobileCardList]}]
goal: >
  新增 app/m/ppm/workbench/page.tsx（FR-04）：桌面三栏（个人信息/待办·指标·任务 / 工作日历·快捷入口）在手机重排为
  纵向单列卡片流，入口与桌面对齐。
implementation:
  - '数据复用 @/lib/ppm/workbench：fetchWorkbenchProfile / fetchWorkbenchSummary(range) / fetchWorkbenchCalendar(yearMonth)；类型 @/lib/ppm/types'
  - '沿用桌面 BlockState<T> 装配（apiFetch+useEffect+每块独立 try/catch），三块互不阻塞；summaryRange/calendarMonth 切换重载'
  - '渲染独立：task-05 MobileLayoutShell 作容器、task-07 MobileCardList/移动卡片承载各区块；跳转相对路径（middleware 自动 rewrite）'
acceptance:
  - 手机访问 /ppm/workbench 经 middleware 渲染移动卡片流，三栏纵向单列无横向滚动
  - profile/summary/calendar 三块独立 loading/error/重载，单块失败不阻塞其余；range 与月份切换生效
  - 任务执行回跳、快捷入口、平台切换等入口与桌面等价可用
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 复用 lib/ppm/workbench 数据层，禁止自写 fetch/请求（D-003）
  - 移动视图与桌面功能对齐，桌面全功能入口移动端等价（D-008）
  - 桌面 (dashboard)/ppm/workbench/** 不改（零回归）；触摸≥44×44px、正文≥14px
---

# task-08 · 工作台移动视图

依据 design §5.3/FR-04。桌面三栏→移动纵向单列卡片流，复用 lib/ppm/workbench 数据。
