---
author: flow-machine-draft
created_at: 2026-10-22T05:23:58.762Z
---
# 设计记录（Design Record）— 2026-10-22-agent-profiles-page-restyle

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

按四轮反馈定稿的原型（`.sillyspec/explore/prototype-agent-profiles-page-restyle.html`）重构档案列表呈现层，数据流（mine 聚合/搜索/三筛选/预览/CRUD 回调）零变化。三处：①`page.tsx` 页头——共享 `PageHeader` 加**可选 `icon` prop**（向后兼容），右侧 actions 放统计胶囊（N=filtered 数经 grid 上报或页面自算——取 grid 上报 callback？不：统计胶囊显示全量池与默认数，页面从 useMineAgentProfiles 同源取数会重复请求；**改为 AgentProfileCardGrid 新增可选 `onStatsChange` 回调**上报 {total, defaultCount}，页面收敛进胶囊，单数据源）+ 新建按钮；②`agent-profile-card-grid.tsx`——筛选条包进一张卡容器、网格 3 列→2 列；③`agent-profile-card.tsx`——默认档案品牌光晕、系统预置紧凑整卡（占位文案）、提示词引用式排版、技能芯片 +N 截断与空占位、卡脚操作降躁（antd Button type=link 加 muted/悬停类）。共享 PageHeader 的扩展是唯一跨文件契约面，纯增量。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `PageHeaderProps` 新增可选 `icon?: React.ReactNode`（缺省不渲染，既有消费方零影响）。
- `AgentProfileCardGridProps` 新增可选 `onStatsChange?: (stats: { total: number; defaultCount: number }) => void`（缺省不回调；filtered 全量统计在数据到达/变化时上报）。
- `AgentProfileCard` props 零变化；`page.tsx` 组装层变化。无端点/schema/lib 行为变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。onStatsChange 在数据（react-query）到达/变化时随渲染上报最新值，迟到只是多一次上报；胶囊显示全量池统计（非筛选数），与筛选状态解耦不乱序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯呈现层，无写面；CRUD 后既有 mineList invalidate 触发重拉，统计随新数据重报。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。onStatsChange 在 useEffect（依赖 profiles）里上报，组件卸载即停；页面侧只做展示 state，无派生副作用。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不串。统计口径=当前数据源（全局页 mine 聚合/工作区内页单 ws 列表）的池子，随 scopedToWorkspace 天然隔离；样式全走主题 token 随 html[data-theme] 换肤。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：既有三个测试文件断言面广（交互/数据流/文案），重排 DOM 后查询需逐条适配——行为断言不变、仅查询方式调整，防「改测试凑绿」。次风险：系统预置紧凑卡与常规卡共用一个组件的分叉增多——用同一组件内条件类+条件渲染收敛（is_system_default 分支已有先例），不拆两个组件。已放弃方案：①页面层直接 useMineAgentProfiles 自算统计（与 grid 重复请求/双数据源会闪不一致，放弃，改回调上报单源）；②统计胶囊显示筛选后数量（与工具栏计数「共 N」语义重复且既有断言绑定全量语义，放弃，胶囊固定显全量池+默认数）；③系统预置横条卡形态（用户评审三轮定稿否决——太窄，最终形态为紧凑整卡+提示文案）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/layout/page-header.tsx | 新增可选 icon prop（图标块，向后兼容） |
| 修改 | frontend/src/components/layout/__tests__/page-header.test.tsx（如有） | icon 缺省不渲染的兼容断言（无则并入本变更新建） |
| 修改 | frontend/src/app/(dashboard)/agent-profiles/page.tsx | 页头 icon+统计胶囊（onStatsChange 收敛）；actions 组装 |
| 修改 | frontend/src/components/agent-profile/agent-profile-card-grid.tsx | 筛选条收拢卡容器；网格 2 列；onStatsChange 上报 |
| 修改 | frontend/src/components/agent-profile/agent-profile-card.tsx | 默认光晕/系统紧凑卡+占位文案/提示词引用式/芯片+N/操作降躁 |
| 修改 | frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx | 新增 FR-03/04 用例；既有用例查询适配 |
| 修改 | frontend/src/components/agent-profile/__tests__/agent-profile-card-grid.test.tsx | 既有用例查询适配（行为断言不变） |
| 修改 | frontend/src/app/(dashboard)/agent-profiles/__tests__/page.test.tsx | 新增统计胶囊用例 |
| 新增 | .sillyspec/changes/2026-10-22-agent-profiles-page-restyle/visual-evidence.md | 实页三主题渲染对照原型证据 |
