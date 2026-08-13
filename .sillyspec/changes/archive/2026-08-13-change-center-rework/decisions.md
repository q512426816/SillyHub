---
author: qinyi
created_at: 2026-08-13 09:41:17
---

# 决策台账 — 2026-08-13-change-center-rework

本次变更的决策台账（不是长期术语表）。只记录有实现/验收影响的决策。

## D-001@v1: 重做范围 = 列表层做透
- type: boundary
- status: accepted
- source: user
- question: 变更中心重做到什么程度？
- answer: 只重做列表层（待我处理筛选 + 待审核徽标 + 排序 + 空状态 + 清理小毛病）；审核/触发下一步仍点进详情页；不动详情页。
- normalized_requirement: 不改 `changes/[cid]/page.tsx` 及其详情子组件；改动集中在列表页 `changes/page.tsx` + 后端列表投影/排序。
- impacts: [FR-01, 非目标 NG-03]
- evidence: 用户 AskUserQuestion 选择「列表层做透」
- priority: P0

## D-002@v1: 「待我处理」语义 = 全局待人工，不引入 assignee
- type: architecture
- status: accepted
- source: user + code
- question: 「待我处理」是全局待人工，还是分配给当前用户？
- answer: 全局待人工（`pending_review` 非空即算）。现有模型无 assignee/assigned_to/reviewer_id 概念（change 模块全仓 grep 零命中，`Change` ORM 无 assignee 列）。
- normalized_requirement: 「待我处理」筛选 = `pending_review IS NOT NULL`；不新增 assignee 字段、不新增 migration、不做指派 UI。
- impacts: [FR-02]
- evidence: `backend/app/modules/change/` grep assignee 零命中；`model.py:96` Change ORM 字段；用户 AskUserQuestion 选择「全局待人工」
- priority: P0

## D-003@v1: ChangeSummary 加 pending_review 走投影复用，零 migration
- type: architecture
- status: accepted
- source: code
- question: 列表层如何拿到 pending_review，要不要加持久化字段？
- answer: 复用 `StageProjectionService.compute_pending_review`（`projection.py:130`，纯只读计算，读 sillyspec.db stages 表）。新增批量方法 `compute_pending_review_batch`，列表 service 构建时一次算完塞进 `ChangeSummary`。不加数据库列、零 migration。
- normalized_requirement: `ChangeSummary` schema 加 `pending_review: str | None`；service.list 用批量投影填充；不动 changes 表结构。
- impacts: [FR-02, 数据模型, 文件变更清单]
- evidence: `schema.py:47` ChangeSummary；`projection.py:175` `_map` 纯函数；数据源走 D-008（PG 镜像，非 sillyspec.db）。⚠️ 纠正：原 evidence「compute_pending_review 详情页已用」错误——详情 READ（`enrich_with_workspace_ids:1225`）不调投影，`ChangeRead.pending_review` 恒 None；本变更仅列表层接通真实投影
- priority: P0

## D-004@v1: 列表默认排序改「最近活动优先」
- type: boundary
- status: accepted
- source: code
- question: 列表默认排序用什么？
- answer: 默认 `updated_at DESC`（最近活动优先）。现默认是 `change_key ASC`（`service.py:149`，字母序无业务意义），改为 updated_at desc；list API 支持 `sort` 参数。
- normalized_requirement: list service 默认 ORDER BY updated_at DESC；前端默认传 sort=updated_at；列头可切换排序方向。
- impacts: [FR-04]
- evidence: `service.py:149` `.order_by(col(Change.change_key).asc())`
- priority: P0

## D-005@v1: 方案 = 后端批量投影（部分被 D-007 修正）
- type: architecture
- status: accepted（批量思路保留；呈现→D-007 修正；数据源 sillyspec.db→PG 镜像→D-008 修正）
- source: user
- question: 三个实现方案选哪个？
- answer: 选方案 B「准」：后端一次性批量算完所有变更 pending_review（`compute_pending_review_batch`，性能稳，内聚在 projection.py）；前端待我处理做成默认聚焦呈现。
- normalized_requirement: 新增 `compute_pending_review_batch(change_ids) -> dict[id, pending_review]`，列表 service 单次调用填充。
- impacts: [FR-02, 文件变更清单]
- evidence: 用户 AskUserQuestion 选择「方案B」
- priority: P0

## D-006@v1: title 归属 = sillyspec（proposal.md），平台只展示不加工
- type: architecture
- status: accepted
- source: user + code
- question: 变更中文标题谁负责？平台要不要兜底生成？
- answer: title 源头是 sillyspec 产物 `proposal.md` 的第一个 `# 一级标题`；平台 reparse 解析展示，取不到 fallback 到 change_key（`parser.py:484`）。**平台不加工、不编造友好标题**。让 title 有中文是 sillyspec 流程的事（proposal.md 须带中文一级标题），记为 sillyspec 工具改进点，不在平台代码兜底。
- normalized_requirement: 本次不改 title 解析/展示逻辑（维持现状）；撤回「平台把 change_key 转友好标题」提议；本 change 的 proposal.md/design.md 自带中文一级标题做示范。
- impacts: [非目标 NG-04]
- evidence: `parser.py:479-484` Title resolution 注释明确「title 归文件，元数据归平台 DB」；sillyspec.db 实测 105 条 change title 82% 为空（仅 quick 有）；用户明确「sillyspec 控制，平台展示」
- priority: P1

## D-007@v1: 「待我处理」=「进行中」视图的聚焦筛选（不并列 tab）
- type: architecture
- status: accepted
- source: user
- supersedes: D-005@v1 中「待我处理做独立默认 tab/视图」部分
- question: 「待我处理」和「进行中」并列做 tab 会维度混搭（待我处理 ⊂ 进行中），如何避免混淆？
- answer: 主 tab 维度统一为 location：**进行中 / 已归档**。「待我处理」作为「进行中」视图内的一个聚焦筛选开关（`☑ 只看待我处理(N)`），**默认勾上**（进页面只看待审核的，取消勾选看全部进行中）。
- normalized_requirement: 主 tab = 进行中/已归档（按 location）；进行中视图顶部一个 toggle「只看待我处理」，默认 true，true 时筛选 pending_review 非空；不新增「待我处理」独立 tab。
- impacts: [FR-01, FR-02, 文件变更清单-前端]
- evidence: 用户 AskUserQuestion 选择「作为进行中的聚焦筛选」；待我处理 ⊂ 进行中（pending_review 非空 ⊂ location=active）
- priority: P0

## D-008@v1: pending_review 走 PG 镜像（非 sillyspec.db），与 current_stage 同源
- type: architecture
- status: accepted
- source: code（Design Grill 审查发现）
- supersedes: D-005@v1 的数据源部分（sillyspec.db 直读）
- question: 列表 pending_review 数据源——读 sillyspec.db（spec-sync 副本）还是读 PG 进度镜像？
- answer: 走 PG `platform_change_progress.latest_progress`（serializeForSync 六表 JSON，含 stages 表）。列表 `_project_current_stage` 已批量 join 此镜像读 current_stage（`service.py:1266`），扩展解析 stages + `_map`（`projection.py:175` 纯函数）算 pending_review。
- normalized_requirement: 列表 pending_review 不读 sillyspec.db；复用 _project_current_stage 批量 PG join；解析 latest_progress.stages 得 completed 集合 + _map 算；pending_review 与 current_stage 同源自洽；compute_pending_review/sillyspec.db 仅留 review 门禁 _assert_pending_review 用。
- impacts: [§5 Phase1, §6, §7, §8, R-03(消除), R-07, tasks-01/02]
- evidence: Design Grill 子代理 grep 证伪「详情页已用 compute_pending_review」（`enrich_with_workspace_ids:1225` 不调投影，ChangeRead.pending_review 恒 None）；`platform_sync/model.py:39` latest_progress 六表 JSON 含 stages；`service.py:1266/1298` 列表已批量读 latest_progress 取 current_stage
- priority: P0
