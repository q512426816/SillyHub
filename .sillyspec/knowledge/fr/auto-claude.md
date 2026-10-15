---
author: sillyspec-fr-index
created_at: 2026-10-08T17:53:22.647Z
---

# FR 索引 — auto-claude

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-claude-001 onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：Git Bash 下字体恢复不再中断
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-01
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-002 .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：三副本一致
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-02
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-003 shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：最小改动面
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-03
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

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
