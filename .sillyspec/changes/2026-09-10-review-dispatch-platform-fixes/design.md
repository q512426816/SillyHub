---
author: qinyi
created_at: 2026-09-10 19:30:00
updated_at: 2026-09-10 19:30:00
scale: large
---

# 设计文档（Design）— review-dispatch 平台侧三问题修复（worker artifacts 承接 / pi 独立配额池 / 生效执行器暴露）

## 1. 背景

sillyspec 仓的 review-dispatch（tier=independent 独立审查平台派发）已全流程交付并活体验证，今天两轮真派发暴露三个平台侧（multi-agent-platform 仓）问题：

- **P0-1 worker 结论未沉淀为 artifacts**：mission 77470369（worker e665ddc9，read_only PI worker，13 分钟 completed）的 `get_worker_result` 返回 `artifacts: []`，完整审查结论只存在于 `get_run_logs` 的 `[ASSISTANT]` 消息流。消费方（回收链）按契约从 artifacts 提取结构化产出，空 artifacts 意味着每次回收都得人工翻日志。根因（代码探查证实，非单一）：
  1. review-dispatch 的 worker 走的是 **interactive lease（子会话三元组派发）**，不经 batch `complete_lease` → `collect_completed_artifacts`（execution.py:830-877 的「lease 终态 → kind=summary artifact」通道只覆盖 batch）；
  2. PI driver 的 success turn result 不带 `result` 字段（pi-rpc-driver.ts:1379-1386）→ backend `close_interactive_run` 的 `result_summary` 为 None → `AgentRun.output_redacted` 不写（close_run_steps.py:360-366）；
  3. pi 无原生 MCP（provider caps `mcp: false`，providers.ts:184-194）→ read_only PI 分身物理上无法调 `worker_done` MCP 工具自报 summary。
- **P0-2 配额池独立性**：本地 agent 子代理与平台 worker（pi-coding-agent）吃同一账号级配额池（429 code 1308 同时锁死两边，15:30-18:31 全通道瘫痪即实证）。review-dispatch 的核心价值主张是「本地配额耗尽/宿主无 Agent 时平台兜底」，同池等于兜底失效。病灶：`llm_providers` 用户级凭证表 schema 锁死 `agent_kind: Literal["claude"]`（llm_provider/schema.py:17）建不了 pi 类凭证；daemon `credential-injector.ts` REGISTRY 只注册 claude（:217-219），pi 的 provider_config 在 spawn-env 第 0 层被 `getInjector` 跳过（spawn-env.ts:205-211）→ pi worker 落回本机 credentials.json / 宿主 env（与本地 agent 同池）。
- **P1-3 workspace default_agent 置空**：远端 multi-agent-platform 工作区 default_agent 为空，`dispatch_worker` 不传 agent_type 时回退 claude（mcp_tools.py:1075），本机无 claude CLI 时白跑一轮。且 `get_daemon_status`（mcp_gateway/tools.py:1009-1104）不暴露任何 provider/执行器信息，调用方派发前无法判「会用哪个执行器、机器上有哪些在线」——而 daemon 注册/心跳本就上报 providers（DaemonRuntime 表现成数据）。

## 2. 设计目标

1. **P0-1**：read_only PI worker 完成后，`get_worker_result` 至少含一个带正文的 `kind=summary` artifact（正文=worker 最终 assistant 消息全文，含 review JSON）；顺带修复 PI turn result 无 `result` 字段导致的 `result_summary`/`output_redacted` 空洞。
2. **P0-2**：打通「pi 执行器独立凭证」配置链：backend 可创建 `agent_kind=pi` 的 LlmProvider（独立 key / 不同 provider），claim 时随 lease 下发，daemon 注入 pi 子进程 env——使 per-(user, agent_kind) 默认与 agent_profile/workspace 绑定两条独立池配置路都可用，本地 claude 池与平台 pi 池物理隔离。
3. **P1-3**：`get_daemon_status` 响应暴露 workspace `default_agent`、派发时实际生效的 `effective_agent` 与每台 daemon 的在线 providers 列表，调用方派发前一次查询即可判断执行器；运维侧把 default_agent 设为 pi 的操作随交付文档给出。

## 3. 非目标（Non-Goals）

- 不改 sillyspec 仓（消费侧 artifacts 双通道提取、空 artifacts 兜底指引已就绪并实证正确）。
- 不动 batch lease 路径的 artifact 通道（execution.py `collect_completed_artifacts` 对 batch 已工作）；P0-1 只补 interactive 子会话路径。
- 不为 pi 实现 hub LiteLLM 代理（litellm_proxy/openai_chat）形态：pi CLI 不读任何 BASE_URL env（dist 包 grep 证实），自定义端点需宿主侧 `~/.pi/agent/models.json`，本变更仅在文档中说明该边界，不在 daemon 侧管理 pi 配置文件。
- 不做 workspace 直挂 `llm_provider_id` 列（需 DDL + 归属校验放宽的安全语义改动）；workspace 级经既有 `default_agent_profile_id` 间接绑定已够。
- 不给 `AgentArtifact.kind` 引入枚举约束或新值 `final_output`（沿用既有 `summary`，见 D-001@v1）。
- 不做 provider 热切换（PROVIDER_CONFIG_CHANGED）对 pi 的专项验证：pi worker 会话短生命周期，claim 时现算配置已够；热切换既有链路按 user 查会话，行为不回归即可。

## 4. 拆分判断

单一连贯变更，不拆 MASTER：三问题共享同一价值链（review-dispatch 平台侧可用性），P0-1 与 P0-2 都落在「pi worker 的平台承接面」上（一个补产出回流、一个补凭证隔离），拆开会造成中间态各自验收都要起远端环境。三个 Wave（P0-1 / P0-2 / P1-3）各自独立可验收。无批量模式特征。

## 5. 总体方案

### 5.1 Wave 1（P0-1）— PI worker 终态结论回流 artifacts

数据流（producer→consumer 全链）：

```
pi 子进程 stdout（message_end assistant 全文）
  → pi-events.ts handleMessageEnd 产 {type:'text', content:<全文>, override:true} 事件
  → pi-rpc-driver.ts 事件循环截获 override text 存 turnFinalText（轮状态重置区同点清空）
  → reportTurnResult({subtype:'success', result: turnFinalText, ...})   ← 补 result 字段
  → daemon.onTurnResult：payload.result_summary（截断 500，既有逻辑零改动，顺带修复 output_redacted 空洞）
                       └ 新增分支：state.stage==='mission_worker' && getProviderCaps(state.provider).mcp===false
                          && 非 error && turnFinalText 非空
                          → fire-and-forget hubClient.workerDone(undefined, undefined, {summary: turnFinalText 全文}, {sessionId})
  → backend _worker_done_core（mcp_tools.py:2171，四路由族同构，全语义现成）：
      X-Session-Id 定位分身会话 → resolve_mission_for_session 爬根
      → AgentArtifact(run_id=分身首 run, kind='summary', content_ref=summary 全文)
      → worker_done_at=now()（可重复置位取最新）→ 全分身完成则唤醒主控
  → get_worker_result（mcp_tools.py:1513）：select AgentArtifact → artifacts:[{kind, content_ref, id}]
```

关键设计点：

- **门控用 provider 能力而非白名单**：`getProviderCaps(provider).mcp === false`（providers.ts:219 现成查询）。有原生 MCP 的 provider（当前仅 claude）继续走 worker_prompt 约定的自报 `worker_done` 工具，daemon 不代报——防 `_worker_done_core` 每调用 INSERT 新 artifact 行造成的双写。mcp:false 的 provider（pi、codex、cursor——codex/cursor 的 caps 亦为 false，providers.ts:172/:199）由 daemon 兜底代报：codex/cursor 分身今天同样物理上无法自报（artifacts 恒空），代报使其同样获得 kind=summary 产出，行为变化方向与「任何 mcp:false provider 由 daemon 兜底」的意图一致。未知 provider 实际不可达（会话创建即按 INTERACTIVE_PROVIDERS 注册表选 driver，providers.ts:320）。
- **触发时机=turn 成功终态**（非 session end）：与 `is_worker_complete_from_active` 判据（worker_done_at 置位 + 无活跃 turn）天然对齐——turn 收敛即无活跃 turn，唤醒时机与既有 session 终态路径等价且更早；「追问重开工后再干再置位」的后端幂等语义（mcp_tools.py:2204-2205）覆盖多轮 worker 会话（每轮成功各落一条 summary artifact，最新为终态，消费方按序取末条）。**实现约束（Grill B-02）**：代报分支必须置于 `onTurnResult` 既有 `await notifyRunResult`（daemon.ts:3897-3906）之后——终态先落库、唤醒随后；即使错序，最坏为 patrol 定时兜底延迟唤醒（patrol.py 幂等），无提前收敛、无永久卡死。
- **X-Session-Id 承载分身身份**：daemon 主 hubClient 无会话头，`workerDone` 增加一次性 `sessionId` 覆盖参数（走既有 `_sessionIdHeaders` 同款合并），不新建 HubClient 实例。`workspace_id`/`mission_id` 锚不传（backend 沿 parent 链解析，header-only 形态是既有主形态）。
- **容错**：fire-and-forget，409（mission 已收敛的迟到调用）/422/网络错误仅 `warn` 不重试不阻塞——artifact 是兜底通道，失败时消费方仍有 sillyspec 侧日志兜底路径（已就绪）。
- **result 字段修复的连带收益**：PI turn result 补 `result` 后，`result_summary`（daemon.ts:3755-3760 既有截断逻辑）与 `AgentRun.output_redacted` 不再为空，batch `collect_completed_artifacts` 对 pi 的 `kind=summary` 生成也顺带恢复。

### 5.2 Wave 2（P0-2）— pi 执行器独立凭证链

后端链路（profile 绑定路）已全通，本 Wave 只补两个缺口 + 前端入口：

```
[缺口1 backend] LlmProviderCreate（agent_kind 仅存在于 Create；Update/FetchModels 无该字段）：
  agent_kind: Literal["claude"] → Literal["claude", "pi"]
  auth_field: Literal["ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY"]
             → str + Field(pattern="^[A-Z][A-Z0-9_]*$")（env 变量名形状，缺省值不变；
               Create/Update/FetchModelsRequest 三处同款放宽）
  → 用户可建 agent_kind=pi 的凭证行（如 auth_field=ZAI_API_KEY / ANTHROPIC_API_KEY /
    OPENROUTER_API_KEY...，配独立 api_key）

[既有链路，零改动] claim 时 _inject_provider_config 三级解析（lease/context.py:284-343）：
  session_llm_provider_id > llm_provider_id（profile 绑定）> (user_id, agent_kind=pi, is_default)
  → resolve_default/bound_provider_config 解密产 9 字段中性 provider_config
  → lease claim payload.provider_config（agent_kind='pi'）

[缺口2 daemon] credential-injector.ts 新增 PiCredentialInjector：
  REGISTRY 注册 pi 条目 → spawn-env 第 0 层不再跳过
  映射（pi 实测约定：凭证走 provider 专属 env，如 ANTHROPIC_API_KEY/ZAI_API_KEY；
        不读任何 BASE_URL env；model 经 --model spawn 旗标不走 env）：
    api_key        → env[auth_field ?? 'ANTHROPIC_API_KEY']（空串跳过）
    extra_env      → Object.assign（空串值跳过，对齐 claude injector 先例）
    litellm_proxy  → 不支持，忽略（v1 边界，design §3）
    base_url/model/model_role_mappings/default_fallback_model → 无 pi env 对应，不映射

[前端] llm-provider-form.tsx：启用既有 pi 预留下拉项（去掉 disabled，接通 state）；
  agent_kind=pi 时 auth_field 由固定下拉泛化为可输入 env 变量名（校验同 backend pattern）
```

独立池的两种用法（交付文档说明，均零额外代码）：

- **账号级隔离（最小）**：建 `agent_kind=pi` + `is_default=true` 的凭证（独立 key）→ 所有 pi worker（平台派发）走该池，本地 claude 子代理继续吃 claude 默认凭证——两池物理隔离，429 不再同锁。
- **profile/workspace 级隔离**：凭证绑到 `AgentProfile.llm_provider_id` → workspace 经 `default_agent_profile_id` 或 dispatch 时显式 profile 引用——不同工作区/角色各配各池。

### 5.3 Wave 3（P1-3）— get_daemon_status 暴露生效执行器

`get_daemon_status`（mcp_gateway/tools.py:1009）响应纯增量扩展（数据全现成）：

- 顶层 `default_agent: workspace.default_agent`（workspace 已在 :1047 加载）；
- 顶层 `effective_agent`：default_agent 非空即它；为空时取 `daemons[]` 返回序中首个 online 项的首个 online provider（绑定查询序，无额外 ORDER BY——它是「调用方可判」信号而非权威解析，权威以派发时 placement 实算为准）；
- `daemons[]` 每项追加 `providers: [{provider, status, version}]`：对 bindings 的 daemon_id 集合一条 `select(DaemonRuntime).where(daemon_instance_id.in_(...), status=='online')` 按 daemon 分组。

运维动作（非代码，交付文档给出）：`PATCH /api/workspaces/{id} {"default_agent":"pi"}` 或前端工作区详情页「智能体提供方」下拉选 PI 保存。

## 6. 文件变更清单

主仓单仓变更（backend/frontend/sillyhub-daemon 均为主仓目录）。

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | 轮状态区新增 turnFinalText（与 pendingTurnError 同点重置）；事件循环截获 `type=text && override` 存值；success turn result 补 `result` 字段。数据流：producer=pi message_end（pi-events 归一化 override 全文）→ driver turnFinalText → consumer=reportTurnResult result 字段（下游 result_summary/workerDone summary 两跳消费） |
| 修改 | sillyhub-daemon/src/hub-client.ts | `workerDone` 增加第 4 参 `opts?: { sessionId?: string }`：sessionId 存在时合并 X-Session-Id 头（与 `_sessionIdHeaders()` 同 key，覆盖实例级）。数据流：producer=daemon.onTurnResult → 本方法 extraHeaders → consumer=backend `_request_session_id`（header 优先） |
| 修改 | sillyhub-daemon/src/daemon.ts | `onTurnResult` 新增 mission_worker 兜底代报分支（门控 stage + caps.mcp===false + 非 error + result 文本非空）；fire-and-forget + catch warn。数据流：producer=driver result → consumer=backend worker_done 端点（AgentArtifact kind=summary + worker_done_at + 唤醒） |
| 修改 | sillyhub-daemon/src/credential-injector.ts | 新增 `PiCredentialInjector`（agentKind='pi'，映射见 §5.2）+ REGISTRY 注册。数据流：producer=backend claim payload provider_config（agent_kind=pi）→ spawn-env 第 0 层 `getInjector('pi')` 命中 → consumer=pi 子进程 env（如 ZAI_API_KEY） |
| 修改 | backend/app/modules/llm_provider/schema.py | `agent_kind` 放开 pi；`auth_field` 三处（Create/Update/FetchModels）泛化为 env 名 pattern。数据流：producer=前端表单/API 调用方 → pydantic 校验 → consumer=LlmProvider 行（列本为 String(32) 无需 DDL）→ claim 解析链既有消费 |
| 修改 | backend/app/modules/mcp_gateway/tools.py | `get_daemon_status` 响应增 `default_agent`/`effective_agent`/`daemons[].providers`。数据流：producer=Workspace.default_agent + DaemonRuntime 行 → 本 tool 聚合 → consumer=MCP 调用方（review-dispatch 派发前探查） |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | agentKind state 可变 + 启用 pi 选项；pi 时 auth_field 输入泛化（datalist/输入框 + pattern 校验）。数据流：producer=用户表单 → consumer=LlmProviderCreate（api-types 再生成后类型同步） |
| 再生成 | backend/openapi.json | schema 枚举/pattern 变更同步（生成脚本，禁手写） |
| 再生成 | frontend/src/lib/api-types.ts | `pnpm gen:types`（CLAUDE.md 规则 21） |
| 再生成 | sillyhub-daemon/src/api-types.ts | `pnpm gen:types`（同上，daemon 侧门禁 gen:types:check） |
| 新增 | sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts | PI driver turnFinalText→result 字段（override 事件驱动、轮重置、error 轮不带） |
| 新增 | sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | daemon.onTurnResult mission_worker 分支：门控（stage/caps/is_error/空文本）、置于 notifyRunResult 之后、workerDone 调用参数（sessionId 头 + summary 全文）、失败仅 warn（含 HubHttpError 捕获）、非 mission_worker 零调用 |
| 新增 | sillyhub-daemon/tests/credential-injector-pi.test.ts | Pi injector 映射（auth_field 缺省/显式、空 key 跳过、extra_env、litellm_proxy 忽略）+ REGISTRY 注册 |
| 新增 | backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py | schema 放开（pi 可建、auth_field pattern 拒非法、claude 旧值零回归） |
| 修改 | backend/app/modules/mcp_gateway/tests/test_tools_new.py | get_daemon_status 断言新增三字段（default_agent/effective_agent/providers 分组与 online 过滤） |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | pi 选项可选、pi 时 auth_field 可输入 env 名、claude 路径零回归 |

## 7. 接口定义

```ts
// sillyhub-daemon/src/hub-client.ts
async workerDone(
  workspaceId: string | undefined,
  missionId: string | undefined,
  body: { summary: string },
  opts?: { sessionId?: string },   // 新增：一次性 X-Session-Id 覆盖（分身会话身份）
): Promise<Record<string, unknown>>;

// sillyhub-daemon/src/credential-injector.ts
export class PiCredentialInjector implements CredentialInjector {
  readonly agentKind = 'pi';
  toEnv(config: ProviderConfig): Record<string, string>;
  // api_key → env[config.auth_field ?? 'ANTHROPIC_API_KEY']
  // extra_env → 透传（空串值跳过）；其余字段（base_url/model/role_mappings/litellm_*）不映射
}
```

```python
# backend/app/modules/llm_provider/schema.py
class LlmProviderCreate(BaseModel):
    agent_kind: Literal["claude", "pi"] = "claude"
    auth_field: str = Field(default="ANTHROPIC_AUTH_TOKEN", pattern=r"^[A-Z][A-Z0-9_]*$")
    # Update / FetchModelsRequest 同款放宽（Update 各字段 None=不动）

# backend/app/modules/mcp_gateway/tools.py get_daemon_status 响应（纯增量）
{
  "workspace_id": ...,
  "daemon_online": ...,
  "daemon_name": ...,
  "stale_threshold_seconds": ...,
  "default_agent": "pi" | None,          # workspace.default_agent 原值
  "effective_agent": "pi" | None,        # default_agent ?? 首个 online daemon 的首个 online provider
  "daemons": [{ ..., "providers": [{"provider": str, "status": str, "version": str | None}] }],
}
```

## 7.5 生命周期契约表

本变更触碰 worker 子会话终态信号（关键词 session/daemon/complete 命中）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| turn result（PI success） | pi-rpc-driver | daemon.onTurnResult | runId, status=success, **result=轮终 assistant 全文** | run running → completed（backend close_interactive_run） |
| worker_done（daemon 代报） | daemon.onTurnResult（caps.mcp=false 门控） | backend `_worker_done_core` | X-Session-Id（分身会话）, summary=全文 | AgentSession.worker_done_at 置位；AgentArtifact(kind=summary) 新增；全分身完成→唤醒主控 |
| worker_done（agent 自报，既有） | 分身进程内 MCP server | 同上 | X-Session-Id, summary | 同上（本变更不动该路径） |
| lease claim（provider_config） | daemon | backend lease/context | agent_kind='pi' 的 9 字段中性 provider_config | pi 会话 spawn env 第 0 层注入（此前跳过） |

表内事件与 §6 清单一一对应（turn result→pi-rpc-driver 测试；worker_done 代报→daemon 测试；claim 注入→injector 测试）。缺项：无（session end 路径不改）。

## 8. 数据模型

零 DDL。`llm_providers.agent_kind`（String(32)）与 `auth_field`（String(64)）列宽本就容纳新值/任意 env 名，仅在 pydantic 层放宽值域；`AgentArtifact`/`AgentRun`/`agent_profiles`/`workspaces` 均不动。

## 9. 兼容策略（brownfield）

- 未创建 pi 凭证、workspace default_agent 不变时：claim 解析第三级（user 默认）查 `(user_id, 'pi', is_default)` 无行 → provider_config 缺省 → spawn-env 第 0 层跳过 → pi 会话行为与现状逐字一致（本机凭证）。
- claude 凭证：agent_kind 缺省 'claude'、auth_field 缺省 'ANTHROPIC_AUTH_TOKEN' 与既有值域兼容；pattern 同时覆盖旧两个字面量。
- daemon 自动 workerDone 仅 `caps.mcp===false` 触发：claude worker 自报路径与 artifacts 数量零变化；codex/cursor 等 mcp:false 分身从「artifacts 恒空」变为「daemon 代报 kind=summary」（它们今天物理上无法自报，变化方向=补齐缺失产出，无双写）；旧 daemon（无本逻辑）对新 backend 零感知，新 daemon 对旧 backend 的 worker_done 404/409 仅 warn。
- `get_daemon_status` 新增字段为 MCP dict 响应增量键，旧调用方（sillyspec 侧已按可选键消费）零破坏。
- api-types 再生成属类型层收紧放宽（Literal→联合扩员），不改既有字段形状。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 多轮 worker 会话每轮成功各 INSERT 一条 summary artifact，消费方取错旧条 | P1 | 消费方按 created_at 取末条（sillyspec 侧双通道提取已就绪）；get_worker_result 按 created_at 排序返回，工具描述已声明语义 |
| R-02 | PI turn result 补 result 后 result_summary 落库内容变大（全文截 500） | P2 | 既有截断逻辑（daemon.ts:3755-3760）不变，仅从空变有，是修复预期 |
| R-03 | pi 不支持 litellm_proxy 形态，用户误配 openai_chat+pi 期望网关池 | P1 | injector 忽略不注入（不写错误 BASE_URL）；交付文档明确边界与 models.json 替代法 |
| R-04 | auth_field 泛化为自由 env 名后误填（如小写/含空格）导致凭证注入静默失效 | P1 | backend pattern 校验 + 前端同 pattern 即时报错；injector 只认合法 env 名（与 backend 同形状校验） |
| R-05 | 工作树并发活跃变更（account-avatar-upload 波次执行中）导致 openapi/api-types 再生成混入其 schema 增量 | P2 | 生成物按当前后端代码整体再生成是正确一致态；提交说明中注明含 avatar 未提交端点的类型增量 |
| R-06 | daemon 代报 workerDone 与 agent 自报在 mcp 能力变更（pi 未来支持 MCP）时双写；codex/cursor 分身行为从恒空变有产出（消费方需知） | P2 | 门控绑定 caps 单源（providers.ts），任一 provider caps 翻 true 时代报自动停用；codex 侧产出语义与 pi 同（kind=summary 最新为终态），消费方双通道提取已兼容 |
| R-07 | 活体验收依赖远端部署环境（真派发回归）本机不可达 | P1 | 本变更以单测+类型门禁收口；活体回归口径与运维动作（default_agent=pi、建 pi 凭证）写入交付说明，留用户执行 |

## 11. 决策追踪

| 决策 | 覆盖 |
|---|---|
| D-001@v1（worker_done 通道 + kind=summary） | §5.1 全节、§6 pi-rpc-driver/hub-client/daemon 行、§7.5 表 2-3 行 |
| D-002@v1（开放 pi kind + injector，双作用域路都通） | §5.2 全节、§6 schema/injector/表单行、§7 接口定义 |
| D-003@v1（get_daemon_status 实时暴露） | §5.3 全节、§6 tools.py 行 |

未解决遗留：pi 的 litellm_proxy/自定义 baseUrl 形态（R-03，v1 显式不支持）；活体回归（R-07，用户执行）。

## 12. 自审

- 三问题验收口径逐一映射：P0-1 → §5.1 数据流终点即 get_worker_result artifacts 非空；P0-2 → §5.2 两用法即「本地配额耗尽时段平台派发仍能跑」的配置前提；P1-3 → §5.3 调用方可判 + 运维动作。
- 字段数据流核对：`result`（driver→daemon payload→backend output_redacted / workerDone summary→AgentArtifact.content_ref→get_worker_result content_ref）三跳全透传；`agent_kind='pi'`（schema→ORM 行→claim 解析→provider_config→injector→子进程 env）既有两跳零改动已核（context.py:284-343）；`providers`（daemon 注册→DaemonRuntime→get_daemon_status）全现成。
- 门控防双写核过：`_worker_done_core` 无 artifact 去重（每调用 INSERT），故 caps.mcp=false 门控是必须的而非优化。
- 唤醒语义核过：`is_worker_complete_from_active` 判据（worker_done_at + 无活跃 turn / 会话终态）与 turn 成功触发点对齐，无提前收敛风险。
- 生命周期契约表 4 事件均有代码/测试任务对应（§7.5 尾注）。
- 跨仓：无（sillyspec 侧明确不改）。
