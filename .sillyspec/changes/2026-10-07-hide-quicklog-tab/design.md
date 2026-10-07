---
author: flow-machine-draft
created_at: 2026-10-07T12:25:23.852Z
---
# 设计记录（Design Record）— 2026-10-07-hide-quicklog-tab

## 做法概述

从桌面 `changes/page.tsx` 与移动端 `m/.../changes/page.tsx` 各自模块私有的 `TABS` 常量中移除 `quicklog` 项——tab 栏从此只渲染「进行中 / 已归档」，这是最小面的「隐藏」。`ChangesTab` 类型、`?tab=quicklog` URL 初始化、tabTotals 计数查询、QuicklogTable / QuicklogDrawer 及移动端 quicklog 视图全部保留，深链 `changes?tab=quicklog` 照常进入存量只读视图。tab 栏渲染处随之清理只为 quicklog 服务的特判分支（桌面 label「快速修复（存量）」与 counter 三分支、移动端 `存量 · N` 徽标特判），避免留死代码（CLAUDE.md 规则 18：注释与实现不一致是万恶之源）。

选「隐藏」而非「删除整链路」：存量 quicklog 记录仍是历史事实（usage / 关联变更 / quicklog 会话页均可追溯），且有三处既有深链入口（工作区概览统计卡 stats-row、变更详情 quicklog-linked-card、移动端 mobile-change-detail 重绘）依赖该视图；删除牵动后端接口、lib/quicklog、多页面与会话路由，远超本次意图，也不是用户所求（用户原话「隐藏」）。

## 接口契约

无后端接口、URL 契约、api-types 变化。前端内部可见变化仅两处：① 两页模块私有常量 `TABS` 从 3 项变 2 项（不含 quicklog）；② tab 栏渲染的 quicklog 特判分支删除。`?tab=quicklog` 深链语义、`ChangesTab` 类型取值、tabTotals 查询形状（含 quicklog 计数）均不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：纯展示层 tab 配置收窄，无事件顺序依赖；tabTotals 三计数仍为并发 Promise.all，quicklog 计数到达晚只影响深链视图副标题计数回填时机，与现状一致。
2. 并发写：本变更不触及任何共享可变数据（只读展示配置），不适用：无并发写面。
3. 切换/生命周期：深链进入 quicklog 视图后点「进行中/已归档」可正常切回——UnderlineNav / 移动 tablist 对 value 不在 items 中的情形天然全不选中（已核实组件实现），切换回调不受影响；QuicklogDrawer / 移动详情 Sheet 生命周期不变。
4. 作用域：TABS 为两页面模块私有常量不跨页共享；stats-row / quicklog-linked-card / mobile-change-detail 三处深链 URL 零改动，多工作区无串台。

## 风险与死路

最大风险是既有测试对「点击 tab 进入」路径的依赖（桌面 2 个用例、移动端 12 处点击 + 2 处断言）——逐一改为 `?tab=quicklog` URL 初始化进入，并为隐藏补缺席断言。放弃的方案：a) 彻底删除 quicklog 视图与后端接口（存量历史数据失去唯一入口、牵动面数倍于收益）；b) CSS/条件 className 隐藏 tab 按钮（留下永假分支死代码，违反仓库一致性规则）。两者均未采用。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | TABS 移除 quicklog 项；UnderlineNav label/counter quicklog 特判清理；注释更新 |
| 改 | frontend/src/app/m/workspaces/[id]/changes/page.tsx | TABS 移除 quicklog 项；tab 徽标 `存量 · N` 特判清理；注释更新 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | 2 个 quicklog 用例改深链进入 + tab 缺席断言 |
| 改 | frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx | 12 处 tab 点击改深链进入；计数徽标/URL 初始化用例重写；新增 renderQuicklogPage 辅助 |
