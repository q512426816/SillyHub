---
author: qinyi
created_at: 2026-09-07 10:20:00
scale: large
input_material: sillyspec 仓 docs/agent-liveness-derivation-design-draft.md（2026-09-07 实证回写版）
---

# 设计文档（Design）— Agent 会话活性状态推导

> 范围（D-001@v1）：P1 全量 a–e——daemon 推导器+自发现、backend 状态字段+上报端点+通知、frontend 徽章+聚合、claude/codex deriver 补齐、编排知情决策。P2（`agents status` 命令）在 sillyspec 仓另立变更，不在本期。
> 输入材料：sillyspec 仓 `docs/agent-liveness-derivation-design-draft.md`（三轮迭代 + E-02/E-03/E-08 实证回写版），其 D-001~D-012 决策链作为本设计前提；本变更用户决策见本目录 `decisions.md`（D-001~D-003）。

## 1. 背景

平台对本地 agent 会话的感知止步于**登记**（CLI 在 `sillyspec run` 入口上报日志路径与元信息，daemon 按需拉取解析做对话化渲染），回答不了"这个 agent 此刻是活的还是死的、在干活还是在等我"：进度只在 `--done` 推进（卡住 20 分钟进度纹丝不动）；agent 卡在权限确认等人时无信号离开本机；登记只发生在 CLI 调用入口，卡在首次调用之前与会未接流程的裸 agent 会话永远不上册。多会话并行场景下"切来切去找哪个卡住了"是真实痛点。

2026-09-07 三项实证已为方案定形：

- **E-08**：daemon 第一方权限管线（canUseTool/sessionPermission → `PERMISSION_REQUEST` → 待审 + 5min timer）覆盖 scan 型 claude 与 codex（"两桥等价"）；chat 型/批量 worker/pi 不等人（自动放行/批准/取消）；zcode 不在 interactive 3 / 批量 12 provider 名单——**托管会话不存在"第一方管线外的等人"**。
- **E-03（证伪）**：zcode model-io 记录 `type` 仅 `model_io`（纯模型请求/响应对），无 CLI 交互层事件 → zcode 永久 L0+working/idle，不承诺 blocked；附带实证会话文件会因上下文压缩**中途轮转/消失**、subagent 有独立文件（`model-io-sess_subagent_agent_*` 前缀）。
- **E-02**：codex 本机 136 文件 / 13822 条 `event_msg` 全清单（18 型）无 approval 类，根因＝`approval_policy="never"`——本机 codex 无 blocked 场景；`task_complete`/`function_call` 配对/`token_count` 心跳均可做 working/idle 证据。

由此确立本设计的两条主线：**活性（working/idle/ended）走 daemon 日志 tail 推导**；**blocked 以第一方权限事件为主源**（D-012 优先级：第一方 > 日志推导，禁止两套语义并行），日志推导 blocked 仅剩裸 claude CLI 候选（E-01，本期实证，D-002@v1）。

## 2. 设计目标

- **G-1 实时活性状态**：平台会话/变更视图展示每个**托管** agent 会话（daemon 自发现，含未跑 SillySpec 流程的裸会话）的活性状态（working / blocked / idle / ended / unknown），状态变化 ≤10s 可见。
- **G-2 blocked 主动通知**：agent 进入"等人"超阈值未消解 → 站内通知（type=`agent_blocked`），与既有 PERMISSION_REQUEST 待审 5min timer 同源汇聚去重。
- **G-3 状态落库可查**：`platform_agent_logs` 行携带 `state`/`state_derived_at`/`state_evidence`/`last_event_at`，历史可回溯；自发现裸会话可被 create 入库（origin=`liveness-discovered`）。
- **G-4 编排知情决策（P1e）**：`list_workers` 在 worker running 期间附 liveness——blocked 超阈值升级给人（不 kill），working 无进展再等（不抢跑 kill）。
- **G-5 既有链路零回归**：CLI 上报契约零变更；tailer 故障不影响登记与对话视图（fail-open）。

## 3. 非目标

- 不做 PTY 常驻 / 终端复用 / 屏幕扫描（Herdr 路线，草案 D-001）。
- 不改日志上报主契约：CLI 仍只上报路径与元信息，不上报内容、不新增常驻（草案 D-005）。
- 不做 pane 粒度编排；不做 blocked 自动批准（只升级给人，D-010；自动批需 workspace 级开关+审计留痕，另立评估 E-07）。
- 不含 `agents status` CLI 命令与协议文档 §8 定稿（P2，sillyspec 仓另立变更）。
- 不含 Herdr interop / 模式 B' 状态上行（P3 缓议）。

## 4. 拆分判断

单变更而非拆多个：P1a–P1e 共享同一状态模型与推导规则，拆开会导致接口先行方（daemon）与消费方（backend/frontend）跨变更对齐成本高于一次做完；规模 large 走完整四件套。与 sillyspec 仓的唯一交点（P1e 派发模板改写）经 local.yaml `repos: sillyspec` 跨仓段管理。

## 5. 总体方案

### 5.1 状态模型与推导规则（跨仓契约的本地实现）

5 态：`working` / `blocked` / `idle` / `ended` / `unknown`。与任务态（stage/step）正交。规则分两层：

- **L0（mtime 兜底，全 format）**：mtime ≤120s → working；120s–15min → idle；>15min 或文件不存在 → ended。
- **L1（事件级，per format）**：
  - zcode（E-03 实证 schema）：末行 `completedAt` ≤ QUIET_MS → working；末行 `response.toolCalls` 非空且无后续行 → 工具执行中（working）；**不承诺 blocked**。
  - codex（E-02 实证词汇表）：`task_complete` → idle；`function_call` 无配对 `function_call_output` → working；**不承诺 blocked**（本机无场景）。
  - claude：assistant 含 `tool_use` 无 `tool_result` → working；assistant 纯文本 → idle；blocked 视 **E-01 实证**（证伪即定稿关闭，D-002@v1）。
- **铁律 R-01**：blocked 必须正向证据，绝不以"没动静"推断；**R-02**：deriver 异常 → 本轮 `unknown`，不影响登记链路。
- **状态源优先级（D-012）**：blocked ＝ 第一方 `PERMISSION_REQUEST` 事件（daemon 既有管线）> 日志推导；两源同段去重（dedupe_key 含 blocked 段序号）。

### 5.2 P1a — daemon 推导器与自发现

- **自发现三层数据源**：①运行期 spawn 记录（harness + cwd + `SILLYHUB_SESSION_ID`）；②重启恢复 `sessions.json`（`PersistedSessionRecord` 含 provider/cwd/lastActiveAt）；③兜底窗口重扫（sessions.json 缺失/损坏或 batch worker 未落盘时，按 mtime 15min 内重扫布局目录）。SillySpec 登记（`platform_agent_logs` 落库行）作为 ctx 增强源并入 watch list，按 `(workspace, log_path)` 汇聚去重。
- **日志定位两档**：claude/pi 目录名由 cwd 确定性编码 → 直算路径（先行）；codex（uuid 文件名）/zcode（rollout 目录全局共享）→ 窄扫 + 首行/workdir 标记匹配（随后）。布局规则自 sillyspec `src/agent-session-log.js` JS 实现移植。
- **tailer**：周期 10s；每路径 stat size 与上次 offset 差量续读；size 变小或文件消失（**E-03 实证：上下文压缩即换文件**）→ offset 重置 + 证据标记 `reset`，消失超窗 → ended；subagent 文件（`subagent_agent_*` 前缀）记从属。并发上限：watch ≤16（`last_seen_at` 新者优先），单轮字节预算 4MB。
- **deriver 注册表**：`agent-log/liveness/` 子层，签名 `(tail, prev, now) => { state, evidence }` 纯函数，与既有 parser 注册表同构；每 deriver 带 fixture 单测。

### 5.3 P1b — backend 落库、端点与通知

- `platform_agent_logs` 增列 `state`（String(16)）/ `state_derived_at`（DateTime）/ `state_evidence`（String(200) 短摘要）/ `last_event_at`（DateTime，前端静默时长数据源）；alembic 迁移；upsert 键不变，旧行无状态显示 unknown。
- 新端点 `POST /api/agent-logs/states`（批量）：daemon 鉴权通道（与 `/api/agent-logs` 同规则分流），body 仅枚举级数据。**upsert 含 create 语义**：自发现的新会话（裸 agent）可能尚无落库行（登记只发生在 CLI 调用入口），对不存在的 `(workspace_id, log_path)` 按 entry 携带的最小元信息（harness / format / session 短 id / agent_cwd）create 行，origin 标 `liveness-discovered`，后续 CLI 登记到达时按既有键 upsert 融合（ctx 增强不覆盖状态列）。
- 通知：type `agent_blocked`，blocked 持续 ≥120s 未消解触发；与既有 5min auto-deny timer **同源分级**（120s 轻提醒 / 5min 自动拒绝照旧）；消解后再次进入视为新段。

### 5.4 P1c — frontend（D-004@v1：小灯+悬浮卡，两层展示）

- **会话列表**：每行**行尾加一个 ~18px 状态小灯**（颜色区分五态、工作/阻塞带呼吸闪烁），**不新增列**、不改列表布局；鼠标悬停弹出小卡片（状态全名 / 静默时长 / 关联 change_key|quick_id / 证据摘要 / 推导时间）。
- **工作台首页**：新增「Agent 状态总览」卡片——按状态分组计数（在干活 N / 在等人 N / 空闲 N / 已结束 N），"在等人"组列出会话名 + 等待时长 + 跳转入口（完整信息在这里总览，不挤会话列表）。
- **会话视图 agent 日志面板**：逐行状态徽章 + 推导时间（骨架不变，组件级增量）。
- idle 未读小红点＝`working/blocked → idle` 转移边 + 视图已读状态（D-006）。
- `agent_blocked` 通知渲染与跳转。原型：`prototype-agent-liveness-states.html`（双主题、五态、悬浮卡与总览卡片演示）。

### 5.5 P1d — deriver 补齐

codex deriver（E-02 词汇表规则）+ claude deriver（**E-01 已证伪定稿（2026-09-07，160 transcript 实证：无等待审批事件类型）——只实现 working/idle 规则（tool_use 未配对→working / 纯文本→idle），blocked 分支关闭，日志推导 blocked 全线不承诺**，D-002@v1 处置生效）。

### 5.6 P1e — 编排知情决策

backend `list_workers`（`app/modules/agent/mcp_tools.py`）返回值 worker 增 `liveness` 字段（running 期间附 state+evidence；daemon 推导结果经既有 mission/worker 状态上报链路汇入）；sillyspec 仓派发模板「终态轮询 + 超时 kill lease」指令段改写：blocked 超阈值 → 升级给人（通知+待办）不 kill；working 久无终态 → 按既有超时再等不抢跑。

## 6. 文件变更清单

### 主仓（multi-agent-platform）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/agent-log/liveness/types.ts | LivenessState 枚举 / DeriverInput/Output / Evidence 类型（interface 定义见 §7） |
| 新增 | sillyhub-daemon/src/agent-log/liveness/registry.ts | format → deriver 注册表（仿 `agent-log/registry.ts` 扩展点模式），导出 `getDeriver(format)` |
| 新增 | sillyhub-daemon/src/agent-log/liveness/derive-zcode-model-io.ts | zcode deriver：E-03 实证规则（completedAt 新鲜 / toolCalls 未配对 → working；无 blocked） |
| 新增 | sillyhub-daemon/src/agent-log/liveness/derive-codex-rollout.ts | codex deriver：E-02 词汇表规则（task_complete→idle / function_call 配对差分→working；无 blocked） |
| 新增 | sillyhub-daemon/src/agent-log/liveness/derive-claude-code.ts | claude deriver：tool_use 未配对→working / 纯文本→idle；blocked 分支 E-01 门控 |
| 新增 | sillyhub-daemon/src/agent-log/liveness/tailer.ts | 周期 10s 循环：offset 差量读 / reset / ended 回收 / watch≤16 / 4MB 预算 / R-02 fail-open |
| 新增 | sillyhub-daemon/src/agent-log/liveness/discovery.ts | 自发现三层数据源 + 两档定位（直算/窄扫）；布局规则自 sillyspec JS 移植 |
| 新增 | sillyhub-daemon/tests/agent-log/liveness/*.test.ts | 每 deriver fixture 单测 + tailer 轮转/预算/fail-open 测试 |
| 修改 | sillyhub-daemon/src/daemon.ts | tailer 生命周期挂接（启动/优雅停止；独立 try 包裹，崩溃不影响主循环） |
| 修改 | sillyhub-daemon/src/hub-client.ts | 三职：①批量上报 `POST /api/agent-logs/states`（producer=tailer 推导结果 → hub-client HTTP（daemon 鉴权）→ consumer=backend platform_sync router；字段见 §7）；②周期 `GET /api/agent-logs` 拉登记落库行作 watch list 增强源（FR-02 双源汇聚的登记侧摄取通道，现无此读取方法需新增）；③**第一方 blocked 源并入（D-012）**：推送某会话 states 时，若该会话存在未消解的 PERMISSION_REQUEST（daemon 内存 `_resolversBySession` pending），blocked 优先取第一方事件证据，日志推导不重复判定 |
| 修改 | backend/app/modules/platform_sync/model.py | `AgentSessionLogORM` 增 `state`/`state_derived_at`/`state_evidence`/`last_event_at` 四列；states 端点 upsert-create（origin=`liveness-discovered` 行由元信息 create，producer=daemon → consumer=前端 GET agent-logs 响应） |
| 新增 | backend/migrations/versions/<rev>_agent_liveness_states.py | 四列迁移（alembic 实际目录为 backend/migrations/versions/，非 alembic/） |
| 修改 | backend/app/modules/platform_sync/schema.py | `AgentLogStatePush`/`AgentLogStateEntry` 请求模型 + 列表响应模型增状态字段（producer=daemon → schema 反序列化 → consumer=前端 api-types） |
| 修改 | backend/app/modules/platform_sync/router.py | `POST /agent-logs/states`（批量 upsert + 状态转移检测 → 触发 agent_blocked 通知）；GET agent-logs 响应透传状态三字段 |
| 修改 | backend/app/modules/platform_sync/service.py | 状态 upsert / 转移检测（进入 blocked 时间戳记段）/ dedupe 段计数 |
| 修改 | backend/app/modules/notification/（model/schema/service/events） | 新 type 值 `agent_blocked`（model.type 为 String(40) 存量自由值，无迁移；渲染模板 + Redis 推送复用既有通道） |
| 修改 | backend/app/modules/agent/mcp_tools.py | list_workers 返回值增 `liveness`：producer=daemon 推导 → worker 状态上报链路汇入（orchestrator.py/mission_context.py 汇入点由 spike-01 实调定位，按需并入 task-12 allowed_paths，design 不预列路径；链路过重则降级 backend 直查 platform_agent_logs，R-03）→ consumer=list_workers MCP 响应 + 派发模板 |
| 修改 | frontend/src/components/agent-log/（面板组件 + types.ts） | 逐行状态徽章 + 推导时间（consumer；api-types 重新生成后接线） |
| 修改 | frontend/src/lib/api-types.ts + backend/openapi.json | `pnpm gen:types` 重新生成并同步提交两文件（后端 schema 改动后强制，规则 21） |
| 修改 | frontend/src/components/（会话列表行状态小灯+悬浮卡 / 工作台「Agent 状态总览」卡片 / 通知渲染） | D-004 两层展示：列表行尾 ~18px 状态点（不新增列，hover 弹详情卡）+ 工作台总览卡片（分组计数+等人跳转）（原型对照）+ agent_blocked 通知卡 |
| 新增 | backend/app/modules/platform_sync/tests/（test_agent_liveness_states_migration.py / test_agent_log_states_push.py）+ backend/app/modules/notification/tests/test_agent_blocked_notify.py | task-07/08/09 对应测试：迁移升降级 / states 端点 upsert-create 与鉴权 / agent_blocked 阈值与段级 dedupe |

### sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/dispatch/backends/sillyhub-mcp.js | 「终态轮询 + 超时 kill lease」指令段改写（纯指令模板文本，非执行逻辑）：blocked→升级给人不 kill、working→再等；consumer=编排 agent 的轮询决策规则。producer=backend list_workers 新增 liveness 字段（跨仓契约在指令段内说明字段语义） |

## 7. 接口定义

```typescript
// daemon — liveness/registry.ts
type LivenessState = 'working' | 'blocked' | 'idle' | 'ended' | 'unknown';
interface DeriverInput { tail: string; prev: { state: LivenessState; offset: number } | null; now: number; }
interface DeriverOutput { state: LivenessState; evidence: string }  // evidence 如 'last_event=model_io' / 'PERMISSION_REQUEST(write)'
type LivenessDeriver = (input: DeriverInput) => DeriverOutput;
function getDeriver(format: string): LivenessDeriver | null;  // null → L0 only
```

```python
# backend — POST /api/agent-logs/states（daemon 鉴权通道，与 /agent-logs 同分流）
class AgentLogStateEntry(BaseModel):
    log_path: str
    state: Literal['working', 'blocked', 'idle', 'ended', 'unknown']
    evidence: str = Field(max_length=200)
    derived_at: datetime
    last_event_at: datetime | None = None        # 最后日志事件时间——前端"静默时长"数据源（≠derived_at，后者每轮刷新）
    # 以下仅在落库行不存在时用于 create（X-001，自发现裸会话）
    harness: str | None = None
    format: str | None = None
    agent_session_id: str | None = Field(default=None, max_length=64)
    agent_cwd: str | None = None
class AgentLogStatePush(BaseModel):
    entries: list[AgentLogStateEntry]   # 批量 ≤64
# 响应：2xx 即成功（best-effort，daemon 不读 body；upsert 键 (workspace_id, log_path) 沿用）
```

```python
# backend — list_workers worker 增量字段（P1e）
worker.liveness: { 'state': LivenessState, 'evidence': str, 'derived_at': datetime } | None  # running 期间非空
```

```
Notification type=agent_blocked：
  dedupe_key = f'{session_ref}:blocked:{段序号}'   # 同一段只发一次
  payload = { harness, session 短 id, ctx(change_key|quick_id), 等待时长, 待审记录 ref }
  阈值 BLOCKED_ALERT_MS=120s（常量起步）；与既有 5min auto-deny 分级（120s 提醒 / 5min 拒绝）
```

## 7.5 生命周期契约表

本变更核心即 `platform_agent_logs` 行的 liveness 状态机（既有登记/权限事件为存量，新增事件标注★）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| register agent log（既有） | sillyspec CLI | backend | workspace, log_path, harness, format, ctx | 行 upsert（无状态 → unknown 视图默认） |
| spawn session（既有） | backend | daemon | sessionId, provider, cwd, SILLYHUB_SESSION_ID | daemon 托管事实（自发现数据源①） |
| ★ watch join | daemon liveness | daemon tailer | workspace, log_path, format, 来源(自发现/登记) | 进入 watch list，offset=0 起读 |
| ★ liveness tick（10s） | daemon tailer | backend `/agent-logs/states` | log_path, state, evidence, derived_at, last_event_at?（行不存在时附 harness/format 等元信息 create） | 行状态列 upsert-create + 转移检测（→blocked 记段时间戳） |
| permission request（既有） | daemon | backend/前端 | request_id, toolName, sessionId | blocked 第一方源：进入待审 → 行状态 blocked |
| permission resolve（既有） | 前端/5min timer | daemon | request_id, decision(allow/deny) | blocked 消解 → 待下一条日志事件定 working/idle |
| ★ blocked alert | backend 转移检测 | Notification/Redis | dedupe_key(session,段序号), 等待时长 | blocked 持续 ≥120s → agent_blocked 通知（每段一次） |
| ★ watch end | daemon tailer | daemon | log_path, reason(ended/rotation) | 移出 watch list；行状态定格 ended（rotation → 重扫后重新 join） |
| ★ worker liveness 字段 | backend mission 链路 | list_workers 消费方 | worker_id, liveness{state,evidence} | running 期间附加；blocked 升级/working 等待由派发模板决策 |

## 8. 验收标准（草案，plan 细化）

- 派发 zcode 会话后平台视图 10s 内出状态；**裸 agent 会话（全程不调 sillyspec）同样 10s 内出状态**（自发现回归项）。
- 人为制造 scan 型确认等待 → agent_blocked 通知在阈值+10s 内到达；空闲会话**不得**产生 blocked 通知（R-01 回归）。
- tailer 崩溃不影响 `read_agent_log_messages` 与登记链路（R-02 回归）。
- worker 卡确认时 `list_workers` 可见 blocked 且升级非 kill；长任务（日志持续增长）不被抢跑 kill。
- E-03 场景回归：zcode 会话上下文压缩换文件后，tailer 经 reset/重扫恢复跟踪不串台。
- 前端：`pnpm gen:types` 通过，api-types 与后端 schema 同步提交。

## 9. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Windows 下周期增量读的文件共享冲突（agent 写 / daemon 读，E-04） | P1 | 读失败本轮跳过（fail-open R-02）；既有 read RPC 同机读实践证明风险低 |
| R-02 | 会话文件中途轮转/消失（E-03 已实证为常态而非边缘） | P0 | size 变小/消失 → offset 重置 + `reset` 证据标记；窗口重扫兜底重新 join；`session_id` 变化视为新会话 |
| R-03 | worker liveness 汇入 mission 状态链路的具体通道未实调（orchestrator/mission_context 结构 75 天 scan 漂移） | P1 | plan 阶段首任务实调定位汇入点；若链路过重，降级为 backend 侧直接查 `platform_agent_logs` 最新状态（daemon 同机推导已落库） |
| R-04 | E-01 证伪（裸 claude transcript 不记 permission） | P2 | 如实定稿关闭日志推导 blocked；托管 Claude 不受影响（第一方管线）；无阻塞 |
| R-05 | blocked 通知与既有 5min auto-deny 的体验重叠（双提醒打扰） | P1 | 同源汇聚：120s 提醒引用待审记录 ref，5min 拒绝后自动消解；dedupe_key 段级去重 |
| R-06 | 自发现窄扫（codex uuid/zcode 共享目录）误挂他会话日志 | P1 | 首行/workdir 标记匹配 + cwd 归属判定（移植 sillyspec 探测器既有防串台逻辑）；误挂仅多 watch 一行，R-01 语义不受损 |
| R-07 | scan 基线漂移 2054 commit/75 天，模块文档可能失锚 | P2 | 本会话已对 daemon interactive/adapters/backend platform_sync/notification/agent mcp_tools 做一手实读，文件清单以源码为准；execute 前按 plan 复核 |

## 10. 决策追踪

- **D-001@v1（范围=P1 全量 a–e）**：覆盖 §5.2–§5.6 全部 Phase 与文件清单。
- **D-002@v1（E-01 纳入本期）**：覆盖 §5.5 claude deriver 门控与 R-04。
- **D-003@v1（方案 1：daemon 自发现+日志推导+第一方汇聚）**：覆盖 §5.1/§5.2 总体架构与 §7.5 生命周期契约。
- **D-004@v1（状态展示两层：列表小灯+悬浮卡 / 工作台总览卡片）**：覆盖 §5.4 前端两层展示与 FR-05。
- 输入材料草案 D-001~D-012（sillyspec 仓）作为设计前提整体采纳，其中 D-012（第一方>日志推导）经 E-08 实证强化为本设计 §5.1 状态源优先级。
- 无未解决决策；R-03 汇入点细节留 plan 阶段实调（非用户决策）。

## 11. 自审

- 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/验收/风险/决策追踪 ✓。
- 生命周期契约表：涉及 session/daemon/state transition 关键词，表已给出（9 事件，新增 5 个★，均有对应文件清单任务）✓。
- 跨仓写法：sillyspec 仓段头 `## sillyspec 仓变更`，repo-key 已在 local.yaml `repos:` 注册，段内路径相对仓根（`src/dispatch/...`）✓。
- 数据流标注：states 端点、状态三列、liveness 字段、agent_blocked 通知的 producer→consumer 链路均已在清单说明列交代 ✓。
- UI 原型：`prototype-agent-liveness-states.html` 已生成（组件级变化-建议生成档）✓。
- ⚠️ 自审存疑一：R-03（worker liveness 汇入通道）为设计层留白，已按降级路径（backend 直查落库状态）兜底，plan 首任务实调收口。
- ⚠️ 自审存疑二：`agent/model.py` 的 `Notification.type` 为 String(40) 自由值，新 type `agent_blocked` 判断无需迁移——若 schema 层有 Literal 校验需同步（execute 时核对 `notification/schema.py`）。
