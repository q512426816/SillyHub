---
author: WhaleFall
created_at: 2026-08-14 14:32:59
scale: large
status: draft
related_changes:
  - 2026-08-13-profile-system-prompt-injection  # 复刻其 system_prompt 注入链路
  - 2026-08-06-provider-switch-live-session     # 复刻其 reload 热切换模式
  - 2026-07-11-unify-runtime-session-dialog     # 受影响的会话对话框组件
---

# 设计文档（Design）— /runtimes 会话关联智能体档案

## 1. 背景

`/runtimes` 页面的交互式会话（quick-chat）界面上现有「智能体提供方 / 智能体模型」两个字段，但经代码核查它们对实际 LLM 调用**几乎不起作用**（"摆设"）：

- 首回合这两个字段会写入 `AgentSession.provider` + `config.model` + lease metadata，但 daemon 真正发起 LLM 调用时，后端 `_inject_provider_config`（`backend/app/modules/daemon/lease/context.py:208-294`）会用用户「我的供应商」里配置的**默认 LlmProvider** 的 `base_url/api_key/model` 注入 `provider_config` 并**覆盖** `payload.model`；daemon 侧 `ANTHROPIC_MODEL` 也取自 `provider_config`（`sillyhub-daemon/src/credential-injector.ts:118-119`）。
- active 态前端把这两个控件禁用（`frontend/src/components/daemon/interactive-session-panel.tsx:1192/1209`），后续 `injectSession` 也只传 prompt（`frontend/src/lib/daemon.ts:671-679`），中途无法改。

与此同时，平台已具备「智能体档案」能力（`agent_profiles` 表，含 `provider/model/system_prompt/llm_provider_id/visibility`，由 `2026-08-03-agent-profile-layer` 引入），且 `change`（变更）选择档案后的 **system_prompt 注入管道已经存在并打通**（`2026-08-13-profile-system-prompt-injection`）：

```
profile.system_prompt → lease.metadata → claim payload → daemon execPayload.systemPrompt
→ SessionManager._buildDriverOptions（preset:claude_code + append）→ claude-sdk-driver options.systemPrompt
```

但 runtime 会话路径 `DaemonSessionService.create_session`（`backend/app/modules/daemon/session/service.py:447`）**从不调用 `_apply_profile_to_lease`、从不写 `system_prompt` 到 lease**（change-driven / mission / stage 路径都调，唯独这条 interactive 路径没接上）。

**本变更要做的事**：把既有的「档案 → lease → daemon → agent」人格注入管道接到 `/runtimes` 会话上。选了档案的会话由档案决定 provider / 凭证 / 模型 / 人格；支持同会话内（turn 边界、同引擎）切换档案且对话历史无缝保留；没选档案完全维持现状。

## 2. 设计目标

- **FR-01** 会话可（单选）一个智能体档案；UI 只保留「智能体档案」一个选择器，引擎与模型不再作为独立字段（引擎由档案隐含决定）。
- **FR-02** 选了档案：provider、凭证、模型、人格提示词由档案决定，复用既有注入管道（`_apply_profile_to_lease`），daemon 基础注入零改动。
- **FR-03** 没选档案：维持现状（默认引擎、默认模型、无人格提示词）。
- **FR-04** 会话进行中（一轮完成后），可在同引擎档案间切换，对话历史无缝保留。
- **FR-05** 档案按会话隔离：每个会话独立持有 `agent_profile_id`，切换只影响当前会话，不同会话可用不同档案。
- **FR-06** 切换仅限同引擎（如 Claude↔Claude）；跨引擎需重开新会话。
- **FR-07** `profile.model` 在档案填了时真正生效（补 `change` 逻辑里 profile.model 不生效的遗留）。

## 3. 非目标

- **NG-01** Codex 引擎的人格提示词注入（第一期仅 Claude；选 Codex 档案时 provider/凭证/模型跟随，但人格不注入）。
- **NG-02** 跨引擎切换（需重开新会话）。
- **NG-03** 档案 `mcp_refs / skill_refs / allowed_roots_overlay` 在 interactive 会话内的**实际生效裁剪**（原 GAP-4/5，本次仅透传字段、不实现裁剪，与现状一致）。
- **NG-04** 批量 / `--print` 模式的 systemPrompt 注入。
- **NG-05** 用户手动输入/选择模型（UI 去掉模型字段，模型一律派生）。

## 4. 拆分判断

- **内聚单变更，不拆**：建会话选档案（注入接线）、daemon 同会话热切换、前端选择/切换三件事围绕同一会话生命周期紧密耦合，拆开会破坏一致性且无独立交付价值。
- **非批量**：无重复模式（不是 N 个相似实例）。
- 按 **Wave** 组织实现顺序（后端接线 → daemon 热切换 → 前端选择切换），Wave 间通过既有 lease/WS 契约解耦。

## 5. 总体方案

核心洞察：**注入管道已存在，本变更主要是"接线 + 加一个热切换开关"**，不是从零构建。

### Wave 1 — 后端：会话接上档案管道（建会话 + 注入）

让 `DaemonSessionService.create_session` / `inject_session` 解析 `agent_profile_id` 并复用 `AgentService._apply_profile_to_lease`：

- `create_session` 入参增加可选 `agent_profile_id`；**不再接收来自 UI 的 `model`**（model 由后端派生）。
- 解析档案：复用 `AgentService._resolve_dispatch_profile`（或等价逻辑）拿到 profile。
- **派生 provider**：`provider = profile.provider or 默认 provider`（既有 D-014：provider 由档案决定）。
- **派生 model**（补遗留，D-004@v2）：`resolved_model = profile.model or workspace.default_model or None`。**profile.model 必须真正生效**：现状 `context.py:270-294` 的覆盖链会让绑定/默认 provider_config.model 绝对覆盖 payload.model（Grill BLOCK-2 证伪了"直接写 resolved_model 就生效"）。方案：写入 lease metadata 时带**显式标记**（如 `model_source: "profile"`），`_inject_provider_config` 见标记则跳过 model 覆盖；未标记（非档案）会话维持原覆盖链，零回归。
- 调 `_apply_profile_to_lease(lease_id, profile)`：把 `system_prompt / llm_provider_id / mcp_refs / skill_refs / effective_allowed_roots / profile_version` 写进 lease metadata（既有逻辑，`backend/app/modules/agent/service.py:638-736`）。
- `AgentSession` 持久化 `agent_profile_id` + `agent_profile_snapshot`（冻结切换时刻档案，防档案被改后历史轮次失真）。
- 下游 `build_claim_payload` 的 `_apply_profile_passthrough`（`lease/context.py:302-333`，已含 `("system_prompt","systemPrompt")`）自动把字段双写进 claim payload → daemon 侧环节（`daemon.ts:3687-3690` 归一化、`session-manager.ts:1142-1148` preset+append）已通，**daemon 零改动即生效人格注入**。

### Wave 2 — daemon：同会话热切换（reloadWithProfile）

复用既有 `reloadWithProvider`（`session-manager.ts:2570 / 2638`）热切换模式，新增档案维度：

- 新增 `reloadWithProfile(sessionId, newProfilePayload)`：turn 边界关旧 query → 用新 `systemPrompt`（+ mcpRefs/skillRefs/effectiveAllowedRoots）重建 driverOpts → `driver.start({ resume: state.agentSessionId })` 从 jsonl 重载完整对话历史 = 保留上下文 + 换人格。
- 新增 `pendingProfileSwitch` 标记，挂在 `_onResult` 切入点（`session-manager.ts:2921-2935`，与既有 `pendingSwitch` 并列）。
- 新增 WS 控制消息 `SESSION_SWITCH_PROFILE`（backend→daemon），**原子承载**切换所需全部字段：新 profile 的 systemPrompt/llm_provider_id/model + **切换轮的 prompt/run_id/claim_token**（D-007@v1，Grill BLOCK-1：v1 草案缺 prompt 投递路径，新 run 会卡 pending；单消息避免"切换+投递"双消息顺序竞态）。
- daemon 双路径处理（复用 `markPendingSwitch` 先例 `session-manager.ts:2576-2581/2928`）：idle 立即 reload 后喂 prompt；running 挂 `pendingProfileSwitch` 至 turn 边界 reload 再喂。
- `reloadWithProfile` 与既有 `reloadWithProvider` **共用同一 reload 内核**（`_reloadSession(sessionId, {systemPrompt?, providerConfig?})`），消息类型分立但逻辑收敛，避免两套并行 reload（Grill C-06）。
- **Codex**：reload 只更新 provider/凭证/模型（`reloadWithProvider` 已支持），人格不注入（既有 D-005：Codex `StartOptions` 无 systemPrompt，TS 编译期隔离）。
- resume 重注入 systemPrompt 的持久化路径已有（`session-manager.ts:2449/2497/2714`），切换后更新 `state.systemPrompt` 即可复用。

### Wave 3 — 前端：会话区加档案选择 + 切换

- 会话对话框建会话区把原「智能体提供方 + 智能体模型」替换为单个 **`AgentProfileSelect`**（复用 `frontend/src/components/agent-profile-select.tsx`）：列出所有可见档案（platform + 个人 private + 当前 workspace），每条标注所属引擎；含「不指定，用默认」项。
- 选了档案 → 引擎/模型/凭证/人格隐含由档案决定（UI 不再显示独立引擎/模型框）。
- active 态：输入区上方加「当前档案：X [切换]」入口；点切换弹出**仅当前会话同引擎**的档案列表，选完 → `injectSession` 带新 `agent_profile_id`。
- 切换只刷新当前会话视图，不跳新会话、不动其他会话（会话隔离）。
- `SessionCreateRequest` / `injectSession` 增加 `agent_profile_id`；`pnpm gen:types` 同步 `api-types.ts` + `openapi.json`。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | `AgentSession`（行 449-564）新增 `agent_profile_id`（FK→agent_profiles, nullable, SET NULL）+ `agent_profile_snapshot`（JSON, nullable）。producer=backend model；consumer=session service 读写、claim payload 透传。 |
| 新增 | `backend/migrations/versions/<新>.py` | Alembic 迁移：`agent_sessions` 加两列（nullable，向后兼容）。 |
| 修改 | `backend/app/modules/daemon/session/service.py` | `create_session`（行 447）：入参加 `agent_profile_id`，去掉对 UI `model` 的依赖；解析 profile→派生 provider/model→调 `_apply_profile_to_lease`→写 session.agent_profile_id/snapshot。`inject_session`（行 704）：入参加 `agent_profile_id`；与当前不同则建新 AgentRun(新 snapshot) + 发 `SESSION_SWITCH_PROFILE` WS 消息。**字段数据流**：`agent_profile_id`(frontend)→`create_session`(service)→`_apply_profile_to_lease`(写 lease.metadata 的 system_prompt/llm_provider_id/model)→`build_claim_payload._apply_profile_passthrough`(双写 claim payload)→daemon `execPayload.systemPrompt`(归一化)→`SessionManager._buildDriverOptions`(consumer)。 |
| 修改 | `backend/app/modules/daemon/router.py` | `create_session`（行 1866）/`inject_session`（行 1898）端点请求体加 `agent_profile_id`。 |
| 修改 | `backend/app/modules/daemon/schema.py` + `backend/app/modules/daemon/router.py` | 会话创建/注入的请求体 DTO 现 **inline 定义于 router.py:1573/1591**（Grill C-04 更正：非 schema.py:18-45）。本变更把 inline DTO **提为 schema.py 具名模型**并加 `agent_profile_id: str \| None = None`，openapi 产出具名 schema 供前端生成类型（解决 C-05 手写类型漂移，满足规则 20）。producer=前端→consumer=session service。 |
| 修改 | `backend/app/modules/agent/service.py` | 复用 `_resolve_dispatch_profile`（行 600-636）/`_apply_profile_to_lease`（行 638-736）；**补 model 生效**：在 resolved_model 处加 `profile.model` 覆盖（行 452/1343 附近）。可能抽一个 `_resolve_session_profile` 公共方法供 daemon session 模块复用。 |
| 修改 | `backend/app/modules/agent/placement.py` | `prepare_interactive_dispatch`（行 575）：透传派生后的 provider/model 写入 lease metadata（行 659-667）。 |
| 修改 | `backend/app/modules/daemon/lease/context.py` | interactive 分支（行 398-419）claim payload 已含 system_prompt 透传，确认 `_apply_profile_passthrough` 覆盖切换路径（零/微改）。 |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | 新增 `reloadWithProfile`（复用 `reloadWithProvider` 行 2638 模式）+ `pendingProfileSwitch`（挂在 `_onResult` 行 2921）；`_buildDriverOptions`（行 1142）已支持 systemPrompt，切换时用新值重建。 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 处理新 WS 控制消息 `SESSION_SWITCH_PROFILE`（类比 `SESSION_INJECT` 处理，行 3290-3337/611-631 附近）→ 调 `markPendingProfileSwitch`/`reloadWithProfile`。 |
| 修改 | `sillyhub-daemon/src/interactive/types.ts` | 新增切换 payload 类型（`SessionSwitchProfilePayload`：sessionId/systemPrompt/llmProviderId/model/provider/…）。 |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | 替换行 1188-1211 的「提供方+模型」为单个 `AgentProfileSelect`；active 态加「当前档案[切换]」入口（行 449-500 turn 完成后启用）；`createSession`（行 840）/`injectSession`（行 783）传 `agent_profile_id`。 |
| 修改 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | 移除 `defaultProvider`/`model` 相关 props/state（行 107/145-164），改传 `agentProfileId`。 |
| 修改 | `frontend/src/lib/daemon.ts` | `SessionCreateRequest`（行 609-619，**手写副本**）加 `agent_profile_id`、去掉 `model`/`provider`；`createSession`（行 645）/`injectSession`（行 671）签名调整。Grill C-05：配合后端 DTO 具名化，前端改用 api-types 生成类型（`pnpm gen:types`），消除手写副本漂移。 |
| 修改 | `frontend/src/lib/api-types.ts` | `pnpm gen:types` 重新生成（后端 schema 变更）。 |
| 修改 | `backend/openapi.json` | `gen:types` 产出，随 schema 变更提交。 |

## 7. 接口定义

### 7.1 后端 HTTP

```python
# backend/app/modules/daemon/schema.py
class SessionCreateRequest(BaseModel):
    prompt: str
    agent_profile_id: str | None = None   # 新增；可选档案
    manual_approval: bool = True
    ask_user_only: bool = True
    change_id: str | None = None
    workspace_id: str | None = None
    # model / provider 字段移除（由档案或默认派生）

class SessionInjectRequest(BaseModel):
    prompt: str
    agent_profile_id: str | None = None   # 新增；非空且与当前不同 → 切换档案
```

### 7.2 后端 Service 关键签名

```python
# backend/app/modules/daemon/session/service.py
async def create_session(
    self, user_id, prompt, *,
    agent_profile_id: str | None = None,
    change_id=None, workspace_id=None, manual_approval=True, ask_user_only=True,
) -> AgentSessionRead: ...

async def inject_session(
    self, session_id, user_id, *, prompt: str, agent_profile_id: str | None = None,
) -> AgentRunRead: ...

# backend/app/modules/agent/service.py（补 model 生效）
resolved_model = (profile.model if profile else None) or model or (workspace.default_model if workspace else None)
```

### 7.3 WS 控制消息（backend → daemon）

```jsonc
// SESSION_SWITCH_PROFILE：切换档案 + 原子承载切换轮的 prompt（D-007@v1）
{
  "type": "SESSION_SWITCH_PROFILE",
  "sessionId": "<uuid>",
  "runId": "<uuid>",             // 切换轮的新 AgentRun
  "claimToken": "<token>",
  "prompt": "<用户这轮的消息>",    // reload 完成后喂入新 query
  "profile": {
    "systemPrompt": "<新人格，Codex 为空>",
    "llmProviderId": "<uuid|null>",
    "provider": "claude",
    "model": "<新模型|null>"
  }
}
```

### 7.4 daemon 内部

```ts
// sillyhub-daemon/src/interactive/session-manager.ts
markPendingProfileSwitch(sessionId: string, payload: SessionSwitchProfilePayload): void
reloadWithProfile(sessionId: string, payload: SessionSwitchProfilePayload): Promise<void>
// 复用 reloadWithProvider：close 旧 query → _buildDriverOptions(新 systemPrompt) → driver.start({ resume })
```

## 7.5 生命周期契约表

本变更命中 `session / lease / agent_run / daemon / state transition` 关键词，契约如下（新增事件用 **加粗**）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session（带档案） | backend | daemon | sessionId, leaseId, claimToken, systemPrompt, llmProviderId, provider, model | session pending → active |
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | run pending → running |
| turn result | daemon | backend | runId, status, output, usage | run running → completed/failed；session 维持 active（多轮） |
| **switch profile（切换档案）** | frontend→backend（inject 带 agent_profile_id + prompt） | daemon（SESSION_SWITCH_PROFILE） | sessionId, runId, claimToken, prompt, profile{systemPrompt,llmProviderId,provider,model} | 新 run pending → running（reload 后喂 prompt）；session 维持 active，**关旧 query→新 query resume**（无 session 状态变化，仅 reload） |
| session end | daemon/backend | backend | sessionId, reason | active → ended/failed（既有，不变） |

> 切换档案**不改变 session 状态机**（仍 active 多轮），只是在 turn 边界插入一次"reload query"动作；对话历史经 `resume` 从 jsonl 重载，连续不中断。新增必需字段（`agent_profile_id`/`systemPrompt`/`profile.*`）均已出现在上方 DTO/WS payload 定义中。

## 8. 数据模型

`agent_sessions` 新增两列（nullable，向后兼容；旧会话两列均为 NULL = 现状行为）：

| 列 | 类型 | 说明 |
|---|---|---|
| `agent_profile_id` | UUID, FK→agent_profiles, nullable, ON DELETE SET NULL | 会话当前所选档案 |
| `agent_profile_snapshot` | JSON, nullable | 切换/建会话时刻冻结的档案（含 system_prompt/model/provider/llm_provider_id），防档案被改后历史失真 |

`agent_runs.agent_profile_id` / `agent_profile_snapshot` 已存在（`agent/model.py:134,143`），切换时每轮 AgentRun 各记一份，复用。无其他表结构变更。

## 9. 兼容策略（brownfield）

- **未选档案 = 完全现状**：`agent_profile_id=None` 时，`create_session` 走原逻辑（默认 provider、默认 model、无 system_prompt），`_apply_profile_to_lease` 不被调用（profile=None），行为零回归。
- **新列 nullable**：旧会话两列 NULL，不受影响；无数据回填需求。
- **model 派生回退**：`profile.model` 为空 → `workspace.default_model` → None（daemon 用 provider_config 默认）。与现状"用户没配默认供应商时 UI model 才生效"的边角场景对齐为"统一用默认"。
- **不改变的 API/表**：`agent_profiles` 表结构不变；change-driven / mission / stage 路径完全不动。
- **回退路径**：前端如出问题，`agent_profile_id` 不传即退化为现状；daemon 切换逻辑独立，可单独开关。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon `reloadWithProfile` 热切换在 resume 时历史/人格错位（jsonl 重载与新 systemPrompt 不匹配） | P1 | 复用已验证的 `reloadWithProvider` resume 路径；切换只在 turn 边界（`_onResult`）触发，不在 running 途中；新增 daemon 单测覆盖 resume+新 systemPrompt。 |
| R-02 | `profile.model` 生效与既有覆盖链冲突：现状 `_inject_provider_config`（context.py:270-294）bound llm_provider.model 绝对覆盖 payload.model（:273-275），未绑定则默认 provider.model 覆盖（:292-294），且 `_apply_profile_to_lease` 现不写 model 进 lease（Grill BLOCK-2/C-02/C-03） | P1 | 按 D-004@v2 真实优先级实现：**显式档案 model（lease 带标记）> 绑定/默认 provider_config.model > workspace 默认 > daemon 默认**。`_apply_profile_to_lease` 补写 profile.model+标记；`_inject_provider_config` 见标记跳过覆盖（未标记会话维持原覆盖链，零回归）；单测钉死优先级矩阵。 |
| R-03 | 切换档案时新档案 provider 与当前会话引擎不一致（用户绕过前端过滤） | P2 | 后端 `inject_session` 校验 `profile.provider == session.provider`，不一致则拒绝（4xx），前端列表本就过滤。 |
| R-04 | Codex 档案被选中但人格不注入，用户预期落差 | P2 | UI 在 Codex 档案选项上标注「人格暂不支持」；文档/提示说明第一期仅 Claude。 |
| R-05 | `agent_profile_snapshot` 与档案后续被编辑不一致，导致历史轮次行为难以复现 | P2 | 切换/建会话时冻结快照写入；历史 AgentRun 各带自己快照（既有机制）。 |
| R-06 | gen:types/node_modules 半坏导致假类型报错 | P2 | gen:types 前先 `pnpm exec tsc --version` 验证；必要时 `pnpm install --force`（CLAUDE.md 规则 20）。 |
| R-07 | WS 控制消息 `SESSION_SWITCH_PROFILE` 在 daemon 重连/断线场景丢失 | P2 | 复用既有 WS 韧性（outbox/重连）；切换状态落盘（pendingProfileSwitch 持久化类比 pendingSwitch）。 |

## 11. 决策追踪

本次变更决策台账见 `decisions.md`（D-001@v1 … D-006@v1 + D-004@v2/D-007@v1）。覆盖关系：

| 决策 ID | 问题 | 覆盖 |
|---|---|---|
| D-001@v1 | 档案按会话隔离 | FR-05、§5 Wave3、§8 |
| D-002@v1 | 同引擎内切换 | FR-04/FR-06、NG-02、R-03 |
| D-003@v1 | Codex 人格第一期不注入 | NG-01、R-04 |
| D-004@v2 | profile.model 真正生效：显式档案 model 优先于 provider_config.model（supersedes D-004@v1，Grill BLOCK-2） | FR-07、§5 Wave1、R-02 |
| D-005@v1 | UI 去掉引擎/模型字段，只留档案选择器 | FR-01、§5 Wave3 |
| D-006@v1 | 切换走 daemon 热切换（reloadWithProfile） | FR-04、§5 Wave2、§7.5 |
| D-007@v1 | 切换消息原子化：SESSION_SWITCH_PROFILE 携带 prompt/run_id/claim_token（Grill BLOCK-1） | §5 Wave2、§7.3、§7.5、R-01/R-07 |

**复用既有决策（来自其他变更，不重新编号）**：D-014（provider 由档案决定）、D-005-旧（Codex StartOptions 无 systemPrompt，TS 隔离）、2026-08-13 的 systemPrompt preset+append 注入路径、2026-08-06 的 `reloadWithProvider` 热切换模式。

## 12. 自审（Self-Review）

- [x] 必填章节齐全：背景 / 设计目标 / 非目标 / 总体方案 / 文件变更清单 / 接口定义 / 风险登记 / 自审。
- [x] 命中 session/lease/agent_run/daemon/state_transition → 已含「生命周期契约表」（§7.5）。
- [x] 文件变更清单对外字段（`agent_profile_id`/`systemPrompt`/`profile.*`）已标注 producer→consumer 数据流（§6）。
- [x] frontmatter 字段齐全（author/created_at/scale/status）。
- [x] 引用全部当前版本 D-xxx@vN（§11 ↔ decisions.md）。
- [x] 兼容策略明确（§9：未选档案=现状、新列 nullable）。
- [x] 复用既有管道而非重造（`_apply_profile_to_lease` / `reloadWithProvider` / systemPrompt 注入链）。
- [x] Codex 限制（NG-01）与既有 D-005-旧 一致，无冲突。
- [x] 风险登记含 daemon 热切换（R-01）、model 优先级（R-02）、provider 校验（R-03）等关键项。

**⚠️ 自审存疑 → Design Grill 处置结论（step7 独立子代理核验，3 点全部处置）**：
1. 跨模块调用：daemon 模块已有直接调 `AgentService` 的先例（`daemon/router.py:2101`、`run_sync/service.py:1131`），遵循既有模式即可，**无需抽新公共层**（Grill C-07 结案）。
2. 两套 reload 路径：`reloadWithProfile` 与 `reloadWithProvider` **共用 reload 内核**（§5 Wave2），消息类型分立但逻辑收敛（Grill C-06，P2 已处置）。
3. model 优先级：Grill BLOCK-2 证伪 v1 假设（现状 provider_config.model 绝对覆盖），已按 **D-004@v2** 显式标记方案修正 R-02/§5 Wave1，单测钉死优先级矩阵（Grill C-02/C-03 已修正）。
4. Grill 其余直接修正：§6 DTO 定位错（C-04，实际 router.py:1573/1591 inline，本变更顺势具名化迁 schema.py）、前端类型迁生成版（C-05）、切换消息原子化（BLOCK-1 → D-007@v1）。
