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

## FR-docs-007 待决策 pill 与变更文件 pill 渲染在同一悬浮组内竖向排列，各自空数据不渲染的显隐契约不变
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-01
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「无关联变更（data 空数组/未就绪）不渲染入口」 | test/frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「三类全空（pending 空 + 历史空/未加载）不渲染入口（FR-01）」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「竖排停靠组：children 渲染成组（flex-col 右对齐），portal 挂 body」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-008 两 pill 的下拉均为点击展开（hover 不触发）、再点或点外部收起
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-02
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「点击弹下拉（hover 不再触发）：进行中置顶（轻量徽标+阶段），已归档默认折叠」 | test/frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx「点击弹下拉（hover 不再触发）：待决策置顶（提问/Plan 徽标），已答历史默认折叠（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-009 悬浮组按住可在 viewport 范围内拖动，松手自动吸附较近的左右边界，纵向钳制在窗口内，位置 localStorage 持久化
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-03
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖到右半屏松手吸附右缘」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖拽越界钳回窗内：y 不出上下边」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「持久化位置恢复；损坏存档静默回落默认右下」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「视口缩放：钳回窗内并保持吸附侧」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-010 位移小于阈值视为点击不触发拖拽，拖拽结束后的残余 click 被吞掉，pill 按钮点击行为不受影响
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-04
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-04
  tests: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「位移小于阈值不算拖拽：click 放行给 pill 按钮」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖拽结束后的残余 click 被吞；时间窗外恢复点击」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active

## FR-docs-011 相关组件测试与 tsc 通过
变更：2026-10-16-session-pill-dock-drag
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-session-pill-dock-drag/requirements.md#FR-05
最近确认：f0ba3f3fb30b7b0743ad3265a86578205a46ed43

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-session-pill-dock-drag:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | frontend/src/components/daemon/__tests__/session-decisions-hover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-session-pill-dock-drag
  status: active
