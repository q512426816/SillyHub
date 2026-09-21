## FR-lib-changes-001 完整度计数只以四件套为分母
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个变更目录下存在 proposal/design/requirements/tasks 四件套且无可选文档；When 用户打开变更详情页查看"变更文档完整性"卡片；Then 卡片显示"4/4 就绪"，可选文档（plan/verify_result/module_impact/MASTER/prototypes/references）
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-01
最近确认：98d3e56dd

## FR-lib-changes-002 必需与可选文档分区展示
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录四件套齐全、缺少 plan.md 与 verify-result.md；When 用户查看完整度卡片；Then 必需组四项全部显示为就绪（绿色✓），可选组中 plan/verify_result 显示为缺失（灰显），且不拉低"4/4"计数
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-02
最近确认：98d3e56dd

## FR-lib-changes-003 归档门禁 documents_complete 判四件套齐全
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更处于 accepted 阶段且四件套全部 exists；When 系统执行归档门禁检查；Then documents_complete 检查项 passed=true
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-03
最近确认：98d3e56dd

## FR-lib-changes-004 缺必需文档时门禁失败并说明
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更处于 accepted 阶段但缺少 design.md；When 系统执行归档门禁检查；Then documents_complete 检查项 passed=false，detail 指明"缺少必需文档: design"
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-04
最近确认：98d3e56dd

## FR-lib-changes-005 归档门禁 UI 正确渲染后端返回
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 后端返回 {can_archive, checks:[{name,passed,detail}×6]}；When 用户在 accepted 阶段查看归档门禁面板；Then 6 项检查逐项正确显示通过/未通过状态与说明，未通过项 badge 计数等于 checks 中 passed=false 的数量
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-05
最近确认：98d3e56dd

## FR-lib-changes-006 status 字段不再影响门禁
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given ChangeDocument.status 恒为 None（解析器不写入）；When 系统执行 documents_complete 检查；Then 检查结果只取决于四件套 exists，与 status 取值无关
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-06
最近确认：98d3e56dd

## FR-lib-changes-007 schema faithful/超集类型迁 alias
变更：2026-08-09-changes-ts-apitypes-migrate
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-004@v2
场景正文：
- 场景：默认场景 — Given `changes.ts` 中 11 个 schema faithful/超集类型（ChangeSummary / ChangeRead / ChangeList；When 改为 `components["schemas"]["X"]` alias（CreateChangeResponse 名映射 ChangeCreateRespo；Then grep `changes.ts` 无对应手写结构体定义残留；类型与后端 schema 一致。
全文：.sillyspec/changes/archive/2026-08-09-changes-ts-apitypes-migrate/requirements.md#FR-01
最近确认：b131cb292

## FR-lib-changes-008 schema lossy 类型保留手写 + shadow 注释
变更：2026-08-09-changes-ts-apitypes-migrate
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given 9 个 schema lossy/loose 或无 schema 类型（DispatchResponse / TransitionRequest / Trans；When 保留手写；Then 有 shadow schema 的 3 个（TransitionRequest/TransitionResponse/VerifyGateResponse）注释
全文：.sillyspec/changes/archive/2026-08-09-changes-ts-apitypes-migrate/requirements.md#FR-02
最近确认：b131cb292

## FR-lib-changes-009 调用方 drift guard 修复
变更：2026-08-09-changes-ts-apitypes-migrate
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 迁移后部分字段变 optional（reparseResult.warnings / current_stage / TransitionDispatchRes；When 调用方访问这些字段；Then 按 typecheck 暴露点补 `?.` / `??` guard；`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/page.tsx:165` warnings.length 补 `?.`。
全文：.sillyspec/changes/archive/2026-08-09-changes-ts-apitypes-migrate/requirements.md#FR-03
最近确认：b131cb292

## FR-lib-changes-010 移除 phantom + 补回 drift 能力
变更：2026-08-09-changes-ts-apitypes-migrate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 手写 ChangeSummary.created_at 是 phantom（0 调用方）；手写 FeedbackRequest 漏 target_stage；When ChangeSummary 迁 schema alias；FeedbackRequest 迁 schema alias；Then created_at 消失（0 调用方无影响）；submitFeedback 入参可选增 targetStage，body 可选带 target_stage（后
全文：.sillyspec/changes/archive/2026-08-09-changes-ts-apitypes-migrate/requirements.md#FR-04
最近确认：b131cb292

## FR-lib-changes-011 变更/快速修复的时间三元组展示
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 一个变更（或快速修复）存在关联执行记录（执行集合非空） 变更/快速修复无任何关联执行记录 集合中存在已开始未结束的执行（started_at 有值、finish；When 用户查看其列表「执行」列或详情用量卡 用户查看列表或详情 用户查看列表「执行」列；Then 开始时间 = 集合 `MIN(started_at)`、结束时间 = 集合 `MAX(finished_at)`、耗时 = 集合 `SUM(duration_m
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-01
最近确认：ecdae9ba6

## FR-lib-changes-012 变更/快速修复的 token 用量聚合
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 变更侧存在两类执行：挂 `change_id` 的派发执行、关联会话（`change_session_links`）内的执行 一个会话同时绑定两个变更 快速修复；When 聚合该变更用量 分别查看两个变更的用量 聚合该快速修复用量 聚合用量 聚合用量 聚合用量；Then 两类执行按 run id 去重合并（并集），token 四维（输入/输出/缓存读/缓存写）+ 调用次数 + 轮次（`SUM(num_turns)`）在去重集合上
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-02
最近确认：ecdae9ba6

## FR-lib-changes-013 独立用量端点
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户有 CHANGE_READ 权限 变更/快速修复不存在、不属于该工作区；When `GET /api/workspaces/{wid}/changes/{cid}/usage` 或 `GET /api/workspaces/{wid}/qui；Then 返回 `ChangeUsageRead`（时间三元组 + totals 六指标 + by_model 分模型明细，input+output 降序、「未记录」恒末
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-03
最近确认：ecdae9ba6

## FR-lib-changes-014 列表内嵌用量摘要（零 N+1）
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 用户请求变更列表（或快速修复列表） 变更行 location=deleted；When 响应组装 列表组装；Then 每项内嵌 `usage: UsageSummaryRead | None`（时间三元组 + totals），由批量聚合单查询填充（变更侧 `(change_id
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-04
最近确认：ecdae9ba6

## FR-lib-changes-015 前端展示
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1
场景正文：
- 场景：默认场景 — When 每行渲染 每行渲染 页面渲染 用量卡渲染；Then 「执行」列紧凑两行：耗时（+进行中标记）+ `N tok · N 次`，悬浮提示显示起止时间；usage None 显示「—」 同款「执行」列（含轮次摘要 `N
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-05
最近确认：ecdae9ba6
