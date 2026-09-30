---
author: qinyi
created_at: 2026-09-30 10:45:41
generated_by: sillyspec-design-init
scale: large  # 跨 backend/frontend/(轻)daemon 三端、含 schema 迁移与迁移门治理，需 Wave 编排 → run plan
---

# 设计文档（Design）— 2026-09-30-tool-report-activation-wrong-machine

## 背景

tool_report「本地 Agent 会话」（CLI 上报本地 harness 日志聚合，`origin='tool_report'`）在平台上继续对话时存在复合故障（服务器会话 473a8c37 实证）：

1. **错机派发**：懒激活路径（backend/app/modules/daemon/session/service/ppm_activation.py:266 `_activate_tool_report_session`）cwd 取上报的 `agent_cwd`（Windows 路径），机器走"心跳最新自选"（backend/app/modules/agent/placement.py `_query_online`）——本例选中 Mac mini，其上无 `C:/` 路径，daemon cwd 守卫（sillyhub-daemon/src/interactive-cwd-guard.ts:104）拒绝启动，run 秒败（error_code=interactive_interrupted）。
2. **会话钉死**：激活事务先提交 `status=active`+`turn_count=1`+`runtime_id` 钉死错误机器（ppm_activation.py:528-558），后续消息仍派发同机持续失败，UI 无换机入口。
3. **回放消失体感**：前端按 `turn_count>0` 把主体从「本地日志回放」切到「对话时间线」（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2538、:3838），历史收进默认收起的折叠栏，加上新轮秒败，用户体感"之前的信息全没了"。
4. **上下文断裂**：即使派对机器，激活也是**新开引擎会话**（zcode→claude 映射，backend/app/modules/platform_sync/service.py:103-113），原本地会话上下文完全不延续——claude-code 本可 resume 原引擎会话，zcode 无 adapter 回不去。

根因：上报链路不携带机器身份，派发与上报机器无关联；接手语义（resume/交接）未按引擎能力分档。

## 设计目标

- FR-01 上报链路携带机器身份（machineId + hostname）并持久化（platform_agent_logs）。
- FR-02 本地会话接手 = **分叉式**（D-006）：原会话永远只读回放；首条消息创建接手会话（fork 形态溯源）。
- FR-03 接手原机钉定派发（四级解析：machineId 精确 → hostname → cwd∈allowed_roots 唯一匹配 → 409 中文报错，不静默换机）。
- FR-04 引擎能力分档衔接：claude-code/codex → native 档 resume 原引擎会话；zcode 等无 adapter → handoff 档（用户可重选原机引擎+智能体档案，交接文档注入新会话首 prompt）。
- FR-05 存量钉死会话一键重置（端点 + 页面按钮，回退只读回放态）。
- FR-06 前端衔接状态 UI：衔接方式提示条（resume 绿/handoff 黄）、接手 agent 选择器、原机离线 409 错误卡、回放主体保持。

## 非目标

- 不做 CLI（sillyspec 仓）侧 machineId 生成与上报——跨仓变更另立，本变更平台侧协议就绪 + hostname 回落已覆盖现网。
- 不做交接文档的 LLM 总结——v1 确定性模板（目标/最近对话/涉及文件/最近操作），LLM 增强后续演进。
- 不做普通 chat 会话的换机/迁移——仅 tool_report 会话治理。
- 不做 daemon 新增 adapter（zcode 引擎接入）——handoff 档已覆盖其接手需求。
- 不改变现有 fork 端点（POST /sessions/{id}/fork）行为——接手是新端点，复用其内部基建。

## 拆分判断

单变更（不批量拆分）：六个 FR 围绕同一条接手链路（上报→匹配→分档→落库→UI），拆开会互相踩（协议字段与匹配逻辑、接手端点与前端状态机必须同版本落地）；backend/frontend/schema 迁移在一个 Wave 序列内按依赖排布。

## 总体方案

### Phase 1 · 上报机器身份（协议 + 落库）

`POST /api/platform-sync/agent-logs` entries 增加 `machine` 块（`machine_id?: str`、`hostname?: str`）。daemon 注入路径（hub_session_id 分支）由 daemon 自动附带自身 machine_id + hostname；CLI 直跑路径带 hostname（machineId 待 CLI 仓升级）。`AgentSessionLogORM` 加两列 `reported_machine_id`/`reported_machine_name`（nullable，老协议 extra=ignore 落 NULL）。会话聚合（find-or-create/upsert）时把最新 entry 机器身份写入会话 `config_snapshot.latest_reported_machine`（会话表不加列，匹配时按需读快照）。

### Phase 2 · 接手分派（takeover 服务，新端点）

新服务 `takeover.py` + 端点 `POST /api/daemon/sessions/{session_id}/takeover`（body: prompt 必填；handoff 档可带 provider/agent_profile_id/llm_provider_id）。流程：

1. **会话校验**：origin=tool_report、status=pending（未激活）、属主校验；已激活会话 409 指引重置。
2. **原机四级解析**（匹配函数 `resolve_takeover_runtime`）：① 最新 entry `reported_machine_id` 精确匹配在线 runtime → ② `reported_machine_name` 匹配 `daemon_runtimes.name`（在线）→ ③ 存量无机器信息按 `cwd ∈ runtime.allowed_roots` 匹配**唯一**在线机器（0 或 >1 台均失败）→ ④ 409 中文（含机器名与"开机/装 daemon"指引）。匹配后钉定 pinned 派发（复用 placement pinned 复查语义），离线竞态 4xx 不静默换机。
3. **分档**（harness → 档位）：harness ∈ {claude-code, codex}（caps.resume=True 且 platform_agent_logs.session_id 为引擎会话 id）→ **native 档**：lease metadata 携带 `resume_session_id`（复用 2026-08-29-batch-session-inherit resume 机制 + daemon 既有 resume 损伤降级）；其余（zcode 等）→ **handoff 档**：校验所选 provider ∈ 原机 runtime 支持集合（按 daemon_instance 聚合），经 daemon RPC `read_agent_log_messages` 读原会话归一化消息 → `build_handoff_prompt`（模板：会话元信息/目标/最近对话摘要（用户轮全文+助手轮截断）/涉及文件/最近操作，体积帽对齐 fork SEED_MAX_CHARS 惯例）→ 新会话首 prompt = 交接文档 + 用户消息；读取失败降级普通新会话（warning + 响应 `handoff_doc: false` 供前端提示）。
4. **落库**：经 create_session 链创建新会话（origin='fork' + `fork_of_session_id`=源 tool_report 会话 + fork 三件套，列表「分叉自」回链复用）；源会话零 run → `fork_at_run_id`/`engine_fork_anchor` 为 NULL（fork 三件套可空列，既有 create 链调用恒传实值，takeover 为首个 NULL 形态——溯源文案变体"接手自该本地会话"由前端按 fork_at_run_id NULL 分支渲染）；native 档源机钉定 = 匹配 runtime；handoff 档亦钉定匹配 runtime（与 fork seed 档"常规选机"的差异点，D-006）。
5. **原会话不动**：源会话保持 pending/turn_count=0，回放主体永不切走。

### Phase 3 · 激活分支退役 + 存量重置

- inject 端点（backend/app/modules/daemon/router/session_crud.py:621）对 pending tool_report 会话的懒激活分支（inject.py:216 → _activate_tool_report_session）**退役**：改返 409 + 指引文案（"请通过接手（takeover）继续该会话"）；`_activate_tool_report_session` 及其依赖收敛删除。
- 新端点 `POST /api/daemon/sessions/{session_id}/reset-tool-report`：对**存量已激活钉死**的 tool_report 会话执行回滚（校验 origin=tool_report、属主、无 running run；status=pending、turn_count=0、runtime_id/lease_id=NULL、失败 run 标记 `error_code` 前缀保留供审计），发布 sessions_changed 事件前端回放主体自动恢复。正常新会话永不进入需重置状态（D-006）。

### Phase 4 · 前端衔接状态（session-panel）

未激活 tool_report 会话输入区改造（session-panel-page.tsx 未激活分支 + page-helpers 派生）：

- **衔接提示条**：native 档绿色"接续原 <harness> 会话，派发到 <上报机器名>"；handoff 档黄色"分叉出新会话（分叉自本会话），交接文档注入"（数据源：GET /api/agent-logs?session_id= 最新 entry reported_machine + machines 列表在线态 join）。
- **接手 agent 选择器**（仅 handoff 档）：引擎下拉（原机 daemon 支持的 provider 集合）+ 智能体档案下拉，默认 harness 映射。
- **发送走 takeover 端点**，成功响应 `new_session_id` 后切换到新会话面板。
- **原机离线**：提示条红色 + 输入禁用（对齐案例③）。
- **存量重置按钮**：已激活（turn_count>0）tool_report 会话头部 ⋯ 菜单 + 失败轮快捷入口，确认弹窗（原型案例④）。

### Phase 5 · machineId 平台侧就绪（轻）

daemon 心跳协议（heartbeat 上报）增加 `machine_id` 字段落 `daemon_runtimes.metadata.machine_id`（本仓 sillyhub-daemon 小改）；daemon 注入路径上报自动附带。与 CLI 共享 machineId 的生成约定（`~/.sillyhub/machine-id`）写入协议文档，CLI 仓实现另立变更。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/schema.py | AgentLogUpsert entry DTO 加 `machine` 块。数据流：producer=CLI/daemon 上报 body → Pydantic 解析（extra=ignore 兜底老协议）→ consumer=service.py upsert 落列 |
| 修改 | backend/app/modules/platform_sync/service.py | upsert_agent_log_entries 落 `reported_machine_id/name`；会话聚合分支写 `config_snapshot.latest_reported_machine`（producer=entry.machine → consumer=takeover 匹配 + GET /agent-logs 响应） |
| 修改 | backend/app/modules/platform_sync/model.py | AgentSessionLogORM 加 `reported_machine_id`（varchar(64) nullable）/`reported_machine_name`（varchar(255) nullable）两列 |
| 新增 | NEW:backend/migrations/versions/2026xxxx_tool_report_machine.py | platform_agent_logs 加两列迁移（具体版本号随迁移链生成） |
| 新增 | NEW:backend/app/modules/daemon/session/service/takeover.py | 接手服务：resolve_takeover_runtime 四级匹配、native/handoff 分档、build_handoff_prompt 模板（体积帽）、fork 形态落库编排 |
| 修改 | backend/app/modules/daemon/session/service/fork.py | 抽取 fork 落库可复用段（fork 三件套/快照继承/源机钉定）供 takeover 调用——不改变既有 fork 端点行为 |
| 修改 | backend/app/modules/daemon/session/service/inject.py | 懒激活分支退役：pending tool_report 会话改 409 指引 takeover；删除 _activate_tool_report_session 调用 |
| 修改 | backend/app/modules/daemon/session/service/ppm_activation.py | `_activate_tool_report_session` 删除（随激活分支退役） |
| 修改 | backend/app/modules/daemon/router/__init__.py | 路由端点登记表加 takeover/reset 两端点（task-04/06 新路由的 _ENDPOINT_ORDER 不变量同步） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 新增 POST /sessions/{id}/takeover、POST /sessions/{id}/reset-tool-report 路由；inject 409 文案 |
| 修改 | backend/app/modules/daemon/schema.py | TakeoverRequest/TakeoverResponse/ResetToolReportResponse DTO。数据流：TakeoverRequest（prompt/provider?/agent_profile_id?/llm_provider_id?）producer=前端 → takeover service；TakeoverResponse（new_session_id/run_id/tier/handoff_doc）producer=backend → consumer=前端切会话与提示 |
| 修改 | backend/app/modules/daemon/session/service/helpers.py | 新增 reset_tool_report_session 回滚实现（复用 _publish_session_event/publish_sessions_changed） |
| 修改 | backend/app/modules/daemon/router/heartbeat.py | 心跳接收 machine_id 落 daemon_runtimes.metadata（Phase 5，daemon 心跳协议字段 producer=daemon → consumer=runtime metadata → takeover 一级匹配） |
| 修改 | sillyhub-daemon/src/daemon.ts + sillyhub-daemon/src/hub-client.ts | 随心跳附 machine_id（读/生成 ~/.sillyhub/machine-id，daemon 侧约定落地）；hub 注入路径上报自动附带 machine 块 |
| 新增 | NEW:docs/platform-agent-log-protocol.md | 协议文档（主仓新建，沉淀上报协议全量定义）：v2 增 entries.machine 块字段定义 + machineId 生成约定（~/.sillyhub/machine-id） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 未激活 tool_report 分支：衔接提示条/接手选择器/takeover 发送/原机离线态；已激活 tool_report 重置按钮 |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | takeover chrome 派生（提示条档位/选择器数据/禁用态） |
| 修改 | frontend/src/lib/agent-logs.ts | listAgentLogs 条目类型补 reported_machine 字段（gen:types 生成后对齐） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 重新生成（随 backend schema） |
| 修改 | frontend/src/lib/daemon/sessions.ts | takeover/reset-tool-report API 调用封装（原计划独立 takeover.ts，实现并入 sessions.ts——forkSession 同款先例，验收 QA 认定等价） |
| 修改 | backend/openapi.json | gen:types 生成物（随 schema 同步） |
| 新增 | NEW:frontend/src/components/daemon/session-panel/takeover-bridge-note.tsx | 衔接提示条独立组件（native 绿/handoff 黄+选择器/离线红，page 引用；独立组件化提升可测性） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_takeover.py | takeover 四级匹配、native/handoff 分档（task-04 核心档）、reset 回滚、inject 409 指引用例 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_takeover_handoff.py | handoff 档独立用例（交接模板帽/重选 422/降级，task-05 独立文件避免 W4 与 task-06 测试目录相交） |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_agent_log_machine.py | 协议 v2 machine 块解析落列、extra=ignore 兼容、config_snapshot 聚合用例 |
| 新增 | NEW:frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx | 衔接提示条档位、handoff 选择器数据、takeover 发送切会话、重置确认流用例 |

## 接口定义

```python
# takeover.py（核心签名）
async def takeover_session(
    svc, session_id: uuid.UUID, user_id: uuid.UUID, *,
    prompt: str, provider: str | None = None,
    agent_profile_id: str | None = None, llm_provider_id: str | None = None,
) -> TakeoverResult  # .agent_session(新会话) .agent_run .tier('native'|'handoff') .handoff_doc(bool)

async def resolve_takeover_runtime(sess, source: AgentSession) -> RuntimeHit
# RuntimeHit = (runtime_id, daemon_instance_id, match_tier) ；无果 raise ToolReportTakeoverNoMachine(409 中文含机器名)

def build_handoff_prompt(meta: HandoffMeta, messages: list[NormalizedLogMessage], user_prompt: str) -> str
# 纯函数；体积帽 HANDOFF_MAX_CHARS（对齐 fork SEED_MAX_CHARS 量级），超帽截尾保留较早内容 + 显式截断声明行
```

```python
# schema.py（DTO）
class TakeoverRequest(BaseModel):
    prompt: str
    provider: str | None = None          # handoff 档引擎重选（须 ∈ 原机支持集合）
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
class TakeoverResponse(BaseModel):
    session_id: uuid.UUID                # 新接手会话
    run_id: uuid.UUID
    tier: Literal["native", "handoff"]
    handoff_doc: bool                    # False=读取失败降级普通新会话
class ResetToolReportResponse(BaseModel):
    session_id: uuid.UUID
    status: Literal["pending"]
    cleared_runs: int
```

```python
# platform_sync/schema.py（上报 machine 块）
class AgentLogMachineBlock(BaseModel):
    machine_id: str | None = None
    hostname: str | None = None
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| takeover create session | 前端 | backend（POST /sessions/{id}/takeover） | prompt, provider?, agent_profile_id?, llm_provider_id? | 源会话不变；新会话 fork 形态创建（active） |
| takeover dispatch | backend | daemon（WS 唤醒 + lease） | lease_id, run_id, prompt, resume_session_id?（native）, cwd, runtime_id | lease pending → claimed |
| claim lease | daemon | backend | lease_id, claim_token | lease claimed；run pending → running |
| turn result | daemon | backend | run_id, status, output | run running → completed/failed |
| inject（pending tool_report） | 前端 | backend | —（请求被拒） | 409 指引 takeover（原会话状态不变） |
| reset tool_report | 前端 | backend（POST /sessions/{id}/reset-tool-report） | session_id | 存量会话 active → pending；runtime/lease 清空；失败 run 归档标记 |
| agent-log upsert | CLI/daemon | backend（POST /agent-logs） | entries[].machine?（新） | platform_agent_logs 落 reported_machine_*；会话聚合写 config_snapshot |
| daemon heartbeat | daemon | backend | machine_id?（新） | daemon_runtimes.metadata.machine_id 更新 |

表内每个事件对应任务：takeover create/dispatch（task 见 plan Wave2）、claim/turn result（既有链路零改动，回归用例覆盖）、inject 409（Wave2）、reset（Wave2）、upsert machine（Wave1）、heartbeat machine_id（Wave3）。

## 数据模型

- `platform_agent_logs` 加列：`reported_machine_id varchar(64) NULL`、`reported_machine_name varchar(255) NULL`（单迁移；无唯一约束——hostname 允许多条上报）。
- `agent_sessions` **不加列**：接手机器匹配读 `config_snapshot.latest_reported_machine`（Phase 1 聚合时写）+ 最新 entry 兜底；新会话 fork 三件套复用既有列（fork_of_session_id/fork_at_run_id/engine_fork_anchor）。
- `daemon_runtimes.metadata` 增键 `machine_id`（JSON 列无迁移）。

## 兼容策略（brownfield 必填）

- **老 CLI 上报**（无 machine 块）：Pydantic extra=ignore 既有行为落 NULL；takeover 走第③级 allowed_roots 匹配——与现网"两台在线机器"场景兼容（Windows 路径只匹配 Windows 机器白名单）。
- **未升级前端**（调 inject 激活）：409 + 中文指引文案（旧版提示明确，不裸 500）；takeover 端点为新增，旧客户端不感知。
- **存量已激活 tool_report 会话**：不迁移不自动处理——重置端点按需一键恢复（默认入口）；已正常激活使用的会话不受影响（inject 主路径零改动）。
- **fork 端点/API 零变化**：takeover 复用内部函数不改签名语义。
- **不改变的表**：agent_sessions/agent_runs/agent_run_logs/daemon_task_leases 结构不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | takeover 时原机在线、RPC 读日志竞态失败（daemon 掉线瞬间） | P1 | 读取失败降级普通新会话（handoff_doc=false 前端提示）；不阻塞接手主流程 |
| R-02 | hostname 匹配歧义（同 hostname 多机/改名） | P2 | 四级匹配②级仅匹配唯一在线同名机器，多台即 409 提示等 machineId；machineId 落地后①级根治 |
| R-03 | 交接文档超长（长会话全量消息） | P1 | HANDOFF_MAX_CHARS 帽 + 截断声明行（对齐 fork seed 先例） |
| R-04 | 生命周期表 inject 409 事件对旧前端的破坏面 | P2 | 文案显式指路 takeover；本仓前端同版本升级（未上线产品，规则 11 允许） |
| R-05 | 重置并发（running 轮中点重置） | P1 | reset 端点校验无 current_run，running 时 409 |
| R-06 | resume 损伤（原 transcript 已删/损坏）daemon 降级为 fresh 会话 | P2 | daemon 既有 resume_downgraded 机制（session-manager.ts:847-894），日志留痕；不额外拦截 |
| R-07 | allowed_roots 匹配级③的多台含同 cwd（挂载/同名目录） | P2 | 唯一匹配才放行，多台 409（宁拒不猜） |
| R-08 | 并发双 takeover（同一源会话双击/双端） | P2 | 源会话只读无锁竞争面，最坏产生冗余接手会话（不损数据）；plan 阶段评估源会话行锁防抖（可选增强） |
| 无长驻进程/外部资源，生命周期面不适用（takeover/reset 均为请求期操作，daemon 心跳改动为既有周期任务字段追加） | — | — | — |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01（Phase 1 协议+落库）、FR-03（Phase 2 四级钉定）、FR-05（Phase 3 重置）、Phase 5 machineId 就绪 | 已覆盖 |
| D-002@v1 | FR-03 / Phase 2 第④级（409 中文不换机）+ 前端案例③ | 已覆盖 |
| D-003@v1 | FR-05 / Phase 3 reset 端点+按钮（D-006 后收敛为存量兜底，备注已更新） | 已覆盖 |
| D-004@v1 | FR-04 / Phase 2 分档（native resume_session_id / handoff 交接文档） | 已覆盖 |
| D-005@v1 | FR-04 / Phase 2 handoff 档引擎+档案重选 + Phase 4 选择器 | 已覆盖 |
| D-006@v1 | FR-02 / Phase 2 分叉式接手（fork 三件套溯源、原会话只读）+ Phase 3 激活退役 | 已覆盖 |

多裁定组合推演（D-002 原机钉定 × D-006 分叉式 × D-003 重置）：

| 场景 | D-002 原机钉定 | D-006 分叉式 | D-003 重置 | 结果 |
|---|---|---|---|---|
| 新 zcode 会话接手 | 匹配原机 409/钉定 | 建 fork 会话 | 不涉及 | 一致 |
| 新 claude-code 会话接手 | 同上 | native 档 resume | 不涉及 | 一致 |
| 存量钉死会话 | 会话已钉错机 | 未激活路径不适用 | reset 退回 pending → 走接手 | 一致（reset 后回到分叉式入口） |
| 存量钉死且原机离线 | 匹配失败 409 | — | reset 仍可用（只读恢复），接手等原机 | 无死锁（回放可看，重试入口常在） |

无死锁格。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 ~ D-006@v1（决策追踪表全覆盖，无未解决项）
- [x] 涉及 session/lease/claim/heartbeat 关键词 → 生命周期契约表已含（7 事件×任务映射）
- [x] UI 原型分级核对：涉前端文件，prototype-tool-report-activation.html 已生成（四状态+接手选择器）
- [x] 文件清单 NEW: 前缀核验：7 处新建已标 NEW:（迁移、takeover.py、takeover.ts、协议文档、3 个测试文件）；字段数据流已标（machine 块、TakeoverRequest/Response、reported_machine_*）
- [ ] ⚠️ 自审存疑 1：daemon 心跳 machine_id 落 metadata 的心跳文件改动点（heartbeat.py 具体行号）在 plan 阶段核对——Phase 5 为低风险增强，若心跳协议改动面超预期可降级为"仅协议文档定义 + takeover ①级空实现"（fallback 不影响②③级现网可用）
- [ ] ⚠️ 自审存疑 2：handoff 档"涉及文件/最近操作"模板字段依赖归一化消息的 tool_call 提取完整性（zcode model-io 格式 tool 事件归一化覆盖度）——plan 阶段以真实日志样本验证字段可得性，缺字段时模板降级省略该节
