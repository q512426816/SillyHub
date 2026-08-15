---
author: qinyi
created_at: 2026-08-16 00:02:00
---

# 决策台账 — 2026-08-15-change-step-visibility

## D-001@v1: 实时刷新机制=智能轮询+稳定渲染
- type: architecture
- status: accepted
- source: user
- question: step 级进度用哪种实时刷新机制（轮询 / SSE 推送 / 手动）？
- answer: 用户选 A 智能轮询，附加硬约束"刷新后页面不乱跳（滚动位置/选中态/展开态不能丢失）"。
- normalized_requirement: 列表 30s / 详情 10s refetchInterval；响应内容 hash 比对相同则跳过 setState；终态停轮；页面不可见暂停；列表 rowKey 稳定不重排。
- impacts: [design §5 Phase 2, R-04, use-smart-poll.ts]
- evidence: 用户对话回答（2026-08-15 brainstorm step 3 wait 轮次 1）
- priority: P0

## D-002@v1: 数据源=现有六表 steps[]，零上报改动
- type: premise
- status: accepted
- source: code
- question: step 级数据从哪来？是否要改 CLI/daemon 上报链路？
- answer: 代码实证 CLI serializeForSync 六表 JSON 已含 steps[]（name/status/output/completed_at/ordering/wait_*），platform_change_progress.latest_progress 已落库；读侧仅投影 current_stage。纯展示层缺口。
- normalized_requirement: 不改 sillyspec CLI / daemon / platform_sync 写入侧；仅 backend 读侧提取 + 前端展示。
- impacts: [design §1, §5 Phase 1, §8, 文件清单不含 CLI/daemon 文件]
- evidence: sillyspec/src/progress.js:299-362,468-526；platform_change_progress DB 实查（steps 8 条含 status/output/completed_at）；backend/app/modules/change/service.py:1554-1597（现有提取器仅 current_stage+completed_stages）
- priority: P0

## D-003@v1: steps 缺失优雅降级
- type: compatibility
- status: accepted
- source: code
- question: 旧变更 / 平台占位行无 steps 数据时如何表现？
- answer: 提取器返回 None → API 字段不赋值（保持 optional None）→ 前端降级为现有 current_stage 展示，视觉与现状一致。
- normalized_requirement: _extract_step_progress 对 steps 缺失/空/结构异常返回 (None, None) 不抛；前端组件 None 时不渲染 step 区块。
- impacts: [design §9, R-01, schema optional 字段]
- evidence: platform_change_progress 现存 29 行中部分旧变更（如 probe-r06/platform-takeover-declaration）steps 为空数组
- priority: P1

## D-004@v1: 轮询实现=react-query useQuery+refetchInterval
- type: architecture
- status: accepted
- source: design-grill
- question: 轮询承载用自研 useSmartPoll hook 还是 react-query？（Grill P0-2）
- answer: react-query（仓库已装 5.51 + 全局 Provider + useQuery 范式）；structuralSharing 默认开启=内容不变跳过 re-render；refetchIntervalInBackground 默认 false=后台暂停；refetchInterval 函数式返回 false=终态停轮。不自研 hook（YAGNI）。
- normalized_requirement: 列表/详情数据获取统一 useQuery；列表 refetchInterval 30000（存在非终态变更）详情 10000（非终态）；停轮条件 status=="archived"||location=="archive"；不引入自算 contentHash。
- impacts: [design §5 Phase 2, §7, R-03, R-04, R-07]
- evidence: frontend/package.json react-query 依赖；frontend/src/app/providers.tsx Provider；审查子代理实读 page.tsx:154-156（现状裸 useEffect 无轮询基建）
- priority: P0
- supersedes: 无（细化 D-001@v1 的实现层）

## D-005@v1: 详情页 ChangeStepTimeline 替换 SillySpecStepProgress
- type: consistency
- status: accepted
- source: design-grill
- question: 详情页已有步骤组件（数据源 change.stages dispatch 快照），新 timeline（数据源 latest_progress）替换还是共存？（Grill #17）
- answer: 替换。双组件双数据源同屏会数值不一致；新组件数据更全（output/wait/stage 分组）；旧组件引用点清理 + 既有测试适配。
- normalized_requirement: [cid]/page.tsx 删除 SillySpecStepProgress 引用挂 ChangeStepTimeline；sillyspec-step-progress.tsx 删除（execute 内 git rm 落地，quick 审计拦删除的规则不适用 execute）；page-team-toggle.test.tsx 适配。
- impacts: [design §5 Phase 2, 文件清单, R-08]
- evidence: [cid]/page.tsx:180-206 SillySpecStepProgress 派生渲染（审查子代理实读）
- priority: P1
