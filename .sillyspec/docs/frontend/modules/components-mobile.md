---
schema_version: 1
doc_type: module-card
module_id: components-mobile
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 移动端专用组件（components-mobile）

## 定位
移动端（/m/ 域，PPM 业务）专用组件（`components/mobile/`，12 个 tsx：10 组件 + 2 测试）。
两条铁律：① 独立于桌面组件体系——不复用 / 不改桌面 app-shell、top-bar、components/layout
（D-001 桌面零回归）；② 数据层 100% 复用 lib/ppm 等现有客户端（D-003 禁止自写请求）。
全组件遵守 R-04：触摸热区 ≥ 44×44px、正文 ≥ 14px。

## 契约摘要
- `MobileAppShell`（`mobile-app-shell.tsx`）：三段式外壳 = MobileTopBar + 内容区
  （flex-1 overflow-y-auto + pb-20 避让底栏）+ MobileTabBar。
  - 容器 `h-[100dvh] max-w-[480px]` 居中（100dvh 动态视口兼容移动浏览器地址栏伸缩；
    宽屏上限 480px 防拉伸）。
  - main 显式 `text-[14px]`；路由守卫不在本组件（在 app/m/layout，另一任务）。
  - props：`children / activeTab? / title? / onBack?`（透传子栏）。
- `MobileTabBar`（`mobile-tab-bar.tsx`）：底部 5 Tab 导航。
  - `MOBILE_TABS` 单一数据源（key: workbench / task-plans / problem-list / mine /
    switch；label + href + matchPrefix + icon）。
  - 链接一律**原始路径**（/ppm/*、/workspaces、/account）——手机访问由 middleware
    服务端 rewrite 到 /m/ 段（URL 不变、无 FOUC），本组件不感知 /m/。
  - 高亮：`usePathname()` 前缀匹配（isTabActive 语义同桌面侧栏）；`activeTab`
    受控覆盖优先。热区 min-h/min-w-[44px] + flex-1。
- `MobileTopBar`（`mobile-top-bar.tsx`）：简洁顶栏（可选返回箭头 + 可选标题，
  truncate 防溢出）；不带桌面 TopBar 的面包屑/搜索/通知/用户菜单（这些下沉到底部
  Tab 与「我的」页）。
- `MobileCardList<T>`（`mobile-card-list.tsx`）：通用移动卡片列表，全功能替代桌面
  antd Table。
  - `items` + `renderCard(item)`（泛型，组件不猜字段）+ `onItemPress?`（点卡片进详情）。
  - `actions?(item) => MobileAction[]`：空数组不渲染「⋯」；点击经 MobileActionMenu。
  - `selectable` + `selectedKeys / onSelectedKeysChange`：批量选择受控；批量栏由
    页面用 MobileBatchBar 组合（解耦）。
  - `pagination`：`MobileListPagination { page, pageSize, total, onChange }`——对接
    现有 page/page_size 分页，**不用无限滚动**（D-008）；onChange 由页面重取数据。
  - `headerActions?`（创建/导出/筛选触发器槽）、`itemKey?`（默认 item.id）、`emptyText`。
  - 类型 `MobileAction` 从本文件一并 re-export（消费方入口统一）。
- `MobileFilterDrawer`（`mobile-filter-drawer.tsx`）：筛选抽屉（antd Drawer
  placement=right width=100%，wrapper max-w-480 居中）。
  - 受控 open/onOpenChange；内置「筛选」触发按钮（也可放 headerActions）。
  - 底部「重置」（onReset，保留打开态供再筛）/「确定」（onApply + 自动关闭）。
  - children 为筛选项（页面填 antd Form / 原生控件），组件不感知字段。
- `MobileDetailSheet`（`mobile-detail-sheet.tsx`）：全屏表单抽屉（替代桌面 Modal）。
  顶栏标题 +「保存」提交钮；`loading` 置灰防重复提交；children 为表单内容。
- `MobileActionMenu`（`mobile-action-menu.tsx`）：底部 ActionSheet（Drawer
  placement=bottom，height=auto 贴合动作数）。`MobileAction { key, label, danger?,
  onPress }`；点击动作 → onPress → 自动关闭；danger 动作红色。
- `MobileBatchBar`（`mobile-batch-bar.tsx`）：批量选择态固定底栏（fixed inset-x-0
  bottom-0 z-50 盖 TabBar z-40）。左侧「已选 N 项」+ 删除（danger）+ extraActions 槽；
  纯 UI，数据由页面维护。
- `MobileExportButton`（`mobile-export-button.tsx`）：导出入口（放 headerActions）；
  loading 置灰「导出中…」；纯 UI，请求由页面发。
- `MilestoneSheet`（`milestone-sheet.tsx`）：里程碑第一层可复用面板（Drawer 内嵌
  MobileCardList 卡片列表 + 新建/编辑/删除 + 导出 + 钻取）。
  - 两处消费：里程碑明细主页（第一层整页，onDrill 下钻）与项目计划页（抽屉内只看
    里程碑层）。
  - 数据复用 lib/ppm（getProjectPlan / listPsPlanNodes / CRUD / exportMilestoneDetails，
    D-006 禁自写请求）；表单复用桌面抽出的 `PsPlanNodeDrawer`（D-007 单一源）。
  - readOnly = !plan.can_edit（后端按项目成员角色集中判断），只读隐藏新建/编辑/删除。
- 测试：`mobile-tab-bar.test.tsx` / `mobile-card-list.test.tsx`。

## 关键逻辑
- 卡片列表组合模式（页面层拼装，组件间解耦）：
  ```
  <MobileCardList items pagination={page/page_size} selectable
     renderCard={...} actions={item => [...]}
     headerActions={<MobileExportButton/> 或 筛选触发} />
  批量态：selectedKeys + <MobileBatchBar onDelete .../> 由页面组合
  ```

## 注意事项
- Tab 链接必须写原始路径（/ppm/workbench 等），/m/ rewrite 由 middleware 负责——
  组件内出现 /m/ 前缀即错。
- 容器宽度上限 480px 是全局约定（shell / drawer wrapper / batch bar 均对齐居中），
  新增浮层须同样限宽。
- z 序约定：MobileTabBar z-40，MobileBatchBar z-50 盖其上；新增浮层按此序排。
- 触摸热区 44×44px 与正文 14px 是 R-04 硬性验收项，新组件/改样式不可破。
- MilestoneSheet 复用桌面 PsPlanNodeDrawer（W1 抽出的共享件），改该表单须同时回归
  桌面侧；Toast 用 ppm shared 的 useToast/Toast 保持一致交互。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
