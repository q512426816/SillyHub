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

## FR-docs-007 daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-01
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/interactive/session-store-persistence.test.ts「单源守护：INTERACTIVE_PROVIDERS 全部键的记录载入保留（2026-10-17-audit-risk-followup——手写白名单漏 dsh/zcode 曾致重启静默丢记录，pi/cursor 同坑各一次）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-008 run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-02
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-02
  tests: test/frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 跨刷新仍活跃（running→running，列表数据有变化）→ 不误标完成角标（活跃期误报回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-009 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-03
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-03
  tests: test/frontend/src/lib/__tests__/logout-storage.test.ts「7 类用户域前缀全清、设备级键保留、前缀精确匹配」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-010 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-04
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-04
  tests: test/sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例5（窗口内重建保护）：下载窗口内重建的同名文件不进抑制面——不删本地、不并回陈旧条目（2026-10-17-audit-risk-followup）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-011 zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-05
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-05
  tests: test/sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「consume 自然退出（iq.close）→ finally 对齐 codex：清 _finishTurnOnClose 槽位 + 兜底 close（幂等单次）（2026-10-17-audit-risk-followup）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active

## FR-docs-012 applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'
变更：2026-10-17-audit-risk-followup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-17-audit-risk-followup/requirements.md#FR-06
最近确认：7faec5bfa12ed2e7159077f469589243fb36ee5b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-17-audit-risk-followup:flow:测试绑定FR-06
  tests: test/sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例6（越界键防线）：applyResurrectSuppress 对越界键（../）跳过 rm 并告警——dir 外文件幸存」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-17-audit-risk-followup
  status: active
