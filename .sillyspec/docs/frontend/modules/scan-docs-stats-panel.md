---
schema_version: 1
doc_type: module-card
module_id: scan-docs-stats-panel
author: qinyi
created_at: 2026-09-21 10:46:39
---

# 扫描文档运营面板（scan-docs-stats-panel）

## 定位
扫描文档页顶部的运营指标面板组件（`frontend/src/components/scan-docs-stats-panel.tsx`，2026-09-21-scan-docs-ops-panel）：四指标子卡（覆盖率+8 周趋势 / 陈旧 90 天 / 每项目密度 / 近 30 天鲜活）+ 注入频次/最近更新双榜 tab（D-003@v1）。形态复刻知识库 OpsDashboard（`components/knowledge/ops-dashboard.tsx`）——指标大卡 2/3 + 榜单卡 1/3（原型 `.ops` 布局）；组件内自带独立 useQuery 数据链，挂载于 ScanDocsPage 的 PageHeader 之下、错误条之上，失败不阻塞主列表。

## 契约摘要
- props（`ScanDocsStatsPanelProps`）：`workspaceId: string`（必传，进查询键与 URL）；`className?: string`（拼根容器）。
- 数据链：`useQuery({ queryKey: scanDocsStatsQueryKey(workspaceId)（= `["scan-docs","stats",workspaceId]`，lib-scan-docs 导出）, queryFn: getScanDocsStats })` → `GET /api/workspaces/{ws}/scan-docs/stats` → `ScanDocsStats`（= OpenAPI 生成 `ScanDocsStatsOut`，禁手写）。
- 布局：根 `flex flex-col gap-3 lg:grid lg:grid-cols-3`；指标大卡 `lg:col-span-2`（四子卡 `grid sm:grid-cols-2` 2×2 + 陈旧清单内嵌开合），榜单卡 1/3（双 tab：🔥 注入频次默认 / 🕘 最近更新）。
- testid 契约（测试锚点，改结构勿改名）：
  - 根：`scan-docs-ops-panel`；三态：`scan-docs-ops-panel-loading` / `-error` / `-empty`。
  - 四子卡：`metric-coverage`（内 `coverage-trend` svg）/ `metric-stale` / `metric-density` / `metric-freshness`。
  - 陈旧清单：`stale-docs-panel`（开合态才渲染）+ 行 `stale-doc-row`。
  - 榜单：`board-tab-injection` / `board-tab-recent`（role=tab）；`injection-board` + `injection-board-row`；`recent-board` + `recent-board-row`。
- 交互状态（组件内 useState，不外抛）：`staleOpen`（陈旧清单卡面点击开合，`aria-expanded`）；`boardTab: "injection" | "recent"`。

## 关键逻辑
- 三态自理（占住同版位不白屏、不闪布局）：
  ```
  isPending → loading 卡（lg:col-span-3 单条）
  isError   → error 红条（border-destructive/30 + bg-red-50，文案「运营指标加载失败…」）
  data 且 freshness.total === 0 → empty 卡（「暂无扫描文档（点击重新扫描…）」）
  数据链独立——stats 失败不影响页面主列表与后台 reparse
  ```
- 综合覆盖率（前端算，design 口径）：`(std_have + module_have) / (std_expected + module_expected)` 取整百分比，卡面同时给两档明细 `七件套 h/e · 模块文档 h/e`。
- 趋势折线 `trendPoints`：8 点等距、按序列最大值归一到纵向区间（全零画底部平线）；与 ops-dashboard 同款但值域不同——那边是 0~1 的 pct，这边是周更新篇数（updated）。
- 剥前缀口径：`stale_docs` / `recent_board` 的 path 是 DB 原始形态（可能带 `docs/` 或 `.sillyspec/docs/` 前缀），渲染时过 `stripPathPrefix`（lib-scan-docs-tree，与树构建同口径）；`injection.board` 后端已剥前缀直接显示——三处路径展示对齐树的锚点口径。
- 时间文案：陈旧「最后修改」`YYYY-MM-DD` 本地时区（空/非法 → 「未知」）；最近榜相对时间（小时/天/周，更久落 `zh-CN` 本地化日期）。

## 注意事项
- 视觉对齐 ops-dashboard（`components/knowledge/ops-dashboard.tsx`）形态：2/3+1/3 网格、迷你趋势 svg（`stroke="currentColor"` 随主题换色）、死条目式「卡面点击开合内嵌清单」、榜单行序号圆徽（榜首 `bg-brand-600` 反白）——改样式先回看该组件，勿自创新形态。
- 主题铁律：品牌色只用 `brand-*` 语义阶（brand-50/100/400/500/600/700，随 html data-theme 换肤）；边框/背景/文字全主题 token（`border-border` / `bg-card` / `text-muted-foreground` / `text-warning` / `text-success` / `shadow-sm`），禁手写十六进制与 `blue-*`；antd 语义色（destructive/warning/success）走 token 映射。文案中文。
- 查询键 `scanDocsStatsQueryKey` 与 `getScanDocsStats` 定义在 lib-scan-docs（模块 `scan-docs.ts`）——后续需要主动刷新（如 reparse 后联动面板）消费同一键 invalidate，勿在组件外另起键。
- stats 字段类型全部来自 `api-types.ts`（`pnpm gen:types` 生成）；后端 DTO 改动须同步重生成，勿手写补字段。
- 空态口径是 `freshness.total === 0`（没扫过或全部不存在），与「注入频次为零但文档存在」（`injection.total_30d === 0` → 榜内空态文案「暂无注入数据（CLI 升级后自动汇聚）」）是两个不同空态，勿混。
- 面板只读展示，无写操作；陈旧清单上限 200 条由后端截断（`STATS_STALE_LIST_LIMIT`），前端仅滚动容器（`max-h-44`）不分页。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
