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

## FR-agent-025 tests/core/test_error_message_l10n.py 全参数化用例绿（vector_router/session_attachment 两 offender 清零）
变更：2026-10-22-merge-test-debt
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-22-merge-test-debt/requirements.md#FR-01
最近确认：457db3f86efa272c64aeacd06333aa538f3636ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-merge-test-debt:flow:测试绑定FR-01
  tests: backend/tests/core/test_error_message_l10n.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-merge-test-debt
  status: active

## FR-agent-026 test_mission_session_id::test_agent_sessions_model_fields_unchanged 绿（expected 补 title_fallback）
变更：2026-10-22-merge-test-debt
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given AgentSession 含 28 字段（含 title_fallback）/ When 跑字段钉子用例 / Then 集合相等断言通过。
全文：.sillyspec/changes/archive/2026-10-22-merge-test-debt/requirements.md#FR-02
最近确认：457db3f86efa272c64aeacd06333aa538f3636ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-merge-test-debt:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_mission_session_id.py「test_agent_sessions_model_fields_unchanged」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-merge-test-debt
  status: active

## FR-agent-027 sillyhub-daemon tests/adapters/json-rpc.test.ts 60/60 绿（clientInfo.version 改与 DAEMON_VERSION 同源断言）
变更：2026-10-22-merge-test-debt
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given package.json version=0.2.0 / When 跑 json-rpc.test.ts / Then 握手用例随 DAEMON_VERSION
全文：.sillyspec/changes/archive/2026-10-22-merge-test-debt/requirements.md#FR-03
最近确认：457db3f86efa272c64aeacd06333aa538f3636ea

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-merge-test-debt:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/adapters/json-rpc.test.ts「buildHandshake - codex 协议握手序列（ql-20260617-008）> 返回 3 行 JSON-RPC 消息（initialize/initialized/thread.start）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-merge-test-debt
  status: active

## FR-agent-028 四处修复均为守卫/文案同步，无业务逻辑变更
变更：2026-10-22-merge-test-debt
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given diff 面 = 2 个 backend 文案文件 + 2 个测试文件 / When 逐 hunk 核对 / Then 无逻辑行变更（仅文案字符串与断言/清单/
全文：.sillyspec/changes/archive/2026-10-22-merge-test-debt/requirements.md#FR-04
最近确认：457db3f86efa272c64aeacd06333aa538f3636ea

## FR-agent-029 删除 change（含 reparse 物理删行）不再删除任何 agent_runs/agent_run_logs，run.change_id 变为 NULL
变更：2026-10-22-change-delete-session-history-fix
状态：active
摘要：reparse 删除磁盘消失的 change；墓碑行与非候选行零动作；change-writer 占坑回滚
全文：.sillyspec/changes/archive/2026-10-22-change-delete-session-history-fix/requirements.md#FR-01
最近确认：a0af14684ac4433ef87f97e4f33906c9e5e9f6f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-change-delete-session-history-fix:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_reparse_delete_preserves_runs.py「reparse 物理删 change 时保留锚定 run 与日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-change-delete-session-history-fix
  status: active

## FR-agent-030 模型与外键迁移一致（SET NULL），并有删除 change 后 run/日志保留的回归测试
变更：2026-10-22-change-delete-session-history-fix
状态：active
摘要：模型与库一致；数据库级删除不带走 run
全文：.sillyspec/changes/archive/2026-10-22-change-delete-session-history-fix/requirements.md#FR-02
最近确认：a0af14684ac4433ef87f97e4f33906c9e5e9f6f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-change-delete-session-history-fix:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_agent_run_change_fk.py「AgentRun.change_id 外键为 SET NULL」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-change-delete-session-history-fix
  status: active

## FR-agent-031 bbdbecc9 会话从导出的 JSONL 回灌 13 轮后，时间线与左栏 turn_count（59）一致
变更：2026-10-22-change-delete-session-history-fix
状态：active
摘要：dry-run 零写入；apply 后会话完整；重复执行幂等
全文：.sillyspec/changes/archive/2026-10-22-change-delete-session-history-fix/requirements.md#FR-03
最近确认：a0af14684ac4433ef87f97e4f33906c9e5e9f6f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-change-delete-session-history-fix:flow:测试绑定FR-03
  tests: backend/tests/test_restore_lost_session_turns.py「JSONL 按 turn_id 映射为 run/log 且重复执行幂等」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-change-delete-session-history-fix
  status: active

## FR-agent-032 turn_count 与实际 run 数的漂移有对账/修复路径，不再出现计数虚高
变更：2026-10-22-change-delete-session-history-fix
状态：active
摘要：虚高下调；tool_report 零语义保留
全文：.sillyspec/changes/archive/2026-10-22-change-delete-session-history-fix/requirements.md#FR-04
最近确认：a0af14684ac4433ef87f97e4f33906c9e5e9f6f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-22-change-delete-session-history-fix:flow:测试绑定FR-04
  tests: backend/tests/test_restore_lost_session_turns.py「turn_count 对账仅下调虚高、保留 tool_report 零语义」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-22-change-delete-session-history-fix
  status: active

## FR-agent-033 折叠头双段标题：本轮AGENT 段（tool 归因计数与行级合计）+ 总共段（全部文件计数与合计），共享工作区提示保持
变更：2026-10-23-file-card-agent-grouping
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-file-card-agent-grouping/requirements.md#FR-01
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-file-card-agent-grouping:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「折叠头双段标题：本轮AGENT 段 + 总共段 + 行级合计」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-file-card-agent-grouping
  status: active

## FR-agent-034 展开区默认只列 agent 编辑行；命令行/其他变更收进按钮行，点击展开该区段
变更：2026-10-23-file-card-agent-grouping
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-file-card-agent-grouping/requirements.md#FR-02
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-file-card-agent-grouping:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx「展开区默认只列 agent 行，命令行/其他收进按钮展开」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-file-card-agent-grouping
  status: active

## FR-agent-035 已删除文件行可点击，弹窗展示补丁或如实说明删除无补丁
变更：2026-10-23-file-card-agent-grouping
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-file-card-agent-grouping/requirements.md#FR-03
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-file-card-agent-grouping:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx「已删除文件行可点击并弹窗如实说明（FR-03）」 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「删除文件无补丁时如实说明删除」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-file-card-agent-grouping
  status: active

## FR-agent-036 无补丁弹窗说明改为如实表述，不再断言唯一原因；有补丁时副标题才提 agent 编辑日志
变更：2026-10-23-file-card-agent-grouping
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-file-card-agent-grouping/requirements.md#FR-04
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-file-card-agent-grouping:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁说明如实表述不断言唯一原因」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-file-card-agent-grouping
  status: active

## FR-agent-037 既有 notice/degraded/破折号语义不回归，触及面测试绿
变更：2026-10-23-file-card-agent-grouping
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-file-card-agent-grouping/requirements.md#FR-05
最近确认：0ea7bf0d129c6dfba9a04915c83c36329bbfbbfd

## FR-agent-038 点击/回车发送后输入框文本立即清空，不等网络响应
变更：2026-10-23-session-input-clear-fix
状态：active
摘要：真会话直发立即清空；忙轮排队同样立即清空；群聊发送立即清空
全文：.sillyspec/changes/archive/2026-10-23-session-input-clear-fix/requirements.md#FR-01
最近确认：f4cceafeb72c4b28c56c69a96d4d642f2b5b87e0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-input-clear-fix:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「发送受理即清输入框文本（FR-01）」 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「发送受理即清：sendGroupMessage 未响应时输入框已空且草稿键已清」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-input-clear-fix
  status: active

## FR-agent-039 发送失败（网络错误/后端拒绝）时输入文本恢复到输入框可重试，附件 chips 全程保留
变更：2026-10-23-session-input-clear-fix
状态：active
摘要：直发失败恢复；预会话首句创建失败恢复
全文：.sillyspec/changes/archive/2026-10-23-session-input-clear-fix/requirements.md#FR-02
最近确认：f4cceafeb72c4b28c56c69a96d4d642f2b5b87e0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-input-clear-fix:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「发送失败恢复文本（FR-02）」 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「发送失败：文本恢复到输入框可重试」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-input-clear-fix
  status: active

## FR-agent-040 发送受理即同步清 localStorage 草稿键（含预会话 __pre__:scope 键），切换会话/组件卸载后草稿不残留已发送内容
变更：2026-10-23-session-input-clear-fix
状态：active
摘要：预会话发送成功后草稿键不残留；真会话发送在途切换后切回不残留
全文：.sillyspec/changes/archive/2026-10-23-session-input-clear-fix/requirements.md#FR-03
最近确认：f4cceafeb72c4b28c56c69a96d4d642f2b5b87e0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-input-clear-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「受理即同步清草稿键（FR-03）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-input-clear-fix
  status: active

## FR-agent-041 新建会话（预会话态）输入框恒空白：不回读旧草稿，且每次重新进入预会话（同机器同引擎）输入框重置
变更：2026-10-23-session-input-clear-fix
状态：active
摘要：填写未发送后重新新建为空白；真会话草稿不回归
全文：.sillyspec/changes/archive/2026-10-23-session-input-clear-fix/requirements.md#FR-04
最近确认：f4cceafeb72c4b28c56c69a96d4d642f2b5b87e0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-input-clear-fix:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 真会话草稿切换时序（R-01 基线锁定）」 | frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx「page 预会话草稿入口隔离（task-01 / D-001）> 同一入口重进：输入框恒空白」 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「同机器同智能体再次「＋」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-input-clear-fix
  status: active

## FR-agent-042 首屏加载后，窗口最旧行所在轮若被窗口截断，自动补拉该轮全量日志并装配，保证该轮 prompt 用户消息气泡在场
变更：2026-10-23-session-first-window-turn-align
状态：active
摘要：单轮超窗口全量显示；多轮会话自适应覆盖最近 2 轮
场景正文：
- 场景：单轮超窗口全量显示 — Given 会话整场仅 1 轮、日志 546 条，首屏窗口 400 条（生产会话 f815989f 实证）；When 用户重新进入会话；Then 该轮 546 条全部装配，轮首 user_input（用户提问）与后续回复均可见，无需点击「加载更早消息」
- 场景：多轮会话自适应覆盖最近 2 轮 — Given 会话 8 轮，最新轮 696 条日志，窗口起点落在最新轮中段；When 首屏加载；Then 补全最新轮并向前覆盖到上一完整轮，首屏至少显示最近 2 个完整轮次，最近一次用户发言可见
全文：.sillyspec/changes/archive/2026-10-23-session-first-window-turn-align/requirements.md#FR-01
最近确认：780bda6099858d50f9908ea6d9e308c2eb46b8ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-window-turn-align:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「多轮窗口起点截断 → 补全该轮并向前覆盖最近 2 轮（FR-01）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-window-turn-align
  status: active

## FR-agent-043 已完整落在窗口内的轮次装配结果不变，零回归
变更：2026-10-23-session-first-window-turn-align
状态：active
摘要：窗口已满足自适应条件
场景正文：
- 场景：窗口已满足自适应条件 — Given 首屏窗口起点轮完整且起点轮已是会话第一轮；When 首屏加载完成；Then 不发起任何 `{ runId }` 直达拉取，turns 与改动前一致
全文：.sillyspec/changes/archive/2026-10-23-session-first-window-turn-align/requirements.md#FR-02
最近确认：780bda6099858d50f9908ea6d9e308c2eb46b8ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-window-turn-align:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/session-panel/__tests__/initial-window.test.ts「向前补拉受轮数上限约束 → 只并行拉最近 maxRuns 个更早轮（评审 P2 请求量）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-window-turn-align
  status: active

## FR-agent-044 直达拉取存在上限截断时按既有 okRuns 采纳闸降级，不静默丢窗口段最新内容
变更：2026-10-23-session-first-window-turn-align
状态：active
摘要：直达截断安全降级
场景正文：
- 场景：直达截断安全降级 — Given 某轮直达返回行数达到 2000 条上限；When 首屏自适应补拉执行；Then 该轮不采纳并整体回退底窗装配（不合并、无中段缺口），更早轮停止补拉且 hasEarlier 保持为真，可由「加载更早消息」继续
全文：.sillyspec/changes/archive/2026-10-23-session-first-window-turn-align/requirements.md#FR-03
最近确认：780bda6099858d50f9908ea6d9e308c2eb46b8ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-session-first-window-turn-align:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「满页（400 条）→ 触顶自动加载更早 prepend + 加载提示；到头后触顶不再请求」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-session-first-window-turn-align
  status: active

## FR-agent-045 相关 vitest 全绿，tsc 零错
变更：2026-10-23-session-first-window-turn-align
状态：active
摘要：质量门
场景正文：
- 场景：质量门 — Given 变更完成；When 执行相关 vitest 与 tsc；Then 全部通过且零类型错误
全文：.sillyspec/changes/archive/2026-10-23-session-first-window-turn-align/requirements.md#FR-04
最近确认：780bda6099858d50f9908ea6d9e308c2eb46b8ab

## FR-agent-046 三类系统注入消息在数据层携带 turn_trigger 来源标记
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径；Worker 派发；后台通知
依据决策：D-009@v1
场景正文：
- 场景：主路径 — Given 会话存在活跃 mission 且用户发送首句（或续问）触发主控简报拼接；When 该轮 user_input 落库；Then `metadata_.turn_t
- 场景：Worker 派发 — Given 团队派发 Worker run；When 其会话首条 user_input 落库；Then `metadata_.turn_trigger === "worke
- 场景：后台通知 — Given 后台任务收敛触发 workers-done / child-wake 注入；When `inject_session_as_service` 落库；Then `
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-01
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

## FR-agent-047 daemon 在轮边界上报配置面请求头快照（仅 initial / change）
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径；无变化
依据决策：D-002@v1、D-010@v1
场景正文：
- 场景：主路径 — Given 新会话首轮；When driver 启动完成；Then 落一条 `channel=session_header` 日志（reason=initial）。Give
- 场景：无变化 — Given 连续多轮快照相同；When 轮边界比较；Then 不新增日志。
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-02
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

## FR-agent-048 前端按标记装配轨迹行
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径
依据决策：D-011@v1
场景正文：
- 场景：主路径 — Given 轮含 turn_trigger=team_brief 的消息；When 打开轨迹；Then 该消息行为「上下文」标签（团队派发形态）。Given 会话第二条 s
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-03
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-trajectory-source-model:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-trajectory-source-model
  status: active

## FR-agent-049 submit_steps metadata 通用透传（白名单键集）
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given daemon 提交带 `{channel: "session_header", metadata: {reason: "initial"}}` 的日志；When
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-04
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

## FR-agent-050 revert 前端启发式代码
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径
依据决策：D-004@v1
场景正文：
- 场景：主路径 — Given 存量会话的团队派发轮（无戳）；When 打开轨迹；Then 显示「用户」行（如实呈现，无启发式识别）。
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-05
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-25-trajectory-source-model:flow:测试绑定FR-05
  tests: frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-25-trajectory-source-model
  status: active

## FR-agent-051 兼容与回归
变更：2026-10-25-trajectory-source-model
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更落盘；When 跑三端相关测试与类型检查；Then 全部通过。
全文：.sillyspec/changes/archive/2026-10-25-trajectory-source-model/requirements.md#FR-06
最近确认：024af1a9d8d16d48a68fa1dfe07103c16afd049c

## FR-agent-052 backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed
变更：2026-10-28-knowledge-hits-cli-direct
状态：active
摘要：shpsync_ 直报落库；无工作区归属令牌
全文：.sillyspec/changes/archive/2026-10-28-knowledge-hits-cli-direct/requirements.md#FR-01
最近确认：21104e0be0f0336e046643a4253d49a138840e52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-knowledge-hits-cli-direct:flow:测试绑定FR-01
  tests: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「无工作区归属令牌 403 fail-closed」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-knowledge-hits-cli-direct
  status: active

## FR-agent-053 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）
变更：2026-10-28-knowledge-hits-cli-direct
状态：active
摘要：CLI 通道标识
全文：.sillyspec/changes/archive/2026-10-28-knowledge-hits-cli-direct/requirements.md#FR-02
最近确认：21104e0be0f0336e046643a4253d49a138840e52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-knowledge-hits-cli-direct:flow:测试绑定FR-02
  tests: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「daemon_local_id 通道标识原样落库」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-knowledge-hits-cli-direct
  status: active

## FR-agent-054 daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）
变更：2026-10-28-knowledge-hits-cli-direct
状态：active
摘要：双通道行同源
全文：.sillyspec/changes/archive/2026-10-28-knowledge-hits-cli-direct/requirements.md#FR-03
最近确认：21104e0be0f0336e046643a4253d49a138840e52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-knowledge-hits-cli-direct:flow:测试绑定FR-03
  tests: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「重复行幂等与坏行宽容计数同既有 ingest 语义」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-knowledge-hits-cli-direct
  status: active

## FR-agent-055 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致
变更：2026-10-28-knowledge-hits-cli-direct
状态：active
摘要：收口实测
全文：.sillyspec/changes/archive/2026-10-28-knowledge-hits-cli-direct/requirements.md#FR-04
最近确认：21104e0be0f0336e046643a4253d49a138840e52

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-knowledge-hits-cli-direct:flow:测试绑定FR-04
  tests: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「JWT/shk_live_ 凭据 403（四轨分轨）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-knowledge-hits-cli-direct
  status: active

## FR-agent-056 backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件
变更：2026-10-28-knowledge-hits-cli-direct
状态：active
摘要：schema 变更即再生成
全文：.sillyspec/changes/archive/2026-10-28-knowledge-hits-cli-direct/requirements.md#FR-05
最近确认：21104e0be0f0336e046643a4253d49a138840e52

## FR-agent-057 桌面变更详情概览「会话」区数据源改为 GET /changes/{id}/sessions（change_session_links 真实关联），不再取工作区全量会话
变更：2026-10-28-change-detail-sessions-source-fix
状态：active
摘要：工作区存在与变更无关的活跃会话；变更无任何绑定会话
全文：.sillyspec/changes/archive/2026-10-28-change-detail-sessions-source-fix/requirements.md#FR-01
最近确认：849706364deefb92a01024ae3ea2f72abdc6fde9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-sessions-source-fix:flow:测试绑定FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「仅渲染注入的变更关联会话（slice 前 3）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-sessions-source-fix
  status: active

## FR-agent-058 「绑定会话（审批结果将通知此会话）」显示同一关联源最新会话，与后端 _notify_bound_session 注入目标同源
变更：2026-10-28-change-detail-sessions-source-fix
状态：active
摘要：审批时绑定会话展示
全文：.sillyspec/changes/archive/2026-10-28-change-detail-sessions-source-fix/requirements.md#FR-02
最近确认：849706364deefb92a01024ae3ea2f72abdc6fde9

## FR-agent-059 会话区状态列显示中文标签（进行中/已结束等），不再裸显英文 active/completed
变更：2026-10-28-change-detail-sessions-source-fix
状态：active
摘要：active 会话显示中文
全文：.sillyspec/changes/archive/2026-10-28-change-detail-sessions-source-fix/requirements.md#FR-03
最近确认：849706364deefb92a01024ae3ea2f72abdc6fde9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-sessions-source-fix:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「状态列显示中文标签（active→进行中）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-sessions-source-fix
  status: active

## FR-agent-060 附件开局会话标题剥离 [附件:...] 内联标记，三处标题提取端点口径一致
变更：2026-10-28-change-detail-sessions-source-fix
状态：active
摘要：附件+正文混合首条输入；纯附件首条输入；常规纯文本首条输入
全文：.sillyspec/changes/archive/2026-10-28-change-detail-sessions-source-fix/requirements.md#FR-04
最近确认：849706364deefb92a01024ae3ea2f72abdc6fde9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-change-detail-sessions-source-fix:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_change_sessions_cap.py「附件开局标题剥离」 | backend/app/modules/session_attachment/tests/test_capability.py「session_display_title 剥离附件标记/纯附件回退 name/纯文本零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-change-detail-sessions-source-fix
  status: active
