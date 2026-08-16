---
author: qinyi
created_at: 2026-08-16 07:22:00
---

# 决策台账 — 2026-08-16-change-owner-from-token

## D-001@v1: owner 来源=进度上行 token 身份，最新为准
- type: architecture
- status: accepted
- source: user + code
- question: 变更责任人从哪里取、何时更新？
- answer: 用户提出"通过 token 信息得到，每次同步后以最新为准"；代码实证 require_platform_sync_write 已派生 token 签发人真实 User（auth.py:129），router 现丢弃 _user（router.py:95）。
- normalized_requirement: push_progress 接受分支同事务 diff 更新 ux_changes.owner_id（None→首填不记事件；不同→更新+记事件；相同→幂等跳过）；失败 best-effort 不阻断上行。
- impacts: [design §5 Phase 1, R-01, R-04]
- evidence: 用户原始需求（2026-08-16 对话）；backend/app/modules/platform_sync/auth.py:113-129；router.py:95
- priority: P0

## D-002@v1: 独立通用事件表（扩展性要求）
- type: architecture
- status: accepted
- source: user
- question: 责任人变化历史存哪里？
- answer: 用户明确选择独立建表，并给出关键扩展性要求："后续我还有很多想拓展的事件要记录到履历中"——表必须通用化设计。
- normalized_requirement: change_events 表含 event_type varchar + detail JSONB 通用字段；owner_change 是首类事件；后续事件类型零 schema 变更接入（仅加 event_type 值与前端样式映射）。
- impacts: [design §5 Phase 1.1, §2.5]
- evidence: 用户 AskUserQuestion 回答（2026-08-16，选 B 且附扩展性说明）
- priority: P0

## D-003@v1: 履历=步骤时间线合成事件条目
- type: architecture
- status: accepted
- source: user
- question: 责任人变化在履历中如何呈现？
- answer: 用户说"在履历进度中提名责任人变化信息"——事件按时间序插入现有步骤时间线，专属样式（👤 紫色）区分；方案 A 经用户确认。
- normalized_requirement: StepTimelineEntry 加 kind("step"|"event")+event_type optional；事件条目 name=责任人变更 output=A → B；前端 kind=event 专属样式；纯 steps 数据零变化。
- impacts: [design §5 Phase 2.2, Phase 3, R-02]
- evidence: 用户原始需求 + 方案 A 选择（2026-08-16）
- priority: P0

## D-004@v1: 履历明细不截断（修订 step-visibility R-02）
- type: boundary
- status: accepted
- source: user
- question: 履历（时间线明细）内容过长是否截断？
- answer: 用户追加要求「内容太长不要截断，有什么展示什么」。明细 output 全量透传+前端自然换行；列表摘要 current_step_desc 截断保留（~200B/行列表性能契约）。修订 2026-08-15-change-step-visibility 的 R-02（其截断决策仅保留在列表摘要层）。
- normalized_requirement: StepTimelineEntry.output 不截断；前端无 line-clamp；current_step_desc 截断 ~200 字保留。
- impacts: [design §5 Phase 2.4, R-07, task-04, task-05]
- evidence: 用户对话追加（2026-08-16）；Grill P1-3 归属裁决
- priority: P1
