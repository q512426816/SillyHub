---
author: qinyi
created_at: 2026-08-09 08:28:57
---
# 决策记录（Decisions）

## D-001@v1: scale=large 走完整四件套流程
- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 手写类型迁移是 quick 修还是正式 change？
- answer: 用户选正式 change（多文件 + 类型契约变更 + drift 修复，scale=large）。
- normalized_requirement: 走 brainstorm→plan→execute→verify→archive 完整流程，四件套齐 + 独立 Design Grill。
- impacts: [全流程]
- evidence: 用户「开正式 change」确认。

## D-002@v1: 方案 A 全量迁 + 保留 JSDoc
- type: architecture
- priority: P1
- status: accepted
- supersedes:
- source: user
- question: 迁移粒度与 JSDoc 处理？
- answer: 方案 A（schema faithful/超集全迁 + JSDoc 挂 alias 上方），非 B（裸 alias 丢 JSDoc）非 C（仅叶子）。
- normalized_requirement: 11 faithful/超集类型迁 alias，每个 alias 上 ≥1 行业务语义 JSDoc（取值枚举/检查项名等）。
- impacts: [FR-01, NFR-01]
- evidence: 用户「A 全量迁+保留JSDoc」确认。

## D-003@v1: CreateChangeResponse 名映射
- type: compatibility
- priority: P2
- status: accepted
- supersedes:
- source: code
- question: 手写 CreateChangeResponse 与 schema ChangeCreateResponse 名不同？
- answer: alias 桥接 `export type CreateChangeResponse = components["schemas"]["ChangeCreateResponse"]`，调用方用名不变。
- normalized_requirement: 调用方零改动（仍用 CreateChangeResponse 名）。
- impacts: [FR-01]
- evidence: api-types.ts grep（schema 名 ChangeCreateResponse）+ changes.ts grep（手写名 CreateChangeResponse）。

## D-004@v2: FR-02 例外判据（round-2 修订，supersede D-004@v1）
- type: boundary
- priority: P1
- status: accepted
- supersedes: D-004@v1（误判 5 类型无 schema）
- source: code
- question: schema 已定义但 lossy/loose 的类型迁不迁？
- answer: 仅当 schema 是 loose dict/union 降级精确类型 且 手写精确类型有 ≥1 处调用方依赖时，允许保留手写并注释标 shadow schema（规则 20 有据例外）。TransitionRequest（worker_preset/main_agent_config loose dict）/ TransitionResponse（change loose dict）/ VerifyGateResponse（source loose string vs 精确 union）符合；FeedbackRequest/TransitionDispatchResponse 不符合（faithful/超集）故迁。
- normalized_requirement: 9 类型保留手写（注释标 shadow schema + 保留理由），11 类型迁。
- impacts: [FR-01, FR-02]
- evidence: round-1 独立 Grill 证伪 round-0 误判 + round-2 独立 Grill 确认 lossy 断言真实；schema.py:202/234/280/315/331 + api-types.ts@15669-15991 逐字段比对。

## 剩余风险
- 无未覆盖决策（D-001~004 全被 FR-01/FR-02/NFR-01 覆盖）。
- D-004@v1 已 supersede，不再生效。
