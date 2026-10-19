---
author: sillyspec-fr-index
created_at: 2026-10-15T08:08:24.452Z
---

# FR 索引 — frontend_components

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/frontend_components.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-claude-004 鼠标悬停底部区域标签时，浮层翻到鼠标上方显示，永远在视口内
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 输入框贴页面底缘、鼠标悬停标签（y≈720，视口高 768）/ When 浮层渲染 / Then top=662（鼠标上方）且在视口内。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-01
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active

## FR-auto-claude-005 常规位置（下方有空间）仍显示在鼠标下方 16px
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given y=200 / When 渲染 / Then top=216。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-02
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active

## FR-auto-claude-006 相关测试全绿
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given vitest run input-ref-overlay.test.tsx / Then 14/14 通过。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-03
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active

## FR-auto-claude-007 浮层经 portal 挂 document.body，fixed 相对视口定位，坐标零偏移
变更：2026-10-12-ws-ref-hover-tip-portal
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 悬停命中标签 / When 浮层渲染 / Then rect.top === 解析 style.top（视口坐标系）。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-portal/requirements.md#FR-01
最近确认：f9406f124c645aa4092cefe74c91e05e6afd510f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-portal:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 传入时渲染 fixed 元数据气泡；null 时零渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-portal
  status: active

## FR-auto-claude-008 底部空间不足翻转逻辑在正确坐标系下生效
变更：2026-10-12-ws-ref-hover-tip-portal
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-portal/requirements.md#FR-02
最近确认：f9406f124c645aa4092cefe74c91e05e6afd510f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-portal:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-portal
  status: active

## FR-auto-claude-009 相关测试全绿（portal 断言同步）
变更：2026-10-12-ws-ref-hover-tip-portal
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-portal/requirements.md#FR-03
最近确认：f9406f124c645aa4092cefe74c91e05e6afd510f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-portal:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-portal
  status: active

## FR-auto-claude-010 悬停浮层显示工作区中文名（别名优先），查不到回退 id
变更：2026-10-12-ws-ref-ws-name
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 工作区列表已加载（名称 SillyHub）/ When 插入引用并悬停 / Then 浮层显示「（工作区 SillyHub）」。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-ws-name/requirements.md#FR-01
最近确认：40622e032cbece20e57db17154d582ce835e67b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-ws-name:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-ws-name
  status: active

## FR-auto-claude-011 不新增网络请求
变更：2026-10-12-ws-ref-ws-name
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 列表已拉取 / When 进文件模式插引用 / Then 无第二次 listWorkspaces 调用（缓存命中）。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-ws-name/requirements.md#FR-02
最近确认：40622e032cbece20e57db17154d582ce835e67b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-ws-name:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-ws-name
  status: active

## FR-auto-claude-012 发送置换/历史标记协议零变化；相关测试全绿
变更：2026-10-12-ws-ref-ws-name
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-ws-name/requirements.md#FR-03
最近确认：40622e032cbece20e57db17154d582ce835e67b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-ws-name:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-ws-name
  status: active

## FR-auto-claude-013 workspace/change/quicklog 三种 scope 入口的「继续最近会话」只取本工作区（workspace_id 过滤后 last_active_at 优先）的最近会话
变更：2026-10-12-ws-scoped-recent-session
状态：active
摘要：跨工作区取最近
全文：.sillyspec/changes/archive/2026-10-12-ws-scoped-recent-session/requirements.md#FR-01
最近确认：7b2c7634f9f61dab59ee167179fd3931feeffe07

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-scoped-recent-session:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口最近会话属其他工作区时按本工作区取（workspace/change/quicklog 三入口）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-scoped-recent-session
  status: active

## FR-auto-claude-014 全局 /sessions（无 scope）行为不变，仍取全局最近会话
变更：2026-10-12-ws-scoped-recent-session
状态：active
摘要：全局门户不受影响
全文：.sillyspec/changes/archive/2026-10-12-ws-scoped-recent-session/requirements.md#FR-02
最近确认：7b2c7634f9f61dab59ee167179fd3931feeffe07

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-scoped-recent-session:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「ql-20260910-002 门户带 includeSessions 拉取 + 继续最近会话直达选中并落工作区快照」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-scoped-recent-session
  status: active

## FR-auto-claude-015 本工作区无会话（或未进全局前 100）时按钮不渲染，沿用 null 不渲染契约
变更：2026-10-12-ws-scoped-recent-session
状态：active
摘要：本工作区无会话
全文：.sillyspec/changes/archive/2026-10-12-ws-scoped-recent-session/requirements.md#FR-03
最近确认：7b2c7634f9f61dab59ee167179fd3931feeffe07

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-scoped-recent-session:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口本工作区无会话时不渲染继续最近会话入口」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-scoped-recent-session
  status: active

## FR-auto-claude-016 resolveDefaultMachineId 默认机器解析仍用全局 sessions，语义不变
变更：2026-10-12-ws-scoped-recent-session
状态：active
摘要：默认机器解析不变
全文：.sillyspec/changes/archive/2026-10-12-ws-scoped-recent-session/requirements.md#FR-04
最近确认：7b2c7634f9f61dab59ee167179fd3931feeffe07

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-scoped-recent-session:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「resolveDefaultMachineId 三级回退既有用例（localStorage 命中/最近会话所在机器/最新心跳）——语义照旧回归锁定」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-scoped-recent-session
  status: active

## FR-auto-claude-017 测试覆盖：scope 入口最近会话属其他工作区时取本工作区会话或隐藏按钮；全局门户不受影响
变更：2026-10-12-ws-scoped-recent-session
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-12-ws-scoped-recent-session/requirements.md#FR-05
最近确认：7b2c7634f9f61dab59ee167179fd3931feeffe07

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-scoped-recent-session:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「scope 入口最近会话属其他工作区时按本工作区取（workspace/change/quicklog 三入口）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-scoped-recent-session
  status: active

## FR-auto-claude-018 scroll 事件处理器（onScroll 及其同步调用链 handleLoadEarlier 的锚捕获段）内不再有同步强制布局：锚点重申与锚捕获的 DOM 遍历/几何读取全部改 rAF 合帧执行
变更：2026-10-13-session-scroll-layout-storm
状态：active
摘要：程序性 scroll 高频风暴合帧
全文：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/requirements.md#FR-01
最近确认：17abec741527b36896c20525f431558a43fa893a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-scroll-layout-storm:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「程序性 scroll 钉回改 rAF 合帧：事件内零同步 scrollTop 写入、下一帧才执行（2026-10-13-session-scroll-layout-storm）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-scroll-layout-storm
  status: active

## FR-auto-claude-019 行为零回归：触顶翻页仍按 scrollTop<=48 触发、prepend 后视口钉回语义不变、用户真实滚动（isTrusted）弃锚逻辑不变
变更：2026-10-13-session-scroll-layout-storm
状态：active
摘要：用户接管弃锚
全文：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/requirements.md#FR-02
最近确认：17abec741527b36896c20525f431558a43fa893a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-scroll-layout-storm:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「scroll to top triggers loadEarlier with before cursor, older content prepends」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-scroll-layout-storm
  status: active

## FR-auto-claude-020 anchorPin rAF 句柄有清理（卸载/锚失效不泄漏 rAF 回调）
变更：2026-10-13-session-scroll-layout-storm
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/requirements.md#FR-03
最近确认：17abec741527b36896c20525f431558a43fa893a

## FR-auto-claude-021 相关既有测试（session-panel 触顶加载/锚定/跳转用例）全绿
变更：2026-10-13-session-scroll-layout-storm
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/requirements.md#FR-04
最近确认：17abec741527b36896c20525f431558a43fa893a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-session-scroll-layout-storm:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「既有触顶翻页/游标推进/锚定期 interval 配对/回到会话开头全部用例（回归锁）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-session-scroll-layout-storm
  status: active

## FR-auto-claude-022 单页 4 份 useDaemonMachines 轮询合并不在本变更范围（另立变更），本变更不动轮询
变更：2026-10-13-session-scroll-layout-storm
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-13-session-scroll-layout-storm/requirements.md#FR-05
最近确认：17abec741527b36896c20525f431558a43fa893a

## FR-auto-frontend-221 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-01
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-222 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-02
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「决策行弹窗定位：同 id 跨变更按变更号+决策号复合锚精确命中」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-223 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-03
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx「anchor 含变更号前缀（变更号#决策号）：先试复合锚精确落卡」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-224 知识触达行与手册/INDEX 锚点行为不变
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-04
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达：锚点条目行点击弹窗打开，弹窗深链沿用 file+anchor（不整页跳转）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-225 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）
变更：2026-10-14-decision-anchor-change-qualified
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-decision-anchor-change-qualified/requirements.md#FR-05
最近确认：0ef23e479d8a39229486671e590a4d19864849d5

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-decision-anchor-change-qualified:flow:测试绑定FR-05
  tests: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-decision-anchor-change-qualified
  status: active

## FR-auto-frontend-226 check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过
变更：2026-10-15-ci-recurrence-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/requirements.md#FR-01
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-ci-recurrence-guard:flow:测试绑定FR-01
  tests: backend/tests/test_check_assertion_surfaces.py「test_openapi_change_without_both_generated_files_is_violation」 | backend/tests/test_check_assertion_surfaces.py「test_rule7_requires_all_three_pins」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-ci-recurrence-guard
  status: active

## FR-auto-frontend-227 knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）
变更：2026-10-15-ci-recurrence-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/requirements.md#FR-02
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9

## FR-auto-frontend-228 CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务
变更：2026-10-15-ci-recurrence-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/requirements.md#FR-03
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9

## FR-auto-frontend-229 backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次
变更：2026-10-15-ci-recurrence-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/requirements.md#FR-04
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9

## FR-auto-frontend-230 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）
变更：2026-10-15-ci-recurrence-guard
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-ci-recurrence-guard/requirements.md#FR-05
最近确认：2c669d90e1853c52f575c56980410ab75fe55ee9

## FR-auto-frontend-258 未加载轮次消息流预览卡
变更：2026-10-14-session-turn-preview-cards
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开含未加载轮次的长会话（消息流窗口外存在历史轮，且 turn-outline 大纲可用）；When 消息流渲染；Then 每个未加载轮按大纲轮序原位渲染预览卡，卡内含轮号、状态标识、时间、提问摘要（最多 2 行）与答复摘要（有则显示，最多 2 行）；已加载轮渲染完整内容不变；预览卡
全文：.sillyspec/changes/archive/2026-10-14-session-turn-preview-cards/requirements.md#FR-01
最近确认：e785e71f9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-turn-preview-cards:task-01:acc-0-d8f6e9b2
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active
- row: 2026-10-14-session-turn-preview-cards:task-01:acc-1-b3fdab95
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active
- row: 2026-10-14-session-turn-preview-cards:task-02:acc-0-abd7a6f3
  tests: frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active
- row: 2026-10-14-session-turn-preview-cards:task-02:acc-1-6852ae89
  tests: frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active
- row: 2026-10-14-session-turn-preview-cards:task-02:acc-2-efae3213
  tests: frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active

## FR-auto-frontend-259 预览卡点击原地展开
变更：2026-10-14-session-turn-preview-cards
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 消息流中存在预览卡；When 用户点击某预览卡（或其「展开完整对话」入口）；Then 系统按该轮 run_id 拉取整轮日志并原地替换预览卡为完整轮块（替换后同轮不得出现双块），随后 2.2 秒 ring 高亮反馈自清；展开过程不触发滚动定位；该
全文：.sillyspec/changes/archive/2026-10-14-session-turn-preview-cards/requirements.md#FR-02
最近确认：e785e71f9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-turn-preview-cards:task-04:acc-0-f07e93f9
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx | frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active
- row: 2026-10-14-session-turn-preview-cards:task-04:acc-1-ddf1f4f0
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx | frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-turn-preview-cards
  status: active

## FR-auto-frontend-260 跳转附近预取
变更：2026-10-14-session-turn-preview-cards
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户通过左侧导航跳转到某个未加载轮次；When 该轮单轮直达加载成功；Then 系统按大纲序取其前后各 1 个未加载轮（若存在）后台异步拉取并原位补入消息流，不阻塞目标轮显示、不打扰当前视口滚动；预取遵循三重防重（已加载判重、在飞去重、零正
全文：.sillyspec/changes/archive/2026-10-14-session-turn-preview-cards/requirements.md#FR-03
最近确认：e785e71f9

## FR-auto-frontend-261 大纲缺失降级
变更：2026-10-14-session-turn-preview-cards
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given turn-outline 大纲不可用（拉取失败 / 旧 daemon / 空会话）；When 消息流渲染；Then 页面降级为现状形态（仅显示已加载轮内容），不报错、不空白、不渲染残缺预览卡。
全文：.sillyspec/changes/archive/2026-10-14-session-turn-preview-cards/requirements.md#FR-04
最近确认：e785e71f9

## FR-auto-frontend-262 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块
变更：2026-10-14-session-preview-defect-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话大纲含未加载失败轮（run 日志仅有 user_input 行）；When 用户点击该轮预览卡或导航刻度；Then 单轮直达发起且恰一次，装配块进入消息流（用户消息气泡可见），预览卡消失无双块，重复点击不再发起请求
全文：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/requirements.md#FR-01
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-preview-defect-fixes:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「defect-fixes：额度失败轮（仅 user_input 无答复）点导航原位展开用户消息，且重复点击不重复请求」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-preview-defect-fixes
  status: active

## FR-auto-frontend-263 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend
变更：2026-10-14-session-preview-defect-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 未加载轮的日志装配产物 prompt="" 且 output="" 且无 segments；When 首次点击后再次点击；Then 该轮 run_id 请求总数保持 1，消息流无该轮重复块，预览卡保持原位
全文：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/requirements.md#FR-02
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-preview-defect-fixes:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx「defect-fixes：真零正文轮（无 user_input 无答复）幂等语义不变——不展开不重复请求」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-preview-defect-fixes
  status: active

## FR-auto-frontend-264 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐
变更：2026-10-14-session-preview-defect-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given logsToTurns 批次局部编号（如初始窗口末块=12、单轮直达恒 1）与大纲 seq 不一致；When displayTurns 派生；Then 已加载块轮号 = 大纲 seq，与同屏预览卡/导航刻度轮号一致
全文：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/requirements.md#FR-03
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-preview-defect-fixes:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「已加载块轮号与大纲 seq 不一致时盖章为 seq（logsToTurns 批次局部编号对齐权威轮序）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-preview-defect-fixes
  status: active

## FR-auto-frontend-265 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）
变更：2026-10-14-session-preview-defect-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 同一已加载块引用连续两次进入归并派生；When 取输出；Then 两次输出中该块的引用相同（===）
全文：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/requirements.md#FR-04
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-preview-defect-fixes:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts「盖章引用稳定：同输入重复派生保持同引用（不击穿 TurnRow memo）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-preview-defect-fixes
  status: active

## FR-auto-frontend-266 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0
变更：2026-10-14-session-preview-defect-fixes
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复代码合入；When 跑上述定向测试面；Then 全部通过（含新增用例：盖章 3 例 + 失败轮展开/真零正文幂等 2 例）
全文：.sillyspec/changes/archive/2026-10-14-session-preview-defect-fixes/requirements.md#FR-05
最近确认：88de2e76e1d0c8b890b0d8812b4ec9057acfac48

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-preview-defect-fixes:flow:测试绑定FR-05
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「task-01/02（2026-09-29-jump-empty-turn-dup）零正文轮二次点击不重复单轮直达 prepend（口径修正后复绿）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-preview-defect-fixes
  status: active

## FR-auto-frontend-267 大纲后到（中段插入预览卡/孤儿补建尾部追加）且用户贴底时，视口跟随滚到底（保持所见内容不变）
变更：2026-10-14-session-bottom-follow-insert
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 会话初始日志窗口已贴底、用户位于底部；When 全量大纲后到使归并层在中段插入预览条目（末轮不变、列表长度+1）；Then 视口自动滚到底部（导航 active 与消息流末轮一致），高度重申窗口重启
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/requirements.md#FR-01
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06

## FR-auto-frontend-231 触顶翻页 prepend 不被误触发贴底（isPrepend 早退 + 3s 静默窗既有守卫不变）
变更：2026-10-14-session-bottom-follow-insert
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）；When prepend 落地后任意 turns 提交；Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/requirements.md#FR-02
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-follow-insert:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-follow-insert
  status: active

## FR-auto-frontend-232 用户上滚读历史时中段插入不强拉底部（isNearBottomRef 守卫不变）
变更：2026-10-14-session-bottom-follow-insert
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）；When prepend 落地后任意 turns 提交；Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/requirements.md#FR-03
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-follow-insert:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-history-race.test.tsx | frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-follow-insert
  status: active

## FR-auto-frontend-233 跳转期间不贴底（suppressFollowBottom 语义不变）
变更：2026-10-14-session-bottom-follow-insert
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）；When prepend 落地后任意 turns 提交；Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/requirements.md#FR-04
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-follow-insert:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-follow-insert
  status: active

## FR-auto-frontend-234 既有贴底/翻页/跳转相关测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-follow-insert
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 用户上拉触发「加载更早」翻页（列表长度+1、首轮身份变化）；When prepend 落地后任意 turns 提交；Then 不发生贴底滚动（上拉读历史不被弹回最新轮，既有行为保持）
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-follow-insert/requirements.md#FR-05
最近确认：b9f3550f3e859a50537ab6745b5d7f2ec0b0ff06

## FR-auto-frontend-235 被动增高（scrollHeight 增长且 scrollTop 未减少）不改变贴底判定——handleScroll 跳过 near 清零与新消息计数锚设置，仅更新基线
变更：2026-10-14-session-bottom-passive-grow
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-passive-grow/requirements.md#FR-01
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652

## FR-auto-frontend-236 用户真实上滚（scrollTop 减少）照常清贴底判定（读历史不被拉底，既有行为不变）
变更：2026-10-14-session-bottom-passive-grow
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-passive-grow/requirements.md#FR-02
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-passive-grow:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-passive-grow
  status: active

## FR-auto-frontend-237 真实上滚后的内容增长（读历史时后台预取插入）不恢复贴底（near 保持 false）
变更：2026-10-14-session-bottom-passive-grow
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-passive-grow/requirements.md#FR-03
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-passive-grow:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | frontend/src/components/daemon/__tests__/session-panel-load-earlier-full-turn.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-passive-grow
  status: active

## FR-auto-frontend-238 连续 3 次冷加载全部落底（导航 active=末轮=视口末轮），真浏览器实测
变更：2026-10-14-session-bottom-passive-grow
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-passive-grow/requirements.md#FR-04
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652

## FR-auto-frontend-239 贴底/翻页/跳转/preview 测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-passive-grow
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-passive-grow/requirements.md#FR-05
最近确认：97ac876340cce7dfb62e36a3a316d7da5a290652

## FR-auto-frontend-240 TurnTimeline 挂载点带 key=会话标识——切换会话时组件重挂载，全部滚动判定/基线/状态归零（初始贴底语义恢复）
变更：2026-10-14-session-bottom-switch-remount
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-switch-remount/requirements.md#FR-01
最近确认：d3ece657c9e2186a5fd27ffd727561afb4cda3ac

## FR-auto-frontend-241 整页加载路径行为不变（重挂载对冷加载无差异）
变更：2026-10-14-session-bottom-switch-remount
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-switch-remount/requirements.md#FR-02
最近确认：d3ece657c9e2186a5fd27ffd727561afb4cda3ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-switch-remount:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-switch-remount
  status: active

## FR-auto-frontend-242 切换会话后落底：上滚会话 A → 切换到长会话 → 落底（真浏览器实测 3/3）
变更：2026-10-14-session-bottom-switch-remount
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-switch-remount/requirements.md#FR-03
最近确认：d3ece657c9e2186a5fd27ffd727561afb4cda3ac

## FR-auto-frontend-243 既有测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-switch-remount
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-switch-remount/requirements.md#FR-04
最近确认：d3ece657c9e2186a5fd27ffd727561afb4cda3ac

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-switch-remount:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-switch-remount
  status: active

## FR-auto-frontend-244 ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-01
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

## FR-auto-frontend-245 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-02
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-resize-observer:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-resize-observer
  status: active

## FR-auto-frontend-246 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-03
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

## FR-auto-frontend-247 rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-04
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

## FR-auto-frontend-248 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-05
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

## FR-auto-frontend-249 既有测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-resize-observer
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-resize-observer/requirements.md#FR-06
最近确认：b615f2f92d33a1089b4b5ffffeb8ce6853fdd8b2

## FR-auto-frontend-250 会话时间线挂载期间 history.scrollRestoration='manual'（禁浏览器恢复），卸载还原 'auto'——刷新后不恢复上次容器滚动位置，由贴底链统一落底
变更：2026-10-14-session-bottom-no-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-no-restore/requirements.md#FR-01
最近确认：812678ebe2b78513d1a1cd7c48511354eedff88c

## FR-auto-frontend-251 刷新（任意上次停留位置）后落底 delta=0（程序性滚顶/滚中后刷新均验证）
变更：2026-10-14-session-bottom-no-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-no-restore/requirements.md#FR-02
最近确认：812678ebe2b78513d1a1cd7c48511354eedff88c

## FR-auto-frontend-252 切换会话/上滚读历史/跳转/翻页既有行为不变
变更：2026-10-14-session-bottom-no-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-no-restore/requirements.md#FR-03
最近确认：812678ebe2b78513d1a1cd7c48511354eedff88c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-no-restore:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-no-restore
  status: active

## FR-auto-frontend-253 既有测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-no-restore
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-no-restore/requirements.md#FR-04
最近确认：812678ebe2b78513d1a1cd7c48511354eedff88c

## FR-auto-frontend-254 RO 钉底条件扩为 isNearBottomRef ||（距最近贴底 <10s 且无用户输入）——加载期 near 被误清后宽限窗内自动钉底
变更：2026-10-14-session-bottom-grace-window
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-grace-window/requirements.md#FR-01
最近确认：82b966f8f85f16b2318e56541359a0c067783802

## FR-auto-frontend-255 用户真实滚动（滚轮/触摸/拖动）立即恢复既有让权语义（near=false 后不强拉）
变更：2026-10-14-session-bottom-grace-window
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-grace-window/requirements.md#FR-02
最近确认：82b966f8f85f16b2318e56541359a0c067783802

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-grace-window:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx「用户上滚读历史后，流式更新不再强制拉回底部」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-grace-window
  status: active

## FR-auto-frontend-256 挂载即视为在窗内（初始加载全程受保护），超过 10s 或用户输入后回到既有语义
变更：2026-10-14-session-bottom-grace-window
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-grace-window/requirements.md#FR-03
最近确认：82b966f8f85f16b2318e56541359a0c067783802

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-session-bottom-grace-window:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-session-bottom-grace-window
  status: active

## FR-auto-frontend-257 既有测试面复跑绿 + tsc 0
变更：2026-10-14-session-bottom-grace-window
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-session-bottom-grace-window/requirements.md#FR-04
最近确认：82b966f8f85f16b2318e56541359a0c067783802

## FR-auto-releases-001 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-01
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「行首状态槽语义（2026-10-15-session-status-dot-semantics）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-002 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-02
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「failed → 红点（异常失败）；活性 working 不覆盖（终态权威）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-003 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-03
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「活性未读红角标（原行尾小灯迁入行首槽）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-004 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-04
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-005 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-05
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-05
  tests: frontend/src/app/page.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-releases-006 执行完成通知（用户补充）：非终态→ended 且当前不在该会话上 → 绿色通知角标，点击进入后消失
变更：2026-10-15-session-status-dot-semantics
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-session-status-dot-semantics/requirements.md#FR-06
最近确认：205ec5afb2097446b431f91cccd00ee00744e0ec

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-session-status-dot-semantics:flow:测试绑定FR-06
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「执行完成通知（2026-10-15 用户补充…）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-session-status-dot-semantics
  status: active

## FR-auto-sillyspec-079 切片力场新增同类型内聚力——同类聚簇、异类分块
变更：2026-10-15-graph-type-cluster
状态：active
摘要：交错网格收敛聚簇
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-01
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：交错网格收敛后类内紧+类间分」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-080 内聚力豁免面——单成员类型与 NaN 坐标零受力
变更：2026-10-15-graph-type-cluster
状态：active
摘要：异类两节点与 NaN 自愈不受扰
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-02
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-02
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：单成员类型与 NaN 坐标豁免（既有自愈口径不变）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-081 既有交互与引擎语义不变
变更：2026-10-15-graph-type-cluster
状态：active
摘要：回归面全绿
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-03
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-03
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-auto-sillyspec-082 常量导出与聚簇断言单测
变更：2026-10-15-graph-type-cluster
状态：active
摘要：单测钉死
全文：.sillyspec/changes/archive/2026-10-15-graph-type-cluster/requirements.md#FR-04
最近确认：2fc26800908a29fc957f059032fbaff1678b793b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-graph-type-cluster:flow:测试绑定FR-04
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「类型内聚力：增益常量具名导出」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-graph-type-cluster
  status: active

## FR-unmapped-707 相关测试通过（不跑全量）
变更：2026-10-10-live-token-speed-daemon-timing
状态：active
摘要：三侧绿
全文：.sillyspec/changes/archive/2026-10-10-live-token-speed-daemon-timing/requirements.md#FR-08
最近确认：b15fafc3b
