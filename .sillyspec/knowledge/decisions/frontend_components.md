# 决策知识 — frontend_components

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 会话轮次导航 = 桌面常驻左栏 + 移动端收 ⋯ 菜单抽屉
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：ZCode 式导航用户定案；桌面常驻（刻度轨仅 ~30px 不占聊天宽度），mobile 触屏无 hover 走 ⋯ 菜单抽屉行式列表（点击即跳），dialog 宿主不挂载。

## D-002@v1 : 目录覆盖全部历史轮次（runs 补全 + 点击循环加载定位）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：高轮次回顾是核心痛点，仅已加载轮次不解决；未加载轮次由 runsMeta 补全为空心刻度，点击时复用触顶翻页链循环加载（≤8 页、suppress 触顶自动加载）到命中再 scrollIntoView。

## D-004@v1 : 目录数据 = 前端拼装（displayTurns + runsMeta），零后端改动
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/session-panel-page.tsx`
最近确认：fd96ae48
理由：runsMeta（attach/每轮完成已全量拉刷）+ displayTurns 信息足够拼目录；方案 C（后端摘要端点）引新契约 YAGNI 拒绝、方案 B（仅已加载）违 D-002 排除；runs 接口无 prompt 字段，未加载条目 v1 元数据+点击回填（D-005）。

## D-006@v1 : 悬浮窗归 desktop variant 分支（Grill 修正，D-007 后零改动复用刻度轨）
状态：implemented
变更：2026-09-08-session-turn-nav
锚点：`frontend/src/components/daemon/session-panel/index.tsx`
最近确认：fd96ae48
理由：floating-session-host 不传 variant → index.tsx 默认 desktop，mobile ⋯ 菜单守卫在其不渲染；修正后的刻度轨仅 ~30px 宽，悬浮窗直接复用 desktop 形态无需折叠或特殊处理。
