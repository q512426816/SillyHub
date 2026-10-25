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

## FR-test-utils-015 点击刷新按钮后按钮立即转圈且禁用，同步请求返回后恢复可点
变更：2026-10-21-files-refresh-spinner
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-files-refresh-spinner/requirements.md#FR-01
最近确认：e88ffddb76486f445e8bdac23d437a22c39a8ebd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-files-refresh-spinner:flow:测试绑定FR-01
  tests: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「点击刷新：同步进行中按钮禁用+转圈，返回后恢复」

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
  source_change: 2026-10-21-files-refresh-spinner
  status: active

## FR-test-utils-016 挂载与自动轮询的纯读刷新不触发转圈
变更：2026-10-21-files-refresh-spinner
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-21-files-refresh-spinner/requirements.md#FR-02
最近确认：e88ffddb76486f445e8bdac23d437a22c39a8ebd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-files-refresh-spinner:flow:测试绑定FR-02
  tests: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「纯读刷新（挂载/轮询）不触发转圈态」
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
  source_change: 2026-10-21-files-refresh-spinner
  status: active

## FR-test-utils-017 终态唤醒主路径（completed/failed → debounce 合并注入）
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：空闲会话单任务完成；多任务并发终态合并
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-01
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-task-wakeup-restore:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task 终态注入唤醒——单任务汇总 prompt」
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-018 不注入面（短任务/stopped/非法终态；双缺失 fail-open）
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：短任务不唤醒；stopped 不唤醒；双缺失 fail-open
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-02
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-task-wakeup-restore:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「stopped 终态不注入」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「双缺失 fail-open 放行唤醒」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「短任务低于阈值不注入」
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-019 阈值进程级可配（env，缺省 60000，0=关闭）
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：阈值配置生效；0 关闭阀
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-03
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-task-wakeup-restore:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「阈值 env 可配与 0 关闭阀」
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-020 影子任务路由隔离（pi 轮次聚合不触发唤醒）
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：pi 轮次聚合零注入
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-04
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-task-wakeup-restore:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「影子任务 agent_task_status 路由不触发唤醒」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-021 回归与类型门
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：全量回归
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-05
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

## FR-test-utils-022 唤醒轮前端留痕（「收到任务消息」折叠行，执行期用户追加——dsh 同款形态）
变更：2026-10-21-task-wakeup-restore
状态：active
摘要：回放路径；渲染形态
全文：.sillyspec/changes/archive/2026-10-21-task-wakeup-restore/requirements.md#FR-06
最近确认：440f3fd244d4810e1f4fb0a30c875767cab088e3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-task-wakeup-restore:flow:测试绑定FR-06
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「唤醒注入开轮 → task_wakeup 段置于段序列首部」 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「默认收起：显示「收到任务消息」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-task-wakeup-restore
  source_change: 2026-10-20-pill-dock-drag-align-keep
  status: active

## FR-test-utils-023 「进度」视图内提供「时间线 / 轨迹」呈现方式开关；默认「时间线」＝现状零变化，「对话」视图不出现该开关
变更：2026-10-22-session-trajectory-view
状态：active
摘要：主路径；默认与零回归
场景正文：
- 场景：主路径 — Given 一个有历史轮的会话；When 切到「进度」并点「轨迹」；Then 出现 `data-testid="trajectory-pane"`（含恰 3 个 `traj
- 场景：默认与零回归 — Given 同一会话；When 切到「进度」（默认「时间线」）；Then `turn-block` 照常渲染且不出现轨迹面板。And When 处于「对话」；Then 页面
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-view/requirements.md#FR-01
最近确认：4553d4410c53ba2798b50ef66c742190e10f5289

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-view:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-view
  status: active

## FR-test-utils-024 轨迹数据由当前会话已加载的 SessionTurnView[] 派生（零新增网络请求、零后端改动、零 API 变更）
变更：2026-10-22-session-trajectory-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-view/requirements.md#FR-02
最近确认：4553d4410c53ba2798b50ef66c742190e10f5289

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-view:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-view
  status: active

## FR-test-utils-025 `/runs` 的 `timing` 透传到轮视图：有 TTFT/attempt 采样时模型泳道标「真实占用」，无采样标「近似」，不伪造
变更：2026-10-22-session-trajectory-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-view/requirements.md#FR-03
最近确认：4553d4410c53ba2798b50ef66c742190e10f5289

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-view:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-view
  status: active

## FR-test-utils-026 无可用时序数据时显示显式空态提示，不白屏、不伪造条
变更：2026-10-22-session-trajectory-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 轮视图缺 `turnStartedAt`、缺 `replyAt` 且无段；When 打开「轨迹」；Then 出现空态提示且不出现三泳道面板、不出现轮块。
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-view/requirements.md#FR-04
最近确认：4553d4410c53ba2798b50ef66c742190e10f5289

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-view:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-view
  status: active

## FR-test-utils-027 tsc 退出 0；既有 trajectory 61 / turn-segment-views / turn-time-display / session-list-panel 用例不回归，新增适配器与呈现开关用例全绿
变更：2026-10-22-session-trajectory-view
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑 `tsc --noEmit` 与 `src/components/daemon` + `src/pages/sessions` + `s
全文：.sillyspec/changes/archive/2026-10-22-session-trajectory-view/requirements.md#FR-05
最近确认：4553d4410c53ba2798b50ef66c742190e10f5289

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-session-trajectory-view:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-session-trajectory-view
  status: active

## FR-test-utils-028 capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）
变更：2026-10-22-file-card-hide-empty
状态：active
摘要：历史轮（无快照能力）；采集失败（有快照但不可信）
场景正文：
- 场景：历史轮（无快照能力） — Given 一轮的读模型为 `file_changes=null` + `file_changes_capability="tool_only"`；When 会话页渲染该轮
- 场景：采集失败（有快照但不可信） — Given 一轮的快照 `status="unavailable"`（git 缺失 / 非 git 仓）或 `status="failed"`；When 渲染该轮；Then
全文：.sillyspec/changes/archive/2026-10-22-file-card-hide-empty/requirements.md#FR-01
最近确认：a9232edf123799304e3f47172a4fc3499c754b65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-card-hide-empty:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-card-hide-empty
  status: active

## FR-test-utils-029 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化
变更：2026-10-22-file-card-hide-empty
状态：active
摘要：主路径；partial 且无文件清单（保留）
场景正文：
- 场景：主路径 — Given 一轮快照 `status="ok"` 且 `files` 含 2 条（1 条 `edit_patch`、1 条 `command`）；When 渲染该轮；The
- 场景：partial 且无文件清单（保留） — Given 快照 `status="partial"` 且 `files=[]`（1500ms 超时 / 队列溢出）；When 渲染该轮；Then 仍渲染一行提示卡（`da
全文：.sillyspec/changes/archive/2026-10-22-file-card-hide-empty/requirements.md#FR-02
最近确认：a9232edf123799304e3f47172a4fc3499c754b65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-card-hide-empty:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx | frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-card-hide-empty
  status: active

## FR-test-utils-030 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染
变更：2026-10-22-file-card-hide-empty
状态：active
摘要：全历史轮（零文件）；真实轮 + 历史轮混合
场景正文：
- 场景：全历史轮（零文件） — Given 58 轮全部 `file_changes_capability="tool_only"`；When 渲染会话级汇总；Then 汇总卡不渲染（`data-test
- 场景：真实轮 + 历史轮混合 — Given 3 轮有可信快照（共 5 个文件）且 55 轮无快照；When 渲染汇总；Then 卡片在场且「共 5 个文件」按真实轮统计，不出现「N 轮无工作区快照」字样。
全文：.sillyspec/changes/archive/2026-10-22-file-card-hide-empty/requirements.md#FR-03
最近确认：a9232edf123799304e3f47172a4fc3499c754b65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-card-hide-empty:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-card-hide-empty
  status: active

## FR-test-utils-031 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0
变更：2026-10-22-file-card-hide-empty
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑 `tsc --noEmit` 与 `src/components/daemon/file-changes/__tests__/` + `
全文：.sillyspec/changes/archive/2026-10-22-file-card-hide-empty/requirements.md#FR-04
最近确认：a9232edf123799304e3f47172a4fc3499c754b65

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-file-card-hide-empty:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-file-card-hide-empty
  status: active

## FR-test-utils-032 turn_trigger 段泛化（task_wakeup 行为零变化）
变更：2026-10-22-turn-trigger-generalize
状态：active
摘要：task_wakeup 等价回归
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-generalize/requirements.md#FR-01
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-generalize:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「TurnTriggerView 按 kind 渲染——task_wakeup 与现状等价」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-generalize
  status: active

## FR-test-utils-033 auto_resume 轮触发（断线自动续跑）
变更：2026-10-22-turn-trigger-generalize
状态：active
摘要：续跑轮触发行
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-generalize/requirements.md#FR-02
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-generalize:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「auto_resume 注入开轮 → 断线自动续跑触发行」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-generalize
  status: active

## FR-test-utils-034 影子直聊/群聊开轮来源标注（正文可见）
变更：2026-10-22-turn-trigger-generalize
状态：active
摘要：影子直聊开轮；中途群聊注入不产触发行
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-generalize/requirements.md#FR-03
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-generalize:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「中途群聊注入不产触发行」 | frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「影子直聊/群聊开轮来源标注且正文可见」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-generalize
  status: active

## FR-test-utils-035 排队栏触发源事件行泛化
变更：2026-10-22-turn-trigger-generalize
状态：active
摘要：续跑条目事件行
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-generalize/requirements.md#FR-04
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-turn-trigger-generalize:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx「auto_resume 条目事件行与计数口径」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-turn-trigger-generalize
  status: active

## FR-test-utils-036 回归与类型门
变更：2026-10-22-turn-trigger-generalize
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-22-turn-trigger-generalize/requirements.md#FR-05
最近确认：7338a61c878a5f33c1d1a0647cf900f2b71c14d1

## FR-test-utils-037 会话页 pending AskUser 提问卡嵌入内容流渲染（非 sticky 钉顶悬浮），随日志上下滚动
变更：2026-10-22-askuser-card-inline
状态：active
摘要：长日志滚动；卡片位置
全文：.sillyspec/changes/archive/2026-10-22-askuser-card-inline/requirements.md#FR-01
最近确认：05c42dea444bb413efd0c2d6b0a7a9f53e8e0f9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-card-inline:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「默认展开：卡头有最小化按钮，无胶囊」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-card-inline
  status: active

## FR-test-utils-038 全部最小化时容器仍仅作挂载占位（无视觉框），右下角胶囊行为不变
变更：2026-10-22-askuser-card-inline
状态：active
摘要：全部最小化
全文：.sillyspec/changes/archive/2026-10-22-askuser-card-inline/requirements.md#FR-02
最近确认：05c42dea444bb413efd0c2d6b0a7a9f53e8e0f9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-card-inline:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「最小化：卡片消失、胶囊出现角标 1、视觉框移除」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-card-inline
  status: active

## FR-test-utils-039 待决策 pill 定位还原（滚顶+ring 闪烁）功能不回退
变更：2026-10-22-askuser-card-inline
状态：active
摘要：pill 定位还原
全文：.sillyspec/changes/archive/2026-10-22-askuser-card-inline/requirements.md#FR-03
最近确认：05c42dea444bb413efd0c2d6b0a7a9f53e8e0f9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-card-inline:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx「还原保留已填内容：选项 + 手动输入原样恢复」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-card-inline
  status: active

## FR-test-utils-040 受影响测试通过，tsc 零错
变更：2026-10-22-askuser-card-inline
状态：active
摘要：验证
全文：.sillyspec/changes/archive/2026-10-22-askuser-card-inline/requirements.md#FR-04
最近确认：05c42dea444bb413efd0c2d6b0a7a9f53e8e0f9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-askuser-card-inline:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-askuser-card-inline
  status: active

## FR-test-utils-042 拖拽吸附到边界容器左侧后,停靠组内容左对齐;吸附右侧后保持右对齐
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

## FR-test-utils-043 持久化位置重载后对齐方向与吸附侧一致
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
  source_change: 2026-10-21-files-refresh-spinner
  status: active

## FR-test-utils-044 现有 dock 测试与新增断言全绿
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
  source_change: 2026-10-21-files-refresh-spinner
  status: active

## FR-test-utils-045 左停靠的组拖拽过程中内容保持左对齐,不再翻回右对齐;右停靠同理保持右对齐
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-046 松手吸附后仍按吸附侧正确切换对齐(既有行为不变)
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-041 dock 测试全绿(新增拖拽中对齐保持断言)
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
  source_change: 2026-10-21-task-wakeup-restore
  status: active

## FR-test-utils-047 已设默认供应商时，各「不指定」下拉项文案显示「不指定（默认：{默认供应商名}）」；未设默认保持「不指定（本机默认）」
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

## FR-test-utils-048 会话轮 timeline 的未选供应商显示对齐（null 时显示默认供应商名，无默认保持本机默认）
变更：2026-10-21-provider-default-ui-hint
状态：active
摘要：未选供应商轮显示默认名
全文：.sillyspec/changes/archive/2026-10-21-provider-default-ui-hint/requirements.md#FR-02
最近确认：01207058ca048f4015b4074b38e32f1e2bba4335

## FR-test-utils-049 provisional 态未选档案时，档案按钮显示用户默认档案名（无默认保持「未指定」）
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

## FR-test-utils-050 运行中/已结束会话未选档案保持「未指定」；下拉「不指定」项 provisional 且有默认时显示「不指定（默认：{名}）」
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

## FR-test-utils-051 同根新 workspaceId 的采集不再被旧探针的淘汰条目静默跳过（竞态测试钉住），skip 命中有一次性 warn 日志
变更：2026-10-23-review-risk-fixes-2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-review-risk-fixes-2/requirements.md#FR-01
最近确认：d5025964ba5f773353e8fbe92bcf4c07569660ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-review-risk-fixes-2:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/sillyspec-manager.test.ts「同根新 workspaceId 不被陈旧淘汰条目静默跳过 + skip 命中一次性 warn（2026-10-23-review-risk-fixes-2）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-review-risk-fixes-2
  status: active

## FR-test-utils-052 跑马灯追平目标后 rAF 停排，新内容到达或重新可见时恢复动画
变更：2026-10-23-review-risk-fixes-2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-review-risk-fixes-2/requirements.md#FR-02
最近确认：d5025964ba5f773353e8fbe92bcf4c07569660ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-review-risk-fixes-2:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「追平目标后 rAF 停排，entries 更新重新起排（2026-10-23-review-risk-fixes-2）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-review-risk-fixes-2
  status: active

## FR-test-utils-053 diff 阶段非 timeout git 错误落结构化 warn 日志（stage+错误归类），不再无痕消失
变更：2026-10-23-review-risk-fixes-2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-review-risk-fixes-2/requirements.md#FR-03
最近确认：d5025964ba5f773353e8fbe92bcf4c07569660ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-review-risk-fixes-2:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/turn-file-changes.test.ts「name-status 非 timeout git 错误经 onGitDiagnostic 落结构化诊断（2026-10-23-review-risk-fixes-2）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-review-risk-fixes-2
  status: active

## FR-test-utils-054 requestBatch 响应处理异常时该批回退原文并入退避，Promise 不再悬挂
变更：2026-10-23-review-risk-fixes-2
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-review-risk-fixes-2/requirements.md#FR-04
最近确认：d5025964ba5f773353e8fbe92bcf4c07569660ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-review-risk-fixes-2:flow:测试绑定FR-04
  tests: frontend/src/lib/__tests__/thinking-translate.test.ts「2xx 脏响应体（null/缺 items）→ 本批回退原文+退避，Promise 不悬挂（FR-04）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-review-risk-fixes-2
  status: active

## FR-test-utils-055 点击文件变更卡中的文件行，弹出模态弹窗显示该文件本轮的具体变更内容（diff 形式，带行号红删绿增）
变更：2026-10-23-turn-file-diff-dialog
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-turn-file-diff-dialog/requirements.md#FR-01
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-turn-file-diff-dialog:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「sessionId 接线：点击文件行弹窗打开，展示该文件本轮 diff 内容（FR-01）」 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「命中补丁：渲染路径标题 + 第 1 次 Edit 分段 + 行级 diff（红删绿增）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-turn-file-diff-dialog
  status: active

## FR-test-utils-056 同一文件多次编辑（改N次）在弹窗中按次展示多段 diff
变更：2026-10-23-turn-file-diff-dialog
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-turn-file-diff-dialog/requirements.md#FR-02
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-turn-file-diff-dialog:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「同文件多次编辑按次展示多段」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-turn-file-diff-dialog
  status: active

## FR-test-utils-057 命令行归因/二进制等无补丁内容的行，点击后弹窗如实说明无补丁原因，不显示伪造内容
变更：2026-10-23-turn-file-diff-dialog
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-turn-file-diff-dialog/requirements.md#FR-03
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-turn-file-diff-dialog:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「shell 归因行如实说明无补丁」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-turn-file-diff-dialog
  status: active

## FR-test-utils-058 未接 sessionId 的旧消费方（agent-replay-body 等）零回归：行不响应点击、不出弹窗
变更：2026-10-23-turn-file-diff-dialog
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-turn-file-diff-dialog/requirements.md#FR-04
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-turn-file-diff-dialog:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「未接 sessionId 文件行不响应点击」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-turn-file-diff-dialog
  status: active

## FR-test-utils-059 相关组件测试绿（纯映射配对逻辑 + 弹窗形态 + 挂载面接线）
变更：2026-10-23-turn-file-diff-dialog
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-turn-file-diff-dialog/requirements.md#FR-05
最近确认：c91a1d6c30d543016c1570e8bdc00cade0374987

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-turn-file-diff-dialog:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「日志配对纯映射」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-turn-file-diff-dialog
  status: active

## FR-test-utils-060 只保留最近12条过程事件，更早的直接丢弃，渲染条目数恒定不超过12
变更：2026-10-23-marquee-queue-window
状态：active
摘要：普通会话；长会话
全文：.sillyspec/changes/archive/2026-10-23-marquee-queue-window/requirements.md#FR-01
最近确认：bde8745c66dec2a3745f7cfdfaeff7d3708ea923

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-queue-window:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「条目超过上限时只保留最近 12 条」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-queue-window
  status: active

## FR-test-utils-061 轨道总宽收敛到约3.3k px，不再出现数万px宽轨道
变更：2026-10-23-marquee-queue-window
状态：active
摘要：窗口滑动
全文：.sillyspec/changes/archive/2026-10-23-marquee-queue-window/requirements.md#FR-02
最近确认：bde8745c66dec2a3745f7cfdfaeff7d3708ea923

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-queue-window:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「窗口滑动目标回到 base，连续滑动不累积越界（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-queue-window
  status: active

## FR-test-utils-062 更新上限相关测试并全部通过，lint与typecheck通过
变更：2026-10-23-marquee-queue-window
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-23-marquee-queue-window/requirements.md#FR-03
最近确认：bde8745c66dec2a3745f7cfdfaeff7d3708ea923

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-marquee-queue-window:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-marquee-queue-window
  status: active

## FR-test-utils-063 对话与进度两视图中 agent 反馈信息块宽度统一为整行宽度-120px
变更：2026-10-25-session-tab-visual-unify
状态：active
摘要：两视图宽度一致
全文：.sillyspec/changes/archive/2026-10-25-session-tab-visual-unify/requirements.md#FR-01
最近确认：17f1dfc084703c7d72c86a4c5d44eb1099c5794f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-tab-visual-unify:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「无框形态：容器挂 seg-text-body（w-full + 52rem 阅读限宽），无气泡框样式类」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-tab-visual-unify
  status: active

## FR-test-utils-064 AskUser 提问记录两视图统一用对话视图的问答块组件渲染
变更：2026-10-25-session-tab-visual-unify
状态：active
摘要：进度视图提问卡换形态
全文：.sillyspec/changes/archive/2026-10-25-session-tab-visual-unify/requirements.md#FR-02
最近确认：17f1dfc084703c7d72c86a4c5d44eb1099c5794f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-tab-visual-unify:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx「all 视图 AskUser 提问按时间戳穿插在段线对应位置（merged 排序平移）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-tab-visual-unify
  status: active

## FR-test-utils-065 右侧悬浮按钮文案由「变更文件」改为「变更」
变更：2026-10-25-session-tab-visual-unify
状态：active
摘要：入口按钮文案
全文：.sillyspec/changes/archive/2026-10-25-session-tab-visual-unify/requirements.md#FR-03
最近确认：17f1dfc084703c7d72c86a4c5d44eb1099c5794f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-tab-visual-unify:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-tab-visual-unify
  status: active

## FR-test-utils-066 受影响的既有测试断言同步更新，本变更相关测试通过
变更：2026-10-25-session-tab-visual-unify
状态：active
摘要：回归验证
全文：.sillyspec/changes/archive/2026-10-25-session-tab-visual-unify/requirements.md#FR-04
最近确认：17f1dfc084703c7d72c86a4c5d44eb1099c5794f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-session-tab-visual-unify:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-session-tab-visual-unify
  status: active

## FR-test-utils-067 [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）
变更：2026-10-25-askuser-keyword-overkill-fix
状态：active
摘要：正文提及关键词的回复完整保留；96b55567 真实形态回归
全文：.sillyspec/changes/archive/2026-10-25-askuser-keyword-overkill-fix/requirements.md#FR-01
最近确认：e283fed09505c71f36ac96dc6ec1d237a80b08c0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-askuser-keyword-overkill-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「[ASSISTANT] 正文提及 AskUserQuestion → reply 全文保留（96b55567 形态回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-askuser-keyword-overkill-fix
  status: active

## FR-test-utils-068 [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段
变更：2026-10-25-askuser-keyword-overkill-fix
状态：active
摘要：思考行正文提及关键词
全文：.sillyspec/changes/archive/2026-10-25-askuser-keyword-overkill-fix/requirements.md#FR-02
最近确认：e283fed09505c71f36ac96dc6ec1d237a80b08c0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-askuser-keyword-overkill-fix:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「[THINKING] 正文提及 AskUserQuestion → thinking 不误杀」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-askuser-keyword-overkill-fix
  status: active

## FR-test-utils-069 AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃
变更：2026-10-25-askuser-keyword-overkill-fix
状态：active
摘要：tool_call JSON 行维持丢弃；[TOOL_USE] 文本行维持丢弃
全文：.sillyspec/changes/archive/2026-10-25-askuser-keyword-overkill-fix/requirements.md#FR-03
最近确认：e283fed09505c71f36ac96dc6ec1d237a80b08c0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-askuser-keyword-overkill-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「AskUserQuestion 工具调用行维持丢弃（tool_call JSON / 裸 JSON / [TOOL_USE] 文本行）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-askuser-keyword-overkill-fix
  status: active

## FR-test-utils-070 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过
变更：2026-10-25-askuser-keyword-overkill-fix
状态：active
摘要：验证门
全文：.sillyspec/changes/archive/2026-10-25-askuser-keyword-overkill-fix/requirements.md#FR-04
最近确认：e283fed09505c71f36ac96dc6ec1d237a80b08c0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-askuser-keyword-overkill-fix:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts | frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-askuser-keyword-overkill-fix
  status: active

## FR-test-utils-071 TurnLiveMarquee 新增 active 属性（默认 true）：active=false 时不再追加「等待模型响应」合成条目，走秒 tick 也不为等待而启动
变更：2026-10-25-marquee-inactive-awaiting-fix
状态：active
摘要：终态宿主
全文：.sillyspec/changes/archive/2026-10-25-marquee-inactive-awaiting-fix/requirements.md#FR-01
最近确认：3a1f4551fb083eb1cd2ef1ec56438fdcadf60c13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-inactive-awaiting-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「active=false 时不显示等待条目（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-inactive-awaiting-fix
  status: active

## FR-test-utils-072 SubagentBlockView 按卡片自身运行态传 active：子代理终态后内嵌流动条无等待条目、无转圈；运行中行为不变
变更：2026-10-25-marquee-inactive-awaiting-fix
状态：active
摘要：子代理结束
全文：.sillyspec/changes/archive/2026-10-25-marquee-inactive-awaiting-fix/requirements.md#FR-02
最近确认：3a1f4551fb083eb1cd2ef1ec56438fdcadf60c13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-inactive-awaiting-fix:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「终态子代理卡片内嵌流动条无等待条目（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-inactive-awaiting-fix
  status: active

## FR-test-utils-073 外部会话跑马灯不传 active，行为零变化
变更：2026-10-25-marquee-inactive-awaiting-fix
状态：active
摘要：外部零回归
全文：.sillyspec/changes/archive/2026-10-25-marquee-inactive-awaiting-fix/requirements.md#FR-03
最近确认：3a1f4551fb083eb1cd2ef1ec56438fdcadf60c13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-marquee-inactive-awaiting-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目非运行中时出现等待模型响应条目」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-marquee-inactive-awaiting-fix
  status: active

## FR-test-utils-074 新增终态不显示等待条目用例；现有全部用例通过；lint与typecheck通过
变更：2026-10-25-marquee-inactive-awaiting-fix
状态：active
摘要：回归核验
全文：.sillyspec/changes/archive/2026-10-25-marquee-inactive-awaiting-fix/requirements.md#FR-04
最近确认：3a1f4551fb083eb1cd2ef1ec56438fdcadf60c13
