---
author: sillyspec-fr-index
created_at: 2026-10-16T01:30:35.950Z
---

# FR 索引 — test-utils

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/test-utils.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-test-utils-001 活性由 working/blocked 转移到 idle 且当前不在该会话上 → 行首亮绿点+完成角标（aria-label 此会话已执行完成），点击进入后角标与绿点消失（空闲回归留白）
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-01
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「active + 活性 idle + 完成标记…→ 绿点 + 完成角标」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「点击进入…消失（空闲回归留白）」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「绿点+完成角标出现」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「working→idle：写轮次完成标记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-002 会话终态 ended 的完成通知（上一变更 FR-06）保留，与轮次完成共用同一落盘键与同一角标
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-02
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充：非终态→ended 且不在该会话上）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-003 原红色「有新的空闲状态未读」角标退役——working/blocked→idle 的提醒统一为绿色执行完成语义
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-03
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「active 空闲（无活性数据）→ 留白」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-004 完成时正选中该会话不标记（两个来源一致）；历史空闲（首见即 idle 无转移基线）不误报
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-04
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「完成时正选中该会话（用户就在其上）→ 不标记不亮角标」 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「首见不标」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「suppress 谓词命中」 | frontend/src/hooks/__tests__/use-session-liveness.test.ts「首见（无 prevState）→idle：不写完成标记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-005 相关测试更新全过（session-list-panel + use-session-liveness），lint 零告警
变更：2026-10-15-session-turn-completion-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-turn-completion-semantics/requirements.md#FR-05
最近确认：fcd4a40489512f45d8e646965833e5e7c13e400b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-turn-completion-semantics:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-turn-completion-semantics
  status: active

## FR-test-utils-006 预会话态(sessionId 为空)下,用户无自有机器且无「共享给我的」机器、且存在 runtime_online 的平台共享智能体时,预会话档案自动默认选中第一个在线共享智能体
变更：2026-10-19-shared-agent-onboarding-hint
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-shared-agent-onboarding-hint/requirements.md#FR-01
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-shared-agent-onboarding-hint:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「无自有/共享机器 + 在线共享智能体 → 默认选中并显示读写约束引导提示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-shared-agent-onboarding-hint
  status: active

## FR-test-utils-007 用户手动切换过档案(含选「不指定」)后,自动默认选中不再覆盖用户选择
变更：2026-10-19-shared-agent-onboarding-hint
状态：active
摘要：手动选回不指定
全文：.sillyspec/changes/archive/2026-10-19-shared-agent-onboarding-hint/requirements.md#FR-02
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-shared-agent-onboarding-hint:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「手动选『不指定』后自动选中让位，提示消失且不再被改回」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-shared-agent-onboarding-hint
  status: active

## FR-test-utils-008 满足默认选中条件时,预会话区显示引导提示,说明该共享智能体读平台源码不受限、写操作限制在共享输出目录,且可在智能体下拉切换
变更：2026-10-19-shared-agent-onboarding-hint
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-shared-agent-onboarding-hint/requirements.md#FR-03
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-shared-agent-onboarding-hint:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「无自有/共享机器 + 在线共享智能体 → 默认选中并显示读写约束引导提示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-shared-agent-onboarding-hint
  status: active

## FR-test-utils-009 有自有机器或有共享机器、共享智能体全部离线、机器数据加载中或请求失败时,均不自动选中也不显示提示(fail-open 不阻塞)
变更：2026-10-19-shared-agent-onboarding-hint
状态：active
摘要：机器请求失败
全文：.sillyspec/changes/archive/2026-10-19-shared-agent-onboarding-hint/requirements.md#FR-04
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-shared-agent-onboarding-hint:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「共享智能体全部离线 → 不自动选中、不显示提示」 | frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「共享智能体生效列表请求失败（降级 []）→ 门控不成立，不选中不提示」 | frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「有『共享给我的』机器 → 不自动选中、不显示提示」 | frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「有自有机器（total>0）→ 不自动选中、不显示提示」 | frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx「门控机器查询失败 → fail-open 不选中不提示，面板正常」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-shared-agent-onboarding-hint
  status: active

## FR-test-utils-010 聚焦测试覆盖上述分支,tsc 0 错误
变更：2026-10-19-shared-agent-onboarding-hint
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-shared-agent-onboarding-hint/requirements.md#FR-05
最近确认：fc51c25c69c3ea98a401554b486d58d256156be4

## FR-test-utils-011 真会话(非 provisional)档案下拉必须隐藏平台共享智能体条目(按 active 生效列表的 agent_profile_id 集合过滤,不按名称匹配)
变更：2026-10-19-hide-shared-profile-in-session
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-hide-shared-profile-in-session/requirements.md#FR-01
最近确认：4d992afc3f615222da8f0017cd75303fd4777cf8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-hide-shared-profile-in-session:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「真会话档案下拉隐藏共享智能体条目（按 active id 过滤）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-hide-shared-profile-in-session
  status: active

## FR-test-utils-012 当前会话档案本身恰为共享智能体时,该条目在真会话下拉中保留可见(共享会话不被饿死,但不提供共享档案互切)
变更：2026-10-19-hide-shared-profile-in-session
状态：active
摘要：共享会话自身
全文：.sillyspec/changes/archive/2026-10-19-hide-shared-profile-in-session/requirements.md#FR-02
最近确认：4d992afc3f615222da8f0017cd75303fd4777cf8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-hide-shared-profile-in-session:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「当前会话档案为共享智能体时该条目保留可见」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-hide-shared-profile-in-session
  status: active

## FR-test-utils-013 预会话(provisional)档案下拉保留共享智能体条目且置顶显示(排序在普通档案之前,普通档案间保持原序)
变更：2026-10-19-hide-shared-profile-in-session
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-hide-shared-profile-in-session/requirements.md#FR-03
最近确认：4d992afc3f615222da8f0017cd75303fd4777cf8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-hide-shared-profile-in-session:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「预会话档案下拉共享智能体置顶且带共享标识」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-hide-shared-profile-in-session
  status: active

## FR-test-utils-014 聚焦测试覆盖上述分支,tsc 0 错误
变更：2026-10-19-hide-shared-profile-in-session
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-19-hide-shared-profile-in-session/requirements.md#FR-04
最近确认：4d992afc3f615222da8f0017cd75303fd4777cf8

## FR-test-utils-015 拖拽吸附到边界容器左侧后,停靠组内容左对齐;吸附右侧后保持右对齐
变更：2026-10-20-pill-dock-left-align
状态：active
摘要：主路径；右吸附不受影响
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-left-align/requirements.md#FR-01
最近确认：a303e730226d05a93ba959773366a676cf54aa09

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-left-align:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「拖到右半屏松手吸附右缘(新增 items-end 断言)」 | test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值：跟手且钳制窗内，松手吸附较近左缘并持久化(新增 items-start 断言)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-left-align
  status: active

## FR-test-utils-016 持久化位置重载后对齐方向与吸附侧一致
变更：2026-10-20-pill-dock-left-align
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-left-align/requirements.md#FR-02
最近确认：a303e730226d05a93ba959773366a676cf54aa09

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-left-align:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「持久化位置恢复按吸附侧呈现对齐方向(新增两侧存档恢复用例)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-left-align
  status: active

## FR-test-utils-017 现有 dock 测试与新增断言全绿
变更：2026-10-20-pill-dock-left-align
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-left-align/requirements.md#FR-03
最近确认：a303e730226d05a93ba959773366a676cf54aa09

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-left-align:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「全量用例(含既有 11 例回归)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-left-align
  status: active

## FR-test-utils-018 左停靠的组拖拽过程中内容保持左对齐,不再翻回右对齐;右停靠同理保持右对齐
变更：2026-10-20-pill-dock-drag-align-keep
状态：active
摘要：主路径；右停靠拖拽不受影响
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-drag-align-keep/requirements.md#FR-01
最近确认：4f77e50c12b353f42e8442aed1fcdfea34234511

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-drag-align-keep:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「左停靠拖拽过程中保持左对齐(新增:吸附左后二次拖拽中断言 items-start)」 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「按住拖动超过阈值…(补拖拽中 items-end 断言)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-drag-align-keep
  status: active

## FR-test-utils-019 松手吸附后仍按吸附侧正确切换对齐(既有行为不变)
变更：2026-10-20-pill-dock-drag-align-keep
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-drag-align-keep/requirements.md#FR-02
最近确认：4f77e50c12b353f42e8442aed1fcdfea34234511

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-drag-align-keep:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「左停靠拖拽过程中保持左对齐(用例尾段:拖回右半边松手吸附后切 items-end)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-drag-align-keep
  status: active

## FR-test-utils-020 dock 测试全绿(新增拖拽中对齐保持断言)
变更：2026-10-20-pill-dock-drag-align-keep
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-20-pill-dock-drag-align-keep/requirements.md#FR-03
最近确认：4f77e50c12b353f42e8442aed1fcdfea34234511

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-pill-dock-drag-align-keep:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx「全量用例(含既有 12 例回归)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-pill-dock-drag-align-keep
  status: active

## FR-test-utils-021 已设默认供应商时，各「不指定」下拉项文案显示「不指定（默认：{默认供应商名}）」；未设默认保持「不指定（本机默认）」
变更：2026-10-21-provider-default-ui-hint
状态：active
摘要：有默认；无默认零回归
全文：.sillyspec/changes/archive/2026-10-21-provider-default-ui-hint/requirements.md#FR-01
最近确认：01207058ca048f4015b4074b38e32f1e2bba4335

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-provider-default-ui-hint:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「兜底项文案动态化」 | frontend/src/lib/api/__tests__/llm-providers.test.ts「noProviderLabel 有默认/无默认分支」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-provider-default-ui-hint
  status: active

## FR-test-utils-022 会话轮 timeline 的未选供应商显示对齐（null 时显示默认供应商名，无默认保持本机默认）
变更：2026-10-21-provider-default-ui-hint
状态：active
摘要：未选供应商轮显示默认名
全文：.sillyspec/changes/archive/2026-10-21-provider-default-ui-hint/requirements.md#FR-02
最近确认：01207058ca048f4015b4074b38e32f1e2bba4335

## FR-test-utils-023 provisional 态未选档案时，档案按钮显示用户默认档案名（无默认保持「未指定」）
变更：2026-10-21-profile-default-prehint
状态：active
摘要：预会话显示默认
全文：.sillyspec/changes/archive/2026-10-21-profile-default-prehint/requirements.md#FR-01
最近确认：9711e7721de76c3f71b59ac13d1bb63815c7ed53

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-profile-default-prehint:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「provisional 未选档案显示默认档案名」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-profile-default-prehint
  status: active

## FR-test-utils-024 运行中/已结束会话未选档案保持「未指定」；下拉「不指定」项 provisional 且有默认时显示「不指定（默认：{名}）」
变更：2026-10-21-profile-default-prehint
状态：active
摘要：运行中会话真值
全文：.sillyspec/changes/archive/2026-10-21-profile-default-prehint/requirements.md#FR-02
最近确认：9711e7721de76c3f71b59ac13d1bb63815c7ed53

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-profile-default-prehint:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「下拉兜底项 provisional 动态文案」 | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「非 provisional 未选保持未指定」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-profile-default-prehint
  status: active
