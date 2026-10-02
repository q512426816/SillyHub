## FR-lib-changes-001 完整度计数只以四件套为分母
变更：2026-06-03-change-doc-completeness-gate
状态：superseded
退役理由：前端「变更文档完整性」卡片已随详情页重构移除（前端 grep 无 4/4/可选文档渲染，ChangeDocMatrix 无组件消费），仅后端 documents 端点存留（2026-09-28 复核）
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个变更目录下存在 proposal/design/requirements/tasks 四件套且无可选文档；When 用户打开变更详情页查看"变更文档完整性"卡片；Then 卡片显示"4/4 就绪"，可选文档（plan/verify_result/module_impact/MASTER/prototypes/references）
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-01
最近确认：98d3e56dd

## FR-lib-changes-002 必需与可选文档分区展示
变更：2026-06-03-change-doc-completeness-gate
状态：superseded
退役理由：必需/可选分区展示随「变更文档完整性」卡片一并移除，前端无消费方（2026-09-28 复核）
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

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb23x:backend/tests/modules/change/test_archive_gate.py
  tests: backend/tests/modules/change/test_archive_gate.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-06-03-change-doc-completeness-gate
  status: active

## FR-lib-changes-004 缺必需文档时门禁失败并说明
变更：2026-06-03-change-doc-completeness-gate
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更处于 accepted 阶段但缺少 design.md；When 系统执行归档门禁检查；Then documents_complete 检查项 passed=false，detail 指明"缺少必需文档: design"
全文：.sillyspec/changes/archive/2026-06-03-change-doc-completeness-gate/requirements.md#FR-04
最近确认：98d3e56dd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb2js:backend/tests/modules/change/test_archive_gate.py
  tests: backend/tests/modules/change/test_archive_gate.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-06-03-change-doc-completeness-gate
  status: active

## FR-lib-changes-005 归档门禁 UI 正确渲染后端返回
变更：2026-06-03-change-doc-completeness-gate
状态：superseded
退役理由：前端归档门禁面板已移除（checkArchiveGate 于 frontend/src/lib/changes.ts 定义但全前端 0 调用方）；后端 archive-gate 端点与测试仍在（FR-lib-changes-003/004/006）（2026-09-28 复核）
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

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb2yc:backend/tests/modules/change/test_archive_gate.py
  tests: backend/tests/modules/change/test_archive_gate.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-06-03-change-doc-completeness-gate
  status: active

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
- 场景：默认场景 — Given 迁移后部分字段变 optional（reparseResult.warnings / current_stage / TransitionDispatchRes；When 调用方访问这些字段；Then 按 typecheck 暴露点补 `?.` / `??` guard（tasks/page.tsx 该调用点后随 schema 演进改用 TaskReparseResponse，warnings 已 required，无需 `?.`——2026-09-28 复核修正）。
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

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb904:backend/app/modules/change/tests/test_usage_stats.py
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-08-30-change-center-usage-stats
  status: active

## FR-lib-changes-012 变更/快速修复的 token 用量聚合
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-002@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 变更侧存在两类执行：挂 `change_id` 的派发执行、关联会话（`change_session_links`）内的执行 一个会话同时绑定两个变更 快速修复；When 聚合该变更用量 分别查看两个变更的用量 聚合该快速修复用量 聚合用量 聚合用量 聚合用量；Then 两类执行按 run id 去重合并（并集），token 四维（输入/输出/缓存读/缓存写）+ 调用次数 + 轮次（`SUM(num_turns)`）在去重集合上
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-02
最近确认：ecdae9ba6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb9ao:backend/app/modules/change/tests/test_usage_stats.py
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-08-30-change-center-usage-stats
  status: active

## FR-lib-changes-013 独立用量端点
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 用户有 CHANGE_READ 权限 变更/快速修复不存在、不属于该工作区；When `GET /api/workspaces/{wid}/changes/{cid}/usage` 或 `GET /api/workspaces/{wid}/qui；Then 返回 `ChangeUsageRead`（时间三元组 + totals 六指标 + by_model 分模型明细，input+output 降序、「未记录」恒末
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-03
最近确认：ecdae9ba6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcb9m4:backend/app/modules/change/tests/test_usage_stats.py
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-08-30-change-center-usage-stats
  status: active

## FR-lib-changes-014 列表内嵌用量摘要（零 N+1）
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 用户请求变更列表（或快速修复列表） 变更行 location=deleted；When 响应组装 列表组装；Then 每项内嵌 `usage: UsageSummaryRead | None`（时间三元组 + totals），由批量聚合单查询填充（变更侧 `(change_id
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-04
最近确认：ecdae9ba6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcba0r:backend/app/modules/change/tests/test_usage_stats.py
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-08-30-change-center-usage-stats
  status: active

## FR-lib-changes-015 前端展示
变更：2026-08-30-change-center-usage-stats
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1
场景正文：
- 场景：默认场景 — When 每行渲染 每行渲染 页面渲染 用量卡渲染；Then 「执行」列紧凑两行：耗时（+进行中标记）+ `N tok · N 次`，悬浮提示显示起止时间；usage None 显示「—」 同款「执行」列（含轮次摘要 `N
全文：.sillyspec/changes/archive/2026-08-30-change-center-usage-stats/requirements.md#FR-05
最近确认：ecdae9ba6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcbad4:frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-08-30-change-center-usage-stats
  status: active

## FR-lib-changes-016 批量接收事件
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given watcher 持有效 shpsync_ token；When POST `/api/changes/{name}/events` body `{events: [...]}`（每条 kind/ts 必填，ts 为 epoc；Then 逐条落库 `platform_change_events`（provisional 恒存 True，workspace 由 token 派生），响应 200 `
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-01
最近确认：5a62ff39f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcblh5:backend/app/modules/platform_sync/tests/test_change_events.py
  tests: backend/app/modules/platform_sync/tests/test_change_events.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-23-change-events-channel
  status: active

## FR-lib-changes-017 幂等去重
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 同一 (workspace, change_name) 已存事件；When 重复推送同 dedup_key 事件（带 id 用 id；否则 ts|kind|stage 拼键）；Then 跳过不重复落库，计入 deduplicated 响应字段；重放推送响应幂等
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-02
最近确认：5a62ff39f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcblqo:backend/app/modules/platform_sync/tests/test_change_events.py
  tests: backend/app/modules/platform_sync/tests/test_change_events.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-23-change-events-channel
  status: active

## FR-lib-changes-018 上限保护
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 单变更事件数超过 5000；When 新事件插入；Then 同事务按 (ts, created_at) 删最旧修剪回 5000 条（截断而非拒绝），新事件不丢
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-03
最近确认：5a62ff39f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcbm0l:backend/app/modules/platform_sync/tests/test_change_events.py
  tests: backend/app/modules/platform_sync/tests/test_change_events.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-23-change-events-channel
  status: active

## FR-lib-changes-019 增量拉取
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 面板查看者具备读权限（CHANGE_READ scope）；When GET `/api/changes/{name}/events?since=<iso8601>&limit=<int>`；Then 返回 `{items, total}` 按 ts 正序（ts ASC, id ASC 稳定排序），仅含 ts > since 的行；无事件 200 空列表；si
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-04
最近确认：5a62ff39f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcbmau:backend/app/modules/platform_sync/tests/test_change_events.py
  tests: backend/app/modules/platform_sync/tests/test_change_events.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-23-change-events-channel
  status: active

## FR-lib-changes-020 面板观测事件折叠区
变更：2026-09-23-change-events-channel
状态：superseded
退役理由：折叠区交互（缺省收起/warning 默认展开+角标计数）已被 2026-09-26-change-real-timeline 三段式 ChangeTimelineCard 取代（FR-lib-changes-033/034），30s 轮询与失败静默隐藏由新卡继承（2026-09-28 复核）
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 变更详情页打开；When 事件区挂载；Then 组件 GET 一次 + 30s 轮询刷新；缺省收起；有 severity=warning 事件时默认展开且标题角标显示 warning 计数；拉取失败静默隐藏不
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-05
最近确认：5a62ff39f

## FR-lib-changes-021 时间线展示
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 事件列表非空；When 渲染；Then 时间线行展示时间/事件类型/规则/详情；severity=warning 行琥珀高亮；全部行带 provisional 徽标（悬停说明"旁路观测信号，非流程真相
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-06
最近确认：5a62ff39f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcbmlf:frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-23-change-events-channel
  status: active

## FR-lib-changes-022 零业务消费（红线）
变更：2026-09-23-change-events-channel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台侧收到任意 provisional 事件；When 全链路处理（存储/读取/展示）；Then 不触发通知、不写 progress、不影响审批门控、不做任何流程状态判定
全文：.sillyspec/changes/archive/2026-09-23-change-events-channel/requirements.md#FR-07
最近确认：5a62ff39f

## FR-lib-changes-023 沉淀资产聚合端点
变更：2026-09-25-change-precipitated-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更已归档且 spec 树镜像含其沉淀产物；When 调用 GET /workspaces/{ws}/changes/{cid}/assets；Then 返回 FR 索引/决策蒸馏归属条目（「变更：」行过滤）+ 测试绑定行 + patch 统计 + delta 摘要；逐项 fail-open，在途变更跳过目录件
全文：.sillyspec/changes/archive/2026-09-25-change-precipitated-assets/requirements.md#FR-01
最近确认：a7eca07270b25dbe374717aaf8379f57254fe3df

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-precipitated-assets:flow:FR-01
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-precipitated-assets
  status: active

## FR-lib-changes-024 变更详情沉淀资产卡
变更：2026-09-25-change-precipitated-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在变更详情页 aside；When 渲染「沉淀资产」折叠卡；Then 四组逐组有数据才渲染（FR/决策行可跳知识库页）、失败静默隐藏、在途变更显示引导空态
全文：.sillyspec/changes/archive/2026-09-25-change-precipitated-assets/requirements.md#FR-02
最近确认：a7eca07270b25dbe374717aaf8379f57254fe3df

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-precipitated-assets:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-precipitated-assets
  status: active

## FR-lib-changes-025 聚焦验证全绿
变更：2026-09-25-change-precipitated-assets
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更交付；When 跑聚焦测试与静态检查；Then 后端 test_assets.py 5 用例 + 前端 change-assets-card 5 用例 + tsc + ruff 全绿
全文：.sillyspec/changes/archive/2026-09-25-change-precipitated-assets/requirements.md#FR-03
最近确认：a7eca07270b25dbe374717aaf8379f57254fe3df

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-precipitated-assets:flow:FR-03
  tests: backend/app/modules/change/tests/test_assets.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-precipitated-assets
  status: active

## FR-lib-changes-026 FR 索引行点击落到知识库的具体条目
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情「沉淀资产」卡列出若干 FR 索引条目（来源 knowledge/fr/<域>.md，条目 id 形如 FR-<域>-NNN）；；When 用户点击某一行；；Then 知识库页打开该 FR 所属文件，并滚动定位到这一条 FR 的条目卡（DOM 落点 data-entry-anchor=<知识库相对文件名>#<FR id>）；
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-01
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-detail-assets-usability:flow:FR-01
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2f29e2693a12839bf3f71fb8684b5db57fc628b3
  source_change: 2026-09-25-change-detail-assets-usability
  status: active

## FR-lib-changes-027 决策索引行点击落到知识库的具体条目
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 「沉淀资产」卡列出若干决策蒸馏条目（来源 knowledge/decisions/*.md，条目 id 形如 D-NNN@vN）；；When 用户点击某一行；；Then 与 FR-01 同款落位语义：选中该决策文件并滚动到该条目卡（data-entry-anchor=<文件名>#<D id>）。
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-02
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcbmue:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-25-change-detail-assets-usability
  status: active

## FR-lib-changes-028 测试绑定行可查看仓库内测试文件内容
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 「沉淀资产」卡「测试绑定」组列出 test-trace 行（锚点 / 测试文件路径 / 状态）；；When 用户点击该行给出的测试文件路径；；Then 弹出只读预览弹窗，展示仓库内该文件内容（走 explorer 取数，不依赖 spec 镜像），失败时弹窗内给出可读错误提示；
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-03
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-detail-assets-usability:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/explorer/__tests__/file-preview.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-25-change-detail-assets-usability
  status: active

## FR-lib-changes-029 归档留档可看到具体改动
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已归档变更的归档目录存在 change-patch.json（含 files 清单）与 change.patch（冻结全量 diff）；；When 用户展开「沉淀资产」卡的「归档留档」组； 用户点击清单中某个文件；；Then 除既有 files/additions/deletions 统计外，列出 change-patch.json 的文件清单（超上限时显式标注截断）； 弹出该文件在
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-04
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-detail-assets-usability:flow:FR-04
  tests: backend/app/modules/change/tests/test_assets.py | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-25-change-detail-assets-usability
  status: active

## FR-lib-changes-030 范围对账降级态显式展示、不再误显三态
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given scope-audit 返回 ok=true 且 degraded_reason 非空（计划侧不可用，降级为「实际侧 only 视图」，行内无三态字段）；；When 变更详情页渲染范围对账卡；；Then 不再渲染三态 chip 的 0/0/0，改为显式展示降级原因 + 口径说明（该视图无三态列、文件面为实时窗口），明细弹窗同样带降级横幅；
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-05
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-change-detail-assets-usability:flow:FR-05
  tests: frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 06925e312424f70d94189f93fb6b76db59a2e95e
  source_change: 2026-09-25-change-detail-assets-usability
  status: active

## FR-lib-changes-031 相关测试与静态检查全绿
变更：2026-09-25-change-detail-assets-usability
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更改动了后端 assets/scope-audit 展示链路与前端两张卡、知识库页；；Then 后端 test_assets.py、前端 change-assets-card / scope-audit-command-card / knowledge-p
全文：.sillyspec/changes/archive/2026-09-25-change-detail-assets-usability/requirements.md#FR-06
最近确认：39f2eb4fe0cd00568c6bb63bc7248c2430b11182

## FR-lib-changes-032 合成时间线聚合端点
变更：2026-09-26-change-real-timeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given thin 轻量变更进度不落库、steps 恒空、CLI 已有 watcher timeline 正式命令且事件流已推平台表，；When 客户端请求 GET /workspaces/{ws}/changes/{cid}/timeline，；Then 返回三段式合成数据——事件轴（platform_change_events 按 change_key 正序 + requirements 工件 created_
全文：.sillyspec/changes/archive/2026-09-26-change-real-timeline/requirements.md#FR-01
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-real-timeline:flow:FR-01
  tests: backend/app/modules/change/tests/test_timeline.py::金样本聚合（诞生锚+事件轴+任务面+脚注）
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-real-timeline
  status: active

## FR-lib-changes-033 事件 kind 渲染对齐 CLI 语义
变更：2026-09-26-change-real-timeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given watcher 事件 kind 为英文机器值（file-update/task-done/warning/commit/archived），；When 前端渲染事件轴，；Then 每条事件显示时刻 + 图标 + 中文标签（内容变更/勾选变化/告警/提交/归档/诞生，语义对齐 CLI watcher timeline 输出），warning
全文：.sillyspec/changes/archive/2026-09-26-change-real-timeline/requirements.md#FR-02
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-real-timeline:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-real-timeline
  status: active

## FR-lib-changes-034 详情页空窗填补
变更：2026-09-26-change-real-timeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更 steps 为空（thin 恒空、quick 存量同空），；When 详情页主线渲染， 原步骤时间线位置挂载 ChangeTimelineCard（自取数轮询、失败静默隐藏），三段式展示事件轴 + 任务面 + 脚注；steps 有
全文：.sillyspec/changes/archive/2026-09-26-change-real-timeline/requirements.md#FR-03
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-real-timeline:flow:FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-real-timeline
  status: active

## FR-lib-changes-035 测试与类型门禁全绿
变更：2026-09-26-change-real-timeline
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 三处改动落盘，；When 运行后端聚焦测试（聚合金样本含诞生锚/任务行解析/提交标题匹配、空 events 容错、git 降级三面）与前端组件测试（三段渲染 + 空态 + steps 有；Then 全部通过、openapi.json 与 api-types.ts 随提交同步、0 类型错误。
全文：.sillyspec/changes/archive/2026-09-26-change-real-timeline/requirements.md#FR-04
最近确认：e120a799bafc77f4b5b9f35e7971baece30c33f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-change-real-timeline:flow:FR-04
  tests: backend/app/modules/change/tests/test_timeline.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-26-change-real-timeline
  status: active

## FR-lib-changes-036 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 默认 44px 窄轨：紧凑刻度+当前轮位置指示+顶部当前轮号，aria-label 保留（第N轮可达性）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-01
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-hover-flyout:flow:FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-turn-nav-hover-flyout
  status: active

## FR-lib-changes-037 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 悬停滑出完整行式列表浮层（覆盖聊天区不挤压布局，~260px），移开延迟收起；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-02
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

## FR-lib-changes-038 点击窄轨可 pin 锁定，点外部收起
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 点击窄轨可 pin 锁定，点外部收起；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-03
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

## FR-lib-changes-039 触屏 hover:none 时点按展开收起
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 触屏 hover:none 时点按展开收起；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-04
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-turn-nav-hover-flyout:flow:FR-04
  tests: sessions/__tests__/page.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-turn-nav-hover-flyout
  status: active

## FR-lib-changes-040 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 高亮 相关模块就绪；When 浮层内保留全部既有功能：轮号+大纲摘要+时间、当前轮高亮滚动联动、点击跳转（含未加载轮 run_id 直达）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-05
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

## FR-lib-changes-041 既有测试改断言不改意图全绿，tsc
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有测试改断言不改意图全绿，tsc；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-06
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f

## FR-lib-changes-042 eslint 零新增，主题 token 零硬编码
变更：2026-09-28-turn-nav-hover-flyout
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When eslint 零新增，主题 token 零硬编码；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-turn-nav-hover-flyout/requirements.md#FR-07
最近确认：37906d3396b9a0f21a7bed25d73ae609dd74ea2f
