---
author: WhaleFall
created_at: 2026-08-14 23:12:00
scale: large
status: draft
prototype: prototype-sessions-portal.html
related_changes:
  - 2026-08-14-runtime-session-agent-profile-link  # 已停用，决策带入本变更
  - 2026-08-13-profile-system-prompt-injection     # system_prompt 注入链路复用
  - 2026-08-06-provider-switch-live-session        # reloadWithProvider 热切换模式复用
  - 2026-07-11-unify-runtime-session-dialog        # 会话弹窗组件（保留并存，D-002）
---

# 设计文档（Design）— 智能体会话总入口页面（/sessions）

## 1. 背景

平台的交互式会话目前唯一入口是 `/runtimes` 页面各 runtime 卡片上的「会话」弹窗（`RuntimeSessionDialog`，`frontend/src/components/daemon/runtime-session-dialog.tsx`），存在三个问题：

1. **入口埋在运维页里**：用户要先找到机器→展开→找到 runtime→点会话，才能开会话/续会话；没有跨机器、跨智能体的统一会话视图。
2. **新建会话字段是摆设**：弹窗 header 的「智能体提供方 / 智能体模型」两字段（`interactive-session-panel.tsx:1186-1236`）对实际 LLM 调用几乎不起作用——backend `_inject_provider_config`（`lease/context.py:208-294`）会用「我的供应商」默认配置覆盖；active 态禁用、中途改不了。
3. **会话没有自己的配置**：机器/智能体（runtime）、供应商、档案不随会话持久化，也就谈不上"每个会话独立配置、随时切换"。

与此同时平台已具备的能力：机器/心跳模型（`DaemonMachineRead`，`daemon.ts:82-107`）、runtime=provider 维度智能体（`DaemonRuntimeRead`，`daemon.ts:15-35`）、用户级供应商（`LlmProvider`，`llm_provider/model.py:23-117`）、跨工作区档案聚合（`GET /api/agent-profiles?scope=mine`）、档案 system_prompt 注入管道（`_apply_profile_to_lease` → lease metadata → claim payload → daemon preset+append，2026-08-13 已验证）、daemon provider 热切换内核（`reloadWithProvider`，`session-manager.ts:2638-2787`）。

**本变更**：新建 `/sessions` 总入口页面（左=所有会话列表，右=交互式会话）；新建会话改为四选择器（守护进程→智能体→供应商→档案，原引擎/模型字段移除）；每会话独立持有配置；会话内四配置在当前轮完成后热切换且不结束会话（同机同引擎边界）；消息按轮记录配置快照。可交互原型见 `prototype-sessions-portal.html`（定稿）。

## 2. 设计目标

- **FR-01** 新建会话四选择器联动：守护进程（必选，仅在线，默认=最近会话+记住上次）、智能体（必选，仅在线，默认 Claude Code，不支持会话的 provider 置灰）、供应商（可选，不选=**一律本机默认**，仅 Claude 引擎可选）、档案（可选，跨工作区可见档案；**不做引擎过滤**——档案不关联引擎（D-013），Codex 智能体下档案选项标注「人格暂不支持」）。原「智能体提供方/智能体模型」控件移除。
- **FR-02** 左侧会话列表：跨机器/智能体的**所有会话**（含已结束/失败只读浏览）；紧凑两行条目（状态点+标题+时间 / 机器+引擎+档案+供应商+轮数 chips）；筛选（引擎胶囊 tab、状态下拉、机器多选、标题搜索回车）+ **虚拟滚动**。
- **FR-03** 未选供应商/档案的会话行为与现状一致（本机默认供应商配置、无人格），零回归。
- **FR-04** 会话级配置生效：档案只注入人格提示词（system_prompt，Claude）+ mcp/skill 透传，**不派生引擎/模型/供应商**（D-013）；供应商优先级 = **会话选择 > 全局默认** 两级（不选=本机默认，压制档案绑定）；每轮 AgentRun 记录配置快照。
- **FR-05** 会话内配置切换（样式 B 输入框下控件条）：仅 idle 可切（running 置灰+提示）；**可切档案/供应商**，历史无缝保留（daemon reload + resume）、会话不中断；**机器/智能体纯展示不可切**（每机每引擎唯一 runtime，换机器/换引擎=开新会话，UI 下拉整体置灰标「二期/需开新会话」，D-004@v2）；切换只影响本会话。
- **FR-06** 切换合法性校验：供应商 `agent_kind` 与引擎不匹配 → 4xx（档案无引擎属性，无需引擎校验，D-013）。
- **FR-07** 每轮回复记录配置快照（档案/智能体/供应商），消息 who 行显示该轮生效配置，切换后历史消息不跟随变。
- **FR-08** 输入框上方一行：上下文用量环形进度（累计 usage/窗口；**分母=供应商配置派生（1M 勾选→1000k）→ 模型默认常量表（200k）→ 无则只显示累计 token**，D-014；阈值 50%/80% 变色，点击详情）+ 供应商额度胶囊（数据跟当前供应商联动，有则显示：5h/周窗口剩余+重置时间；无则不显示）。

## 3. 非目标

- **NG-01** 跨机器/跨引擎的会话内切换（二期；数据模型预留，UI 置灰展示）。
- **NG-02** Codex 人格提示词注入（继承原 D-003：引擎/凭证/模型跟随，人格不注入，UI 标注）。
- **NG-03** 档案 `mcp_refs/skill_refs/allowed_roots_overlay` 在会话内的实际裁剪（仅透传，与现状一致）。
- **NG-04** /runtimes 会话弹窗的改造（保留并存，D-002；弹窗继续用原 provider 入参路径）。
- **NG-05** 批量 / `--print` 模式的 systemPrompt/供应商注入。
- **NG-06** 多供应商额度聚合看板（仅会话内当前供应商的胶囊展示）。

## 4. 拆分判断

- **内聚单变更**：页面、会话配置模型、切换机制、daemon 热切换围绕同一会话生命周期强耦合，拆开无独立交付价值。
- **非批量**：无重复模式。
- 按 **Wave** 组织：Wave1 后端（模型+API+切换）→ Wave2 daemon（热切换）→ Wave3 前端（页面+组件）→ Wave4 类型同步+测试收口。Wave 间经既有 lease/WS 契约解耦。

## 5. 总体方案

### Wave 1 — 后端：会话配置模型 + API

**数据模型**（`agent_sessions` 加 3 列，均 nullable）：

| 列 | 说明 |
|---|---|
| `agent_profile_id` | FK→agent_profiles, ON DELETE SET NULL；会话当前档案 |
| `llm_provider_id` | FK→llm_providers, ON DELETE SET NULL；会话当前供应商（NULL=本机默认） |
| `config_snapshot` | JSON；当前生效配置摘要（profile_name/provider_name/model/engine），供列表 chips 直显 |

机器/智能体**不新增列**：经既有 `runtime_id`（→`daemon_runtimes.daemon_instance_id`→机器）推导。`agent_runs` 已有 `agent_profile_id/agent_profile_snapshot`（`agent/model.py:134,143`），**补 `llm_provider_id`（nullable）**实现每轮供应商快照（D-008）。

**DTO 具名化**（router.py:1573/1591 inline → `daemon/schema.py` 具名模型，解决 openapi 无具名 schema）：

```python
class SessionCreateRequest(BaseModel):
    prompt: str
    runtime_id: str | None = None      # 新页面：指定机器+智能体（与 provider 二选一，优先）
    provider: str | None = None        # 兼容 /runtimes 弹窗旧路径（保留，零回归）
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
    manual_approval: bool = True
    ask_user_only: bool = True
    change_id: str | None = None
    workspace_id: str | None = None
    # model 字段移除（由档案/默认派生，继承原 D-005/D-004@v2）

class SessionInjectRequest(BaseModel):
    prompt: str
    agent_profile_id: str | None = None   # 非空且≠当前 → 切档案
    llm_provider_id: str | None = None    # 非空且≠当前 → 切供应商（空串"none"语义=回到本机默认）
```

**create_session 接线**（`daemon/session/service.py:447`）：
1. `runtime_id` → 查 `DaemonRuntime`（校验在线）→ 派生 provider。**`prepare_interactive_dispatch`（`agent/placement.py:575`）加 `runtime_id` 钉定参数**：现 `_get_online_runtime`（:626）取「第一个在线 runtime」且 provider 不在线时静默 fallback（:1329），会绕开用户的机器/智能体选择——钉定参数命中时跳过 first-online 选择与 fallback（Grill C-01，P0）。
2. `agent_profile_id` 解析档案（复用 `_resolve_dispatch_profile` 模式，`agent/service.py:600-636`）→ **只取 system_prompt（+mcp_refs/skill_refs 透传）写入 lease metadata，不读 profile 的 provider/model/llm_provider_id**（D-013；注意 `_apply_profile_to_lease` 内部有 commit（:736）且写绑定供应商字段，需抽非 commit 的会话专用变体，Grill C-06）。
3. `llm_provider_id` 解析供应商（校验 `agent_kind` 与引擎匹配、按 `AgentSession.user_id` 归属）→ 写入 lease metadata `session_llm_provider_id`；`_inject_provider_config`（`lease/context.py:208-294`）加**会话级供应商分支（最高优先级）**：有 `session_llm_provider_id` → 用该供应商配置；无 → 现状链（bound/默认）不变。**两级优先级（会话>全局默认），无 profile.model 标记分支**（D-013 取代原 D-004@v2 在本变更的适用）。
4. 写 `agent_sessions` 三列 + 快照；首 AgentRun 带 `agent_profile_id/llm_provider_id` 快照。

**inject_session 切换**（`daemon/session/service.py:704`）：入参 `agent_profile_id`/`llm_provider_id` 与会话当前值不同 → 校验（FR-06：供应商 agent_kind 匹配且按 `AgentSession.user_id` 归属校验（借用 runtime 场景 borrower 供应商不被静默拒绝，Grill C-05）；runtime 不接受切换参数）→ **同一事务先落**新 AgentRun（带新快照）+ 更新会话三列 → 向 daemon 下发 `SESSION_SWITCH_CONFIG`（D-012，原子 payload），send 失败按既有 inject 收敛策略处理（Grill C-11）。切换不改会话状态机（仍 active 多轮）。

**会话列表扩展**（`daemon/router.py:1739-1811` `GET /api/daemon/sessions`）：加过滤参数 `runtime_id`/`machine_id`（join daemon_runtimes）/`provider`/`q`（title ilike）；分页已有。`AgentSessionRead` 加 `agent_profile_id`/`llm_provider_id`/`config_snapshot`（快照 JSON 含 profile_name/provider_name/model/engine/**machine_name/agent_name**，列表 chips 直显免二次查询，Grill C-12）。

**供应商额度查询（弱依赖，一期仅 GLM）**：`llm_provider` 模块新增 `GET /api/llm-providers/{id}/quota`：**复用既有 `usage_handlers._classify_zhipu_window/_parse_zhipu_tiers`（:318/:340，智谱 TOKENS_LIMIT 解析已存在）与其数据源**，其余返回 `{"quota": null}`；前端 null 不显示胶囊（D-009）。上下文用量一期由前端从 SSE turn usage + attach 历史 logs 累计（`AgentRunLog` 已有 usage 数据），后端聚合列后续优化。**窗口分母已核实（spike-01）**：供应商 `model_role_mappings.<role>.one_m`（勾选→1000k）→ 模型默认常量表（200k）→ 只显示累计 token。

### Wave 2 — daemon：统一热切换（SESSION_SWITCH_CONFIG）

- `session-manager.ts`：**先抽取共享 reload 内核** `_reloadSession(sessionId, {systemPrompt?, providerConfig?})`（现 `reloadWithProvider` :2638-2787 为内联实现，需重构抽取，Grill C-07）；新增 `markPendingConfigSwitch(sessionId, payload)`（idle 立即 / running 挂至 `_onResult` 边界，复用 `markPendingSwitch` 先例 :2570-2586）与 `reloadWithConfig(sessionId, payload)`——关旧 query → 按 payload 重建 driverOpts（新 systemPrompt/provider_config）→ `driver.start({resume})` 从 jsonl 重载历史 → 喂入切换轮 prompt。**Codex reload 是全新工作**（现 `reloadWithProvider` provider!=='claude' 直接抛错 :2648，只切配置不注人格）。
- `daemon.ts`：处理 `SESSION_SWITCH_CONFIG` WS 消息（类比 `SESSION_INJECT` 处理 :3290-3337）。
- Codex：reload 只切 provider/凭证/模型，人格不下发（原 D-003）。
- 持久化恢复路径（`sessions.json`）补 config 快照字段，daemon 重启后 resume 不丢配置。

### Wave 3 — 前端：/sessions 页面 + 组件

**路由/菜单**（3 处，参照 `/agent-profiles` 模板）：
1. `frontend/src/lib/menu-permissions.ts`：agent 区新增 `{menuKey:"sessions", menuLabel:"智能体会话", href:"/sessions", absolute:true, matchPattern:"/sessions", permissions:[]}`（登录可见）。
2. `frontend/src/components/app-shell.tsx`：`MENU_ICON_MAP` 加 `"/sessions": MessageSquare`。
3. `frontend/src/app/(dashboard)/layout.tsx:16`：`WORKSPACE_WHITELIST` 加 `"/sessions"`。
4. 新建 `frontend/src/app/(dashboard)/sessions/page.tsx`。

**页面骨架**（`grid-cols-[320px_minmax(0,1fr)]`，参照 `runtime-session-dialog.tsx:310-352` 两栏布局）：
- **左 SessionListPanel**（新组件）：筛选区（引擎胶囊 tab/状态/机器多选/搜索回车）+ 虚拟滚动列表（**新引入 `@tanstack/react-virtual`**（~3KB，与既有 react-query 同家）；备选 antd List virtual 零新依赖，Grill C-08：项目现无任何虚拟滚动库）+ 紧凑两行条目（D-006）+ chips 实时反映会话当前配置（读 snapshot）。
- **右两态**：
  - **NewSessionForm**（新组件，D-010 联动）：MachinePicker（`useDaemonMachines` 过滤 online；默认=localStorage 上次选择→最近会话机器→最新心跳；D-005）/ AgentPicker（选中机器 runtimes 过滤在线+provider∈{claude,codex}，默认 claude；其余置灰「暂不支持会话」）/ 供应商 Select（`frontend/src/lib/providers.tsx` 列表 + 「不指定（本机默认）」；engine≠claude 锁定）/ 档案 Select（`useMineAgentProfiles` 跨工作区聚合，**不做引擎过滤**；Codex 智能体下选项标注「人格暂不支持」，D-013）+ 消息输入 + 「开始会话」。
  - **SessionPanel**（新组装层）：复用既有交互式会话的**消息流/输入区子组件**——从 `interactive-session-panel.tsx` 抽取共享子组件（TurnTimeline 消息流 + SessionInputBar 输入区），弹窗与新页面分别组装（弹窗零回归，D-002）。新页面特有：
    - **SessionConfigBar**（样式 B，D-007）：输入框下方四控件（机器/智能体/供应商/档案）。**可切：档案、供应商**（idle 点开下拉 → `injectSession` 带新配置 + prompt）；**机器/智能体为纯展示**（点击下拉仅展示可选项并整体置灰：跨机器标「二期」、跨引擎标「需开新会话」——数据模型上每机每引擎唯一 runtime，无同机同引擎切换目标，D-004@v2）；running 全置灰 + 「🔒 本轮完成后解锁切换」。
    - **消息 who 行**（D-008）：从轮次 run 快照渲染 `📋 档案 · 智能体 · ☁ 供应商`（本机默认/未指定如实显示），历史不跟随。
    - **CtxUsageBar**（D-009，输入框上方一行）：CtxUsageRing（SSE/attach usage 累计 ÷ 模型窗口；阈值 50%/80% 变色；点击详情浮层）+ QuotaPill（当前供应商 quota 接口，null 不显示）。
- 前端 client（`frontend/src/lib/daemon.ts`）：`SessionCreateRequest` 加 runtime_id/agent_profile_id/llm_provider_id；`injectSession` 加同字段；`listAgentSessions` 加过滤参数；类型迁 `api-types.ts` 生成版（配合 DTO 具名化，规则 20）。

### Wave 4 — 类型同步 + 测试收口

- `pnpm gen:types`（后端 schema 变更 → `api-types.ts` + `openapi.json` 同变更内提交）。
- 后端测试：切换校验（跨引擎 4xx）、会话级供应商优先级矩阵、快照落库、列表过滤、未选配置零回归。
- daemon 测试：`reloadWithConfig` resume+新配置、pending 边界、SESSION_SWITCH_CONFIG 处理、恢复路径。
- 前端测试：NewSessionForm 联动、SessionConfigBar 切换/置灰、列表筛选、who 行快照渲染。
- `npm test` + `npm run lint` 全绿。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/agent/model.py` | `AgentSession`（:449-564）加 `agent_profile_id`/`llm_provider_id`/`config_snapshot` 三列；`AgentRun`（:134 附近）加 `llm_provider_id`。producer=backend session service；consumer=会话列表/消息渲染。 |
| 新增 | `backend/migrations/versions/<新>.py` | Alembic 迁移：`agent_sessions` 加 3 列 + `agent_runs` 加 1 列（均 nullable）。 |
| 修改 | `backend/app/modules/daemon/schema.py` | 新增具名 `SessionCreateRequest`/`SessionInjectRequest`；`AgentSessionRead` 加配置字段。 |
| 修改 | `backend/app/modules/daemon/router.py` | `create_session`（:1866）/`inject_session`（:1898）改用具名 DTO；`GET /sessions`（:1739-1811）加过滤参数。 |
| 修改 | `backend/app/modules/daemon/session/service.py` | `create_session`（:447）runtime_id/provider 双入口 + 档案/供应商解析 + 快照落库；`inject_session`（:704）切换校验 + AgentRun 快照 + 下发 SESSION_SWITCH_CONFIG。 |
| 修改 | `backend/app/modules/agent/placement.py` | `prepare_interactive_dispatch`（:575）加 `runtime_id` 钉定参数：命中时跳过 `_get_online_runtime`（:626）first-online 选择与 provider fallback（:1329）（Grill C-01，P0）。 |
| 修改 | `backend/app/modules/agent/service.py` | 复用 `_resolve_dispatch_profile`；新增会话专用档案注入（只写 system_prompt/mcp/skill，非 commit 变体；不读 provider/model/llm_provider_id，D-013，Grill C-06）。 |
| 修改 | `backend/app/modules/daemon/lease/context.py` | `_inject_provider_config`（:208-294）加会话级供应商最高优先级分支。 |
| 修改 | `backend/app/modules/llm_provider/router.py` | 新增 `GET /llm-providers/{id}/quota`（弱依赖，一期 GLM；无数据返回 null）。 |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | `markPendingConfigSwitch`/`reloadWithConfig`（共用 reload 内核，R-01）；state/持久化补 config 快照。 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 处理 `SESSION_SWITCH_CONFIG`（类比 SESSION_INJECT :3290-3337）。 |
| 修改 | `sillyhub-daemon/src/interactive/types.ts` | `SessionSwitchConfigPayload` 类型。 |
| 新增 | `frontend/src/app/(dashboard)/sessions/page.tsx` | 页面主体（两栏 + 两态）。 |
| 新增 | `frontend/src/components/sessions/session-list-panel.tsx` | 列表+筛选+虚拟滚动。 |
| 新增 | `frontend/src/components/sessions/new-session-form.tsx` | 四选择器联动表单。 |
| 新增 | `frontend/src/components/sessions/session-config-bar.tsx` | 样式 B 配置控件条 + 切换下拉。 |
| 新增 | `frontend/src/components/sessions/ctx-usage-bar.tsx` | 上下文环 + 额度胶囊。 |
| 修改 | `frontend/src/components/daemon/interactive-session-panel.tsx` | 抽取 TurnTimeline/SessionInputBar 共享子组件（弹窗继续用原 header，零回归）。 |
| 修改 | `frontend/src/lib/daemon.ts` | createSession/injectSession/listAgentSessions 签名与参数；类型迁生成版。 |
| 修改 | `frontend/src/lib/menu-permissions.ts` + `frontend/src/components/app-shell.tsx` + `frontend/src/app/(dashboard)/layout.tsx` | 新菜单 3 处（§5 Wave3）。 |
| 修改 | `frontend/src/lib/api-types.ts` + `backend/openapi.json` | gen:types 产物随变更提交。 |
| 修改 | `backend/app/modules/daemon/service.py` | DaemonService facade：create/inject 会话配置字段透传（task-02/06，签名加默认 None 纯透传，零行为变化）。 |
| 修改 | `frontend/pnpm-lock.yaml` | 新依赖 @tanstack/react-virtual 锁文件（task-11，D-003）。 |
| 新增 | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` | /sessions 页面组装冒烟测试（task-10 验收要求）。 |
| 修改 | `sillyhub-daemon/src/interactive/session-store-persistence.ts` | sessions.json 持久化白名单补 systemPrompt/providerConfig（§5 Wave2 恢复链路必需）。 |

> **execute 期补充说明（Reverse Sync，2026-08-15）**：另有各 task 配套测试文件（backend `test_lease_context_provider_priority.py`/`test_session_create_config.py`/`test_session_switch_config.py`/`test_sessions_list_filters.py`/`test_quota.py`/`test_session_runs_endpoint.py`，daemon `session-manager-config-switch.test.ts`/`daemon-session-switch-config.test.ts`，frontend 各组件 `__tests__/*`）与 task-13 抽取产物 `turn-timeline.tsx`/`session-input-bar.tsx`（§6 原「抽取」条目的落位文件），均为各 task 验收必需、经 review 核可。

## 7. 接口定义

### 7.1 后端 HTTP（具名 DTO，见 §5 Wave1）

会话列表：`GET /api/daemon/sessions?limit&offset&status&runtime_id&machine_id&provider&q`。
供应商额度：`GET /api/llm-providers/{id}/quota` → `{"quota": {"model":"glm-4.7","windows":[{"label":"5 小时","left":18,"reset":"…"},…]} | null}`。

### 7.2 WS 控制消息（backend → daemon）

```jsonc
// SESSION_SWITCH_CONFIG（D-012）：切换档案/供应商 + 原子承载切换轮 prompt
{
  "type": "SESSION_SWITCH_CONFIG",
  "sessionId": "<uuid>",
  "runId": "<uuid>",            // 切换轮新 AgentRun
  "claimToken": "<token>",
  "prompt": "<用户这轮的消息>",
  "profile": {                   // 可 null（不切档案）；档案只含提示词维度（D-013）
    "systemPrompt": "<新人格，Codex 为空>",
    "mcpRefs": [], "skillRefs": []
  },
  "providerConfig": { /* 可 null（不切供应商）；结构同 lease claim payload 的 provider_config */ }
}
```

### 7.3 daemon 内部

```ts
markPendingConfigSwitch(sessionId, payload: SessionSwitchConfigPayload): void
reloadWithConfig(sessionId, payload: SessionSwitchConfigPayload): Promise<void>
// 共用 reload 内核：close 旧 query → 重建 driverOpts(systemPrompt/providerConfig) → driver.start({resume}) → 喂 prompt
```

## 7.4 生命周期契约表

本变更命中 `session / lease / agent_run / daemon / state transition` 关键词，契约如下（新增事件用 **加粗**）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session（带 runtime_id+配置） | frontend→backend | daemon | sessionId, leaseId, claimToken, runtimeId, systemPrompt?, llmProviderId?, providerConfig? | session pending → active |
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | run pending → running |
| turn result | daemon | backend | runId, status, output, usage, **agent_profile_id, llm_provider_id（轮次快照）** | run running → completed/failed；session 维持 active |
| **switch config（切档案/供应商）** | frontend→backend（inject 带新配置+prompt） | daemon（SESSION_SWITCH_CONFIG） | sessionId, runId, claimToken, prompt, profile?, providerConfig? | 新 run pending → running（reload 后喂 prompt）；session 维持 active，关旧 query→新 query resume（无 session 状态变化） |
| session end | daemon/backend | backend | sessionId, reason | active → ended/failed（既有，不变） |

> 切换不改会话状态机，仅 turn 边界插入一次 reload；历史经 resume 从 jsonl 重载。机器/引擎不在可切字段中（D-004）。

## 8. 数据模型

`agent_sessions` 加 3 列（§5 Wave1 表）；`agent_runs` 加 `llm_provider_id`。每轮快照语义：`AgentRun.agent_profile_snapshot`（既有）+ `llm_provider_id` 共同构成轮次配置快照（D-008 的数据来源）。旧数据全 NULL=现状行为，无回填。

## 9. 兼容策略（brownfield）

- **/runtimes 弹窗零回归**：`provider` 入参保留（D-002）；`InteractiveSessionPanel` 只抽子组件不改行为。
- **未选配置=现状**：`agent_profile_id`/`llm_provider_id` 均 NULL → 原逻辑（全局默认供应商、无人格），`_inject_provider_config` 新分支不触发。
- **新列全 nullable**：旧会话不受影响；daemon 持久化兼容旧 sessions.json（字段缺省=无配置）。
- **前端可退化**：新页面不传新参数即等价旧行为。
- **回退**：切换逻辑与既有 reload 共用内核，可独立回退；WS 消息 daemon 未识别时按未知消息忽略（既有韧性）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | reload 热切换 resume 时历史/新配置错位 | P1 | 复用已验证 reloadWithProvider resume 路径；切换仅 turn 边界；daemon 单测覆盖 resume+新 systemPrompt/providerConfig。 |
| R-02 | 会话级供应商与 `_inject_provider_config` 覆盖链冲突 | P1 | 两级优先级：会话 `session_llm_provider_id`（独立 metadata key，与 bound 读取的 `llm_provider_id` 不同 key 天然不冲突）> 现状 bound/默认链；未传会话供应商时链路不变（零回归）；单测钉死。无 profile.model 分支（D-013 简化）。 |
| R-03 | 绕过前端切换（跨引擎档案/不匹配供应商） | P2 | 后端 inject 校验 4xx（FR-06）。 |
| R-04 | 虚拟滚动+15s 轮询大量会话的性能 | P2 | 后端真分页+过滤；前端仅渲染可视区；轮询列表页用轻量字段（snapshot 直显免 join 查询）。 |
| R-05 | 供应商额度接口不稳定/不标准（弱依赖） | P2 | 一期仅 GLM；接口失败/无数据返回 null，前端不显示胶囊；不阻塞主流程。 |
| R-06 | 上下文用量与真实窗口口径偏差（前端累计） | P2 | SSE/attach usage 同源累计；后端聚合列后续优化；展示标注口径。 |
| R-07 | SESSION_SWITCH_CONFIG 断线丢失 | P2 | 复用 inject 现有收敛策略（send 失败 run→failed、session 保持 active、可重试）；会话三列与 run 同事务先落避免 DB 陈旧；daemon 侧 pendingConfigSwitch 持久化。（注：会话控制消息无 outbox 机制，Grill C-10 更正） |
| R-08 | gen:types node_modules 半坏假报错 | P2 | 先 `pnpm exec tsc --version` 验证；必要时 `pnpm install --force`（规则 20）。 |

## 11. 决策追踪

| 决策 ID | 问题 | 覆盖 |
|---|---|---|
| D-001@v1 | 新开变更，原变更停用带入决策 | 全局 |
| D-002@v1 | /runtimes 弹窗保留并存 | NG-04、§5 Wave3、§9 |
| D-003@v1 | 列表=所有会话+虚拟滚动+筛选 | FR-02、§5 Wave3 |
| D-004@v2 | 切换边界=档案/供应商可切，机器/智能体纯展示（跨机二期）；supersedes D-004@v1（「同机同引擎智能体」在数据模型上无切换目标，Grill C-02） | FR-05/FR-06、NG-01、§7.4 |
| D-005@v1 | 默认机器=最近会话+记住上次 | FR-01 |
| D-006@v1 | 列表条目=紧凑两行 | FR-02 |
| D-007@v1 | 配置切换 UI=样式 B 输入框下控件条 | FR-05、SessionConfigBar |
| D-008@v1 | 每轮配置快照，历史不跟随 | FR-07、§8 |
| D-009@v1 | 上下文环+供应商额度胶囊（有则显示） | FR-08、R-05/R-06 |
| D-010@v1 | 四选择器联动规则 | FR-01/FR-03 |
| D-011@v1 | 技术路线=扩展现有会话域 | §5 |
| D-012@v1 | SESSION_SWITCH_CONFIG 原子消息 | §7.2、§5 Wave2 |
| D-013@v1 | 会话档案=提示词+技能，不关联引擎/模型/供应商；不选供应商=一律本机默认 | FR-01/FR-04/FR-06、§5 Wave1、§7.2、R-02 |
| D-014@v1 | 上下文窗口分母=供应商配置派生→模型常量表→只显示累计 | FR-08 |

**继承原变更决策（不重新编号）**：原 D-001（档案会话隔离）、原 D-002（同引擎切换——档案引擎维度已被 D-013 移除，供应商 agent_kind 校验保留）、原 D-003（Codex 人格一期不注入）、原 D-005（UI 去引擎/模型字段）、原 D-006（daemon 热切换 reloadWithProfile，本变更统一为 reloadWithConfig）、原 D-007（切换消息原子化）。**原 D-004@v2（profile.model 显式标记优先）不适用本变更**——D-013 裁定会话路径档案不派生模型。

## 12. 自审（Self-Review）

- [x] 必填章节齐全：背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记/自审。
- [x] 命中 session/lease/agent_run/daemon/state_transition → 已含「生命周期契约表」（§7.4）。
- [x] 文件清单对外字段（runtime_id/agent_profile_id/llm_provider_id/config_snapshot/profile.*/providerConfig）标注 producer→consumer 数据流（§5/§6）。
- [x] frontmatter 字段齐全（author/created_at/scale/status/prototype/related_changes）。
- [x] 引用全部当前版本 D-xxx@vN（§11 ↔ decisions.md，含继承决策）。
- [x] 兼容策略明确（§9：provider 入参保留、未选配置=现状、新列 nullable、弹窗零回归）。
- [x] 复用既有管道而非重造（_apply_profile_to_lease / reloadWithProvider / InteractiveSessionPanel 子组件 / useDaemonMachines / useMineAgentProfiles）。
- [x] 风险登记覆盖热切换（R-01）、覆盖链（R-02）、校验（R-03）、性能（R-04）、弱依赖（R-05/R-06）。
- [x] 原型定稿（prototype-sessions-portal.html 可交互版，用户确认）与本文一一对应。

**⚠️ 自审存疑 → Design Grill 处置结论（step7 独立子代理核验，13 项交叉检查）**：
1. ~~供应商优先级插入~~ **已解决**：会话级用独立 metadata key `session_llm_provider_id`，与 bound 分支读取的 `llm_provider_id` 不同 key 天然不冲突；D-013 后进一步简化为两级优先级（会话>全局默认），无 model 标记分支。
2. ~~runtime_id 双入口 lease 定位~~ **已解决（C-01/P0）**：`prepare_interactive_dispatch` 加 runtime_id 钉定参数，跳过 `_get_online_runtime` first-online 选择与 fallback；§6 已补 placement.py。
3. ~~虚拟滚动选型~~ **已解决（C-08）**：项目无既有方案，新引入 `@tanstack/react-virtual`（备选 antd List virtual 零新依赖）。
4. Grill 其余直接修正：FR-05「同机同引擎智能体可切」不成立（每机每引擎唯一 runtime）→ D-004@v2 机器/智能体纯展示；reload 内核需显式抽取重构（C-07）；R-07 outbox 表述更正（C-10）；快照字段统一 config_snapshot 含 machine_name（C-12）；切换两提交窗口收敛（C-11）；借用 runtime 归属校验（C-05）；档案=提示词+技能、供应商一律本机默认、窗口分母口径（C-03/C-09 用户拍板 → D-013/D-014）。
