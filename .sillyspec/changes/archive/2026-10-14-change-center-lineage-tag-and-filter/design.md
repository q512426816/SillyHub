---
author: flow-machine-draft
created_at: 2026-10-14T02:54:10.975Z
---
# 设计记录（Design Record）— 2026-10-14-change-center-lineage-tag-and-filter

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

「完整/轻量」出身的权威口径是后端 `_is_thin_lineage` 三分支投影（stage=thin / change_type=quick / 归档 steps 无标准四阶段兜底 + 2026-09-25 时间窗），它不是数据库列，SQL 无法完整表达（分支③要解析 `platform_change_progress.latest_progress` JSON 的 steps）。因此筛选采用仓库现成的「全局集合 → SQL IN」两阶段先例（`_resolve_pending_change_keys`，ql-20260813-005）：`service.list_` 新增 `lineage` 参数，先按 workspace 现算 thin 出身 `(change_key)` 集合（精确复用 enrich_summaries 的同一判定函数与投影覆盖顺序），再 `IN` / `NOT IN` 过滤——thin 集合与 `is_thin` 投影同源同函数，天然逐行一致，归档 tab 也正确。前端桌面列表行补「完整」neutral 标签（`!is_thin`），筛选区新增「分类」下拉并从阶段下拉移除「轻量变更」项（旧项走 `current_stage=thin` 精确匹配，筛不到归档 thin 行，口径弱于新参数，迁移后职责单一）；移动端筛选抽屉加分类 chips、卡片加出身标签对齐桌面。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/workspaces/{wid}/changes` 新增 Query 参数 `lineage: str | None`（`thin`|`full`|缺省；其他值忽略不过滤，对齐 sort 白名单 fallback 风格）；router 透传 `service.list_`。
- `ChangeService.list_` 新增 keyword 参数 `lineage: str | None = None`；新私有方法 `_resolve_thin_lineage_keys(workspace_id) -> set[str]`（无缓存 v1，量级对齐 pending 集合先例）。
- 前端 `listChanges` params 新增 `lineage?: string` → `?lineage=`；`frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 经 `pnpm gen:types` 重新生成。
- 桌面 `STAGE_OPTIONS` / 移动 `STAGE_OPTIONS` 移除 `{ value: "thin" }` 项；新增 `LINEAGE_OPTIONS`（桌面下拉 / 移动 chips）；`MobileChangeCard` 徽标行新增出身标签（不改 props，读 `change.is_thin`）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：集合计算每次请求现算（无缓存），progress 迟到上行只影响之后发起的列表请求，不存在脏缓存窗口；投影 join 不命中（无 progress 行）时与 enrich_summaries 一致 fallback changes 行现值判分支①②，行为确定。
2. 并发写：本路径纯只读；集合计算与主查询在同一 session 内先后执行，写入方（CLI progress 推送/reparse）commit 后的请求自然看到新集合，短暂滞后为最终一致，无锁、无覆盖风险。
3. 切换/生命周期：`lineage` 是无状态查询参数，翻页/切 tab/切分类各自独立生效（queryKey 含 lineage，互不污染）；`location='deleted'` 行不进 thin 集合（与 enrich_summaries 口径一致——deleted 行在 is_thin 赋值前 continue，投影恒 False 渲染「完整」标签），归档 tab 三源并集兜底行参与 full 分类，标签与筛选结果不分裂。
4. 作用域：集合按 `workspace_id` 精确过滤收集；过滤谓词 `change_key IN (ws 内 thin 集合)`，而 change_key 在 workspace 内唯一（get_by_key 按 ws+key 定位），跨 workspace 同名变更不会串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`_resolve_thin_lineage_keys` 全 workspace 拉行 + outerjoin progress 肥 JSON，大 workspace 下列表请求变慢。评估：与现网 `pending_review_only` 聚焦路径同量级（后者已有 Redis read-through 缓存先例），v1 先现算不加缓存，超预期再按先例挂缓存，不阻塞本变更。死路①：把三分支直译 SQL（PG jsonb + SQLite json_each 跨方言 JSON 展开）——方言分裂、防御解析逻辑（畸形 steps 容忍）难复刻，放弃。死路②：changes 表物化 `is_thin` 列——出身是投影语义（依赖 progress JSON 与时间窗），同步成本高且易漂移（注释↔实现不一致是万恶之源），放弃。死路③：筛选沿用 `current_stage != 'thin'` 取反——漏归档兜底行、与行内标签口径分裂，放弃。
