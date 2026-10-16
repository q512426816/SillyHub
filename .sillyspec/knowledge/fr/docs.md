---
author: sillyspec-fr-index
created_at: 2026-10-15T16:16:15.707Z
---

# FR 索引 — docs

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/docs.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-docs-001 CONVENTIONS.md 原型管线指针节（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径——agent 查本图 scan
场景正文：
- 场景：主路径——agent 查本图 scan — Given agent 在 multi-agent-platform 项目图下做 UI 变更，按规则读本图 scan CONVENTIONS.md；When 读到「前端原型管线」节；Then 拿到管线入口与规约指针，不再误判「项目无 React 原型管线」。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-01
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-002 local.yaml ui_prototype 登记（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径——跨仓联动
场景正文：
- 场景：主路径——跨仓联动 — Given 本登记落盘且 sillyspec 新契约在位；When buildUiGuidanceLines(specBase) 渲染；Then 注入「🔒 真码契约（real-code）」行（readUiPrototypeForm 实测 registered real-code）。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-02
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-003 验证与零回归（必须）
变更：2026-10-16-proto-pipeline-discoverability
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落盘；When readUiPrototypeForm 实测 + 平台仓门；Then registered=true、form=real-code；零代码 diff。
全文：.sillyspec/changes/archive/2026-10-16-proto-pipeline-discoverability/requirements.md#FR-03
最近确认：0e5d3f3b0b49be367746945232dc5ac7a0cb70c3

## FR-docs-004 session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话 445e12d9（workspace_id 为空，存在 2 条已答 AskUser 提问）；When 用户打开 /sessions?session=445e12d9；Then 待决策 pill 渲染，展开已答历史列出 2 条（浏览器实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-01
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

## FR-docs-005 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 同 FR-01 会话；When 页面渲染完成；Then data-testid=session-change-files-hover 不在 DOM（浏览器实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-02
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

## FR-docs-006 既有回归测试全绿
变更：2026-10-16-decision-pill-no-workspace
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复提交 9b5485fb0；When 跑相关 vitest 与 tsc --noEmit；Then 12/12 + 26/26 + 38 合并用例全绿、tsc 零错（实测通过）
全文：.sillyspec/changes/archive/2026-10-16-decision-pill-no-workspace/requirements.md#FR-03
最近确认：256aa6feb2c4349f3d4a1b513e94fb9fa5fddd0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-decision-pill-no-workspace:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx | frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-decision-pill-no-workspace
  status: active
