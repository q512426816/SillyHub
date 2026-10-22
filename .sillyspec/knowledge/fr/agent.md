---
author: sillyspec-fr-index
created_at: 2026-10-14T02:51:35.432Z
---

# FR 索引 — agent

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/agent.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-backend-219 平台预置「SillySpec 极速变更」档案定义
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-01
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_plants_platform_profile_with_identity_fields」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-220 幂等补种
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-02
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_idempotent_on_repeat_calls」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-221 不覆盖用户改动
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-03
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-03
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_does_not_overwrite_user_edits」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-auto-backend-222 启动序列挂载
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-04
最近确认：534cef161623ee81046dd08d697300c005071294

## FR-auto-backend-223 测试契约
变更：2026-10-14-agent-profile-express-preset
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-agent-profile-express-preset/requirements.md#FR-05
最近确认：534cef161623ee81046dd08d697300c005071294

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-agent-profile-express-preset:flow:测试绑定FR-05
  tests: backend/app/modules/agent/tests/test_profile_seed.py「test_express_preset_coexists_with_system_defaults」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-agent-profile-express-preset
  status: active

## FR-agent-001 92 条全部迁出伪域（tests --redomain --write 逐批，ID 不变），digest 伪域信号归零
变更：2026-10-15-pseudo-domain-migration
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-pseudo-domain-migration/requirements.md#FR-01
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410

## FR-agent-002 7 个 auto-*.md 删空壳，INDEX 路由无 auto-* 残留
变更：2026-10-15-pseudo-domain-migration
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-pseudo-domain-migration/requirements.md#FR-02
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410

## FR-agent-003 knowledge validate 全绿（锚点/注册/幽灵零新增）
变更：2026-10-15-pseudo-domain-migration
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-pseudo-domain-migration/requirements.md#FR-03
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410

## FR-agent-004 决策面 442 段清偿（工具 2026-10-15-decision-redomain）：436 条迁出+数据修复+unmapped 空壳删除
变更：2026-10-15-pseudo-domain-migration
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-15-pseudo-domain-migration/requirements.md#FR-04
最近确认：4b034a03ce257a51d95c741e3ead072ed6427410

## FR-agent-005 工作区上下文（分组/scope 带 workspaceId 且当前用户对该工作区有绑定机器）触发新建：浮层不再出现「① 机器（仅在线）」步骤，直接列出绑定机器上的在线智能体（claude/codex/pi/cursor）
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：工作区组头＋直接选智能体；移动端 FAB
场景正文：
- 场景：工作区组头＋直接选智能体 — Given 当前用户对工作区 W 绑定机器 M（`workspace_member_runtimes.daemon_id = M.id`），M 在线且 runtimes 含；When 用户在工作区 W 的分组上点「＋」；Then 浮层无「① 机器（仅在线）」文案与机器卡，直接显示「智能体 · M 名（工作区绑定机器）」与 claude/codex 选项；点选即 `onPick(runti
- 场景：移动端 FAB — Given 移动工作区会话页 `/m/workspaces/<W>/sessions`，用户对 W 有绑定机器 M；When 点 FAB「新建会话」；Then 贴底抽屉直接呈现 M 上的智能体列表（无机器步）；选完进入预会话视图
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-01
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-01
  tests: frontend/src/components/floating/floating-session-host.test.tsx「工作区组「＋」 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「绑定机器在线：无「① 机器」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「workspace 组「＋」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-006 绑定机器离线或不可见时：浮层给出明确空态文案（绑定机器离线/不可用，去工作区页重绑），不落回全机器列表
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：绑定机器离线；绑定机器不可见
场景正文：
- 场景：绑定机器离线 — Given 工作区 W 绑定机器 M（M 在候选列表但 offline）；When 打开工作区 W 的新建浮层；Then 显示离线空态文案，无智能体选项、无机器列表
- 场景：绑定机器不可见 — Given 工作区 W 的 binding.daemon_id 指向的机器不在机器候选中；When 打开浮层；Then 显示「当前不可用…重新绑定机器」空态，不落两步机器列表
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-02
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「绑定机器离线：离线空态文案，不落机器列表也不列智能体」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「绑定机器离线 → 浮层离线空态（不落全机器列表，不弹机器步）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-007 工作区无可解析绑定时保持原两步流程；「非工作区」分组保持原两步流程（零回归）
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：无绑定回退；非工作区组
场景正文：
- 场景：无绑定回退 — Given 门户 `fetchMyBindings` 返回空集；When 工作区分组「＋」→ 浮层；Then 先列在线机器（原两步）；后续步骤与既有用例断言一致
- 场景：非工作区组 — Given 全局门户「非工作区」分组（workspaceId=null）；When 点组头「＋」；Then 原两步流程（机器步不可跳过）
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-03
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-03
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx「零回归：无绑定（fetchMyBinding null）→ boundMachineId 为 null（原两步流程）」 | frontend/src/components/floating/floating-session-host.test.tsx「零回归：工作区组「＋」 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「boundMachineId=null：保持原两步流程（缺省不传由既有用例守护）」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「零回归：无绑定（bindings 空集）时 workspace 组「＋」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-008 列表两层筛选已选智能体时，工作区分组「＋」在绑定机器上命中该引擎则直带上下文进预会话（机器取绑定机器，不再取筛选机器）
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：筛选 codex + 绑定机器在线
场景正文：
- 场景：筛选 codex + 绑定机器在线 — Given 组头＋时 filter={machineId: 其他机器, agent: "codex"}，工作区 W 绑定机器 M 上 codex 在线；When 点「＋」；Then 不弹浮层，preContext.runtimeId = M 上的 codex runtime，workspaceId=W
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-04
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-04
  tests: frontend/src/components/floating/floating-session-host.test.tsx「组「＋」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「筛选 agent=Codex（机器筛的是另一台）+ 绑定机器该引擎在线 → 直带：runtime 取绑定机器（不取筛选机器）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-009 ?new=1 直达（workspace/change/quicklog scope）改为解析绑定机器上的默认智能体（优先 claude、其次 codex），未命中自动弹只选智能体的浮层兜底
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：绑定机器直进；绑定机器无在线 claude/codex
场景正文：
- 场景：绑定机器直进 — Given workspace scope + ?new=1，绑定机器 M 上 claude 在线；When 门户挂载解析完成；Then 直接预会话态（runtimeId=M 的 claude），不弹浮层
- 场景：绑定机器无在线 claude/codex — Given 绑定机器 M 在线但仅 pi 在线（或 M 离线）；When ?new=1 解析；Then 弹浮层且为绑定模式（直接智能体步/离线空态）
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-05
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-05
  tests: frontend/src/components/floating/floating-session-host.test.tsx「工作区页「＋ 新会话」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「?new=1（workspace scope）+ 绑定命中 → 绑定优先于 D-005（localStorage 指向另一台仍直进绑定机器）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-010 移动端工作区会话页（含 FAB 与空态入口）同样跳过机器选择
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：FAB（同 FR-01 移动场景，见上）
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-06
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-06
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx「FAB（有绑定 ws-1→m-1）→ 贴底抽屉绑定模式：boundMachineId 透出（不弹机器步）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-011 相关 vitest 用例通过（pre-session-picker / sessions-portal / floating-session-host / 移动会话页），frontend typecheck 通过
变更：2026-10-15-workspace-session-agent-only
状态：active
摘要：测试与类型守门
场景正文：
- 场景：测试与类型守门 — Given 本次改动落盘；When 运行 `pnpm -C frontend exec vitest run <四个测试文件>` 与 `pnpm -C frontend typecheck`；Then 全部通过、零红
全文：.sillyspec/changes/archive/2026-10-15-workspace-session-agent-only/requirements.md#FR-07
最近确认：add1712b21ebc572ce84ff4e2436ed07500aba54

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-workspace-session-agent-only:flow:测试绑定FR-07
  tests: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-workspace-session-agent-only
  status: active

## FR-agent-012 backend/app/modules/agent/tests/test_agent_session_model.py 期望字段集补 title_fallback（含来源注释），字段数断言 34→35
变更：2026-10-16-agent-session-field-pin-sync
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given AgentSession 模型（含 title_fallback 列，共 35 字段）；When 运行 `test_agent_session_has_all_35_fields`；Then 断言通过，missing/extra 均为空集
全文：.sillyspec/changes/archive/2026-10-16-agent-session-field-pin-sync/requirements.md#FR-01
最近确认：cd5c6760fd82584b7b25b8e8d89947f6360a55b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-agent-session-field-pin-sync:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_agent_session_model.py「test_agent_session_has_all_35_fields」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-agent-session-field-pin-sync
  status: active

## FR-agent-013 该测试单跑通过；删除 .sillyspec/local.yaml 中 '^E\s+AssertionError: AgentSession field mismatch' 豁免行后质量扫描不再依赖豁免
变更：2026-10-16-agent-session-field-pin-sync
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given local.yaml 已删除 `^E\s+AssertionError: AgentSession field mismatch` 豁免行；When 运行 `uv run pytest app/modules/agent/tests/test_agent_session_model.py -q`；Then 12 passed、0 failed
全文：.sillyspec/changes/archive/2026-10-16-agent-session-field-pin-sync/requirements.md#FR-02
最近确认：cd5c6760fd82584b7b25b8e8d89947f6360a55b6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-agent-session-field-pin-sync:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_agent_session_model.py「test_agent_session_has_all_35_fields」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-agent-session-field-pin-sync
  status: active

## FR-agent-014 不改任何模型/业务代码，仅测试与配置
变更：2026-10-16-agent-session-field-pin-sync
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本变更交付完成；When 核对 git diff；Then 变更仅含 `backend/app/modules/agent/tests/test_agent_session_model.py` 一个文件（local.ya
全文：.sillyspec/changes/archive/2026-10-16-agent-session-field-pin-sync/requirements.md#FR-03
最近确认：cd5c6760fd82584b7b25b8e8d89947f6360a55b6

## FR-agent-015 后端在上述 run 状态迁移点补发 publish_sessions_changed（复用既有哑信号链路，Redis 抖动静默容错不拖挂业务写路径）
变更：2026-10-20-session-status-live-sync
状态：active
摘要：发消息后左侧立即转圈；等待审批即时可见；审批通过恢复执行；run 激活不发假信号
全文：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/requirements.md#FR-01
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-status-live-sync:flow:测试绑定FR-01
  tests: backend/app/modules/agent/tests/test_coordinator_approval_signal.py「request_approval/approve 成功发布、拒绝路径不发布」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-status-live-sync
  status: active

## FR-agent-016 前端收到信号后经既有 400ms 去抖失效列表查询，左侧状态标签在 run 状态迁移后秒级（≤2s）更新，与右侧会话状态一致，不再依赖轮询 tick
变更：2026-10-20-session-status-live-sync
状态：active
摘要：审批弹框与左侧徽标同步
全文：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/requirements.md#FR-02
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-status-live-sync:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-approval-list-refresh.test.tsx「permission_request 触发 onSessionListRefresh」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-status-live-sync
  status: active

## FR-agent-017 多轮会话 run 完成（会话保持 active）时左侧转圈徽标同样秒级收敛
变更：2026-10-20-session-status-live-sync
状态：active
摘要：多轮完成转圈收敛
全文：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/requirements.md#FR-03
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-status-live-sync:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py「多轮 keep-active 终态发布列表信号（扩展既有用例断言）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-status-live-sync
  status: active

## FR-agent-018 既有信号点（会话创建/终态/删除/群聊 audience）行为零回归
变更：2026-10-20-session-status-live-sync
状态：active
摘要：既有回归面
全文：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/requirements.md#FR-04
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-session-status-live-sync:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py「既有终态翻转发布用例回归全绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-session-status-live-sync
  status: active

## FR-agent-019 新增信号点有单测覆盖；触及的前后端测试全绿
变更：2026-10-20-session-status-live-sync
状态：active
摘要：守卫路径不发布
全文：.sillyspec/changes/archive/2026-10-20-session-status-live-sync/requirements.md#FR-05
最近确认：59007127f0d130be7ea5e131f4f61154806d37a0

## FR-agent-020 档案表单仅 名称/可见范围/系统提示词/技能勾选 四项，无工作区上下文/引擎/模型/供应商/工具策略/MCP 字段，右栏预览同步
变更：2026-10-21-agent-profile-slim-default
状态：active
摘要：新建瘦身表单；编辑存量档案
全文：.sillyspec/changes/archive/2026-10-21-agent-profile-slim-default/requirements.md#FR-01
最近确认：9458a48db2d349cf18861d098796265ca018fe31

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-agent-profile-slim-default:flow:测试绑定FR-01
  tests: frontend/src/components/__tests__/agent-profile-form.test.tsx「新建无需选工作区上下文」 | frontend/src/components/__tests__/agent-profile-form.test.tsx「编辑存量档案保存清空被删引用」 | frontend/src/components/__tests__/agent-profile-form.test.tsx「表单仅渲染四字段」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-agent-profile-slim-default
  status: active

## FR-agent-021 档案卡片有「设为默认」操作与默认标记，每用户至多一个默认档案
变更：2026-10-21-agent-profile-slim-default
状态：active
摘要：设默认与互斥；默认档案被删
全文：.sillyspec/changes/archive/2026-10-21-agent-profile-slim-default/requirements.md#FR-02
最近确认：9458a48db2d349cf18861d098796265ca018fe31

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-agent-profile-slim-default:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_profile_router.py「set-default/unset-default 端点与互斥」 | frontend/src/components/agent-profile/__tests__/agent-profile-card.test.tsx「设为默认操作与默认标记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-agent-profile-slim-default
  status: active

## FR-agent-022 创建会话与群聊成员未显式选档案时注入用户默认档案（人格+技能）；未设默认行为与现状逐字节一致
变更：2026-10-21-agent-profile-slim-default
状态：active
摘要：会话默认注入；无默认零回归；群聊成员默认注入
全文：.sillyspec/changes/archive/2026-10-21-agent-profile-slim-default/requirements.md#FR-03
最近确认：9458a48db2d349cf18861d098796265ca018fe31

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-agent-profile-slim-default:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_group_default_profile.py「影子会话群主默认注入/无默认保持 None」 | backend/app/modules/daemon/tests/test_session_default_profile.py「默认注入/无默认零回归/失可见回落」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-agent-profile-slim-default
  status: active

## FR-agent-023 选档案会话只挂档案技能子集，档案技能为空则不挂任何技能；未选档案且无默认时技能全量挂载（现状）
变更：2026-10-21-agent-profile-slim-default
状态：active
摘要：空技能档案清空挂载；旧 lease 兼容
全文：.sillyspec/changes/archive/2026-10-21-agent-profile-slim-default/requirements.md#FR-04
最近确认：9458a48db2d349cf18861d098796265ca018fe31

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-21-agent-profile-slim-default:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/task-runner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-21-agent-profile-slim-default
  status: active

## FR-agent-024 既有档案数据不迁移不删列，被删字段读侧忽略；后端 llm_provider/claim 注入链零触碰
变更：2026-10-21-agent-profile-slim-default
状态：active
摘要：读侧忽略
全文：.sillyspec/changes/archive/2026-10-21-agent-profile-slim-default/requirements.md#FR-05
最近确认：9458a48db2d349cf18861d098796265ca018fe31
