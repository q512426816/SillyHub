---
author: qinyi
created_at: 2026-09-12
change: 2026-09-12-chat-turn-auto-recovery
scale: large
---

# 设计文档（Design）— 聊天轮上游故障自动恢复（断流/限额/静默中断）

> v3（Grill 两轮+Plan 审查修订）：吸收 P0-1（inject 签名伪命题——auto_resume_of 属
> _inject_into_session，inject_session_as_service 须加参转发）/P0-2（Stream
> ended without finish_reason 不命中任何规则——补断流关键词）/P1-3~6/P2-7~12。

## 1. 背景

生产实证（阿里云 postgres agent_runs/agent_run_logs，会话 d4c29d95，pi 引擎 +
智谱 GLM-wp/glm-5.3，2026-09-11）：聊天轮因上游故障中断 7+ 次，全部需用户手动
发「继续」恢复。三类形态与根因：

| 形态 | 实证 | 当前行为 | 缺口 |
|---|---|---|---|
| 断流/超时 | `Stream ended without finish_reason`×8、pi rpc 30s×1，error_code=interactive_interrupted，error_detail 全 `{"type":"unknown","retryable":false}` | 轮报错收敛，等下一条用户消息 | classifier D-001(2026-07-29) 仅 claude；规则体无断流关键词（「Stream ended without finish_reason」八类均不命中）；后端无自动恢复钩子（auth-transient 钩子只认 401 文案） |
| 额度耗尽 | GLM 429 code 1308「已达到 5 小时的使用上限。…将于 2026-09-12 10:03:59 重置」，error_detail raw 含重置时间但无人解析 | 同上 + 提示只有「运行失败」 | resetAt 不在协议里；恢复时间信息丢失 |
| 静默中断 | 22:36/23:52 两轮：THINKING/TOOL_RESULT 后流断、无报错、pi 照常 agent_settled、run 收敛 **completed**（output_redacted 是中间消息） | 完全不可见——状态与正常完成无差别 | daemon 收敛点不校验「轮尾是否有收尾 assistant 全文」 |

相邻基建不覆盖本场景：2026-09-10-auto-resume-interrupted-turn（已合 main
ba57735d3）只触发 daemon_restarted；ql-20260903-011 `_maybe_autoretry_auth_
transient_turn`（close_run_steps.py:609）只认 claude CLI 合成 401 文案。本变更
把两者之间的三个空白面补齐。

## 2. 设计目标

1. 三类中断自动恢复，用户不再手动「继续」：瞬时故障秒级自愈、限额到点自动
   续跑（可取消）、静默中断被发现并续跑。
2. 安全：不重复执行已落地副作用（干净轮才重放原 prompt）；不产生自动恢复
   风暴（双层链上限）；全路径可关（复用 9-10 开关）。
3. 可观测：错误卡明示「自动重发中 / 将于 XX:XX 自动继续」；自动续跑条目在
   定时消息列表可见可取消。

## 3. 非目标

- codex / cursor 的静默中断检测（driver 收敛语义不同，另立变更）。
- 群聊影子会话、worker 分身、daemon 重启恢复（既有覆盖）。
- 空 user_input 轮的处理（历史形态，无任务可恢复）。
- pi CLI 进程内重试策略（daemon 不改 pi 内部行为）。

## 4. 拆分判断

单变更：三类中断共享同一恢复骨架（close 钩子 + origin 链 + 排队/定时派发），
拆开会导致守卫逻辑三处复制。daemon 信号（FR-1/2）与 backend 恢复（FR-3/4）、
frontend 提示（FR-5）三层在 plan 阶段按 Wave 切分。

## 5. 总体方案

```
上游故障（断流/超时/限额/静默）
  └─ daemon SessionManager.onResult
       ├─ classifyModelError（泛化后）：结构化 type + retryable + resetAt   ← FR-1
       ├─ pi driver 收敛点：轮尾无收尾全文 → 合成 error result              ← FR-2
       └─ notifyRunResult（error 含 reset_at）→ backend close_interactive_run
            └─ _close_post_commit → maybe_auto_recover_failed_turn           ← FR-3
                 ├─ 瞬时+干净轮 → 排队消息 origin=auto_resume:<rid>（原prompt）
                 ├─ 瞬时+工具活动 → 排队消息（续跑 nudge）
                 └─ quota+reset_at → 定时消息 origin=auto_resume:<rid>
                                      （dispatch_at=reset_at+120s，nudge）    ← FR-4
                      （两路派发均带 G10 超越守卫 + auto_resume_of 打标）
                           └─ 前端错误卡三分支提示 + 定时列表徽标             ← FR-5
```

### 5.1 daemon：归类器泛化 + resetAt（FR-1）

`classifyModelError`（sillyhub-daemon/src/model-error/classifier.ts）：

- 移除 D-001(旧)「agent 非 claude → unknown」门控；`classifyClaude(blob)` 更名
  `classifyBlob` 成为唯一规则体。`agent` 参数保留（日志归因），不参与分支。
- 规则体两处修订：
  1. **断流关键词（Grill P0-2）**：provider_error 规则体（第 7 优先级）补
     `stream[\s_-]?ended|without[\s_-]?finish[\s_-]?reason|stream[\s_-]?truncat
     |silent[\s_-]?stream|输出流中断|流中断`——主实证 ×8 的
     `Stream ended without finish_reason` 从 unknown 归入 provider_error
     （retryable=true）。pi rpc 超时文案 `response timeout` 命中既有 timeout
     规则（第 4 优先级），无需新增。
  2. 其余七条规则原文不动（429 优先、auth/model_not_found/network 顺序不变）。
- `extractResetAt(blob)`：仅 quota_exceeded 命中时调用；**只解析 GLM 中文格式**
  `将于\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*重置`（实证格式，按北京
  时间固定标注 +08:00——GLM 1308 文案与北京时间一致）；**英文变体不解析**
  （无时区信息的英文时间不做时区猜测，返回 null 退化为不排期——Grill P2-11
  收窄）。解析失败 → null。
- `ModelError`（types.ts）+ `resetAt: string | null`；claude 归类行为唯一
  变化=断流关键词从 unknown 修复为 provider_error（属修复目标，非回归）；
  pi/codex/cursor 从恒 unknown 变为真实归类。

### 5.2 daemon：pi 静默中断检测（FR-2）

pi-rpc-driver.ts 轮循环（与 `turnFinalText` 同簇的轮级状态）。标记更新收口在
**message_end 边界**（Grill P2-12：pi-events.ts:347-368 按 content 序产事件，
[text,thinking] 排列的健康轮若按事件粒度翻转标记会误报）：

```ts
let lastWasFinalText = false;   // 每 inject 重置
// ── 标记翻转两个入口（Grill v2 P1-1/P1-2 定稿）──
// ① raw message_end 拦截处（与 usage 累计钩同位，pi-rpc-driver.ts:1289-1307
//    先例）：按 endMsg content parts 是否含非空 text part 得 hasText →
//    lastWasFinalText = hasText。message_end 边粒度收口——同消息 [text,thinking]
//    排列（pi-events.ts:347-368 按 content 序产事件）终值正确为 true。
// ② 归一化事件循环内仅 tool_result 事件翻 false（工具结果之后尚无新消息 =
//    轮尾非全文）；thinking / override text / partial text 事件一律不动标记
//    （thinking 与 override 同产自 message_end，已由 ① 按整消息收口）。
//    （error 事件不动标记——pendingTurnError 路径优先）
// settle 收敛处（pendingTurnError===null 分支）：
//   if (!lastWasFinalText)
//     → reportTurnResult({ subtype:'error_during_execution', is_error:true,
//         result:'[silent stream truncation] 上一轮输出流中断，未产生收尾回复',
//         ...usage/modelUsage 照常带 })
//   否则维持既有 success 上报。
//   （判定只剩 !lastWasFinalText 一条：零活动轮（无事件无 api 调用）标记
//    恒 false → 命中报错；usage-only 轮同样命中；turnApiCallCount/
//    turnHadActivity 不再参与判定，仅留日志观测。）
```

- 判定仅 `!lastWasFinalText`（Grill v2 P1-1）：零活动轮（无事件且 api=0，
  注入后毫无响应=异常）、usage-only 轮（有计费调用无事件）标记恒 false →
  均命中报错。空载荷轮在 E1（payload 空跳过）不产生 result，不受影响。
- 合成 error result 经 session-manager 既有 `classifyModelError`（events.ts:
  96-104）归类生效——driver 不直接挂 modelError（会被覆写，Grill P2-8）；归
  类命中 §5.1 新增断流关键词（raw 含 `silent stream truncation`）→
  provider_error/retryable=true，确定性可测。
- 误报面：agent 合法地以工具调用/纯思考消息收尾会被误报一次 → nudge 后
  agent 自答「已完成」，成本一轮；紧链上限 2 封顶（设计决策 D-003）。

### 5.3 backend：三分支自动恢复（FR-3）

`_maybe_autoretry_auth_transient_turn`（close_run_steps.py:609）泛化为
`maybe_auto_recover_failed_turn(svc, agent_run)`，逻辑迁至
`daemon/session/service/auto_resume.py`（与 9-10 守卫簇同文件，单一源）。
`_close_post_commit` 调用点改名，其余零改动。

**auth-transient 类并入统一判定序（Grill P1-3）**：不再保留独立前置路径——
CLI 合成 401 文案作为 error_detail.type=auth_failed 的一个子形态（raw 正则
命中 `_CLI_AUTH_TRANSIENT_RE`）走分支 B 干净轮重放；行为面变化（有意）：
① 新增 origin 标记（旧 INSERT close_run_steps.py:744-758 不带 origin，迁移后
统一带）；② G0 开关/最新轮/双表幂等守卫对 auth 类同样生效（开关关闭时 auth
不再自动重投——与全类语义一致，测试同步更新）；③ 既有防循环（紧邻前查）与
防手动重发叠加守卫保留在分支 B 内。

判定序（互斥，命中即返回）：

```
总门（G0，全分支含 auth）：
  run.status == failed；session 存在且 status == 'active'
  session.config.get('auto_resume_interrupted') is not False
  run 是会话最新 run（created_at desc + id desc tiebreak——照 9-10 G4 实口径
    auto_resume.py:164-174；Grill P2-7 修正）
  run 有非空 user_input 日志（channel='user_input' 首条 strip 非空；空轮不恢复）
  无 pending 排队条目 origin == f'auto_resume:{run.id}'（幂等）
  无 pending 定时条目 origin == f'auto_resume:{run.id}'（幂等）
分支判定：
  A. quota_exceeded 且 reset_at 可解析且 parse 成功
     → quota 链计数（沿 run.metadata_.auto_resume_of 回溯，数连续
       error_detail.type==quota_exceeded 节点）< 3
       → INSERT AgentSessionScheduledMessage(
            prompt=QUOTA_NUDGE_PROMPT, dispatch_at=reset_at+120s,
            origin=f'auto_resume:{run.id}', provider/profile 快照随 run)
  B. type ∈ {rate_limited, timeout, network, provider_error}，或
     raw 命中 _CLI_AUTH_TRANSIENT_RE（auth-transient 旧面，Grill P1-3）
     → 无 tool_call 日志（干净轮）
       → 守卫（对齐 9-10 G5/G6，Grill P1-5）：user_input 长度 <
          USER_INPUT_LOG_MAX_CHARS(50000)（auto_resume.py:191-195 截断口径）；
          不含附件标记行（:198-200 宽松前缀）——命中任一 → 不重放（nudge 亦
          不发——附件轮/截断轮降级手动）
       → INSERT AgentSessionQueuedMessage(prompt=原 user_input 原文,
            origin=f'auto_resume:{run.id}', 队尾 append)
       （沿用 auth-transient 既有守卫：紧邻前 run 同失败同 prompt 不重投 /
          同文 pending 防手动重发叠加）
     → 有 tool_call 日志
       → 紧链计数（auto_resume_of 回溯链长）< 2
         → INSERT AgentSessionQueuedMessage(prompt=RESUME_NUDGE_PROMPT,
              origin=f'auto_resume:{run.id}', 队尾 append)
  C. 其余（auth_failed 未命中旧正则 / model_not_found / unknown / quota 无
     reset_at）→ 不动作（现状），仅前端提示。
```

nudge 提示词单一源常量（auto_resume.py 导出，测试锁定，对齐 9-10
`wrap_resume_prompt` 范式）：

```
RESUME_NUDGE_PROMPT（瞬时中断型）：
[系统续跑] 上一轮执行因上游输出流中断未完成，会话上下文完整。
请检查当前工作状态（已修改的文件、已执行的命令），从中断处继续完成原任务；
已完成的步骤不要重复执行；若原任务已完成，请直接说明即可。

QUOTA_NUDGE_PROMPT（额度恢复型）：
[系统续跑] 上游额度已重置，会话从中断处继续。请检查当前工作状态，
继续完成原任务；已完成的步骤不要重复执行；若原任务已完成，请直接说明即可。
```

两个设计要点：

- **nudge 不带原 prompt**：会话是常驻 CLI 进程，上下文完整，agent 知道自己
  在干什么；重放原任务反而诱导从头执行（副作用重复）。区别于 9-10 的
  daemon 重启场景（进程换了上下文丢了才需要包原文）。
- **quota 分支排定时而非排队**：重置前重放必再 429；定时消息基建（30s
  sweeper + 忙轮自动转排队 + 到期补捞）天然契合。+120s 缓冲防上游时钟偏差。

### 5.4 定时派发补 auto_resume 语义（FR-3.7）

派发逻辑实体在 **scheduled_send.py**（`_dispatch_scheduled_entry`
scheduled_send.py:86；scheduled_messages.py 仅 CRUD——Grill P1-4 修正）。
取快照载荷后、inject 前对 origin 条目补三步（与 queue.py:648-728 排队侧同
语义）：

1. `parse_auto_resume_origin(entry.origin)` 命中 → G10 超越守卫：source run
   之后存在更新的 run → 条目置 `cancelled`（error_code='superseded'）跳过
   inject；
2. inject 调用透传 `auto_resume_of=<source rid>`——**`inject_session_as_
   service`（inject.py:252-297）现无该参**，需加 `auto_resume_of:
   uuid.UUID | None = None` 并在调用 `_inject_into_session`（inject.py:366，
   该私有函数已有同参 :391）时转发（Grill P0-1 修正；类型以既有私有参
   uuid.UUID 为准）；忙轮分支再把 origin 复合值传入 `_handle_busy_turn`
   （见步 3，中段穿透归本参职责）；
3. 忙轮转排队路径：实体为 `_handle_busy_turn`（queue.py:50，INSERT 在
   :186-207；Grill v2 P1-3 修正——`enqueue_message` 函数不存在），**现状确实
   丢 origin**。透传链：`inject_session_as_service(auto_resume_of)` →
   `_inject_into_session` 忙轮分支 → `_handle_busy_turn(origin=
   f'auto_resume:{auto_resume_of}')`（增可选参，既有调用零传参不变）。

排队派发路径（queue.py:648-728）9-10 已带齐三步，零改动。

### 5.5 字段数据流标注（reset_at 全链）

| 跳 | 位置 | 归一化 |
|---|---|---|
| producer | daemon classifier.ts `extractResetAt` 产 `ModelError.resetAt`（ISO 串，+08:00 标注） | — |
| 序列化 | daemon.ts `payload.error` 注入处：`const { resetAt, ...rest } = modelError; payload.error = { ...rest, ...(resetAt !== null ? { reset_at: resetAt } : {}) }`（camel 键剔除+snake 键注入，Grill P2-10） | camel→snake |
| wire | hub-client notifyRunResult body.error.reset_at | — |
| 反序列化 | backend InteractiveRunResultRequest.error: ModelErrorDTO（+`reset_at: str \| None = None`） | pydantic |
| 落库 | close_run_steps `_close_apply_terminal`：error_detail = error.model_dump(mode='json')（:238，自动含 reset_at） | dict 透传 |
| 出库 | SessionRunRead.error_detail: dict（session_insights.py:76 dict 透传，无需改） | — |
| 消费 | frontend sessions.ts SessionRunRead.error_detail（dict 索引）；run-error-item 读 `error_detail.reset_at` 渲染 hint；api-types.ts 仅 ModelErrorDTO 定义处随 gen:types 更新 | — |

### 5.6 前端（FR-5）

- **数据上提（Grill P1-6）**：定时列表数据现状隔离在 ScheduledMessagesBar
  局部 QueryClientProvider（scheduled-messages-bar.tsx:14-19，panel 层零
  react-query）——「父级已有两列表数据」不成立。修正：定时列表查询上提为
  父层 hook（session-panel-page.tsx / session-panel-dialog.tsx 两个挂载点各
  接一份，或抽公共 hook），ScheduledMessagesBar 改为接收 props/共享 query
  key；排队数据父层已有（useMessageQueue，session-panel-page.tsx:33/:1847——plan 审查 P2 修正）。
- **run-error-item.tsx**：fallbackHint 链（item.hint > fallbackHint >
  defaultHint，现状）之上新增 autoRecoverHint 推导：props 增「会话 pending
  auto_resume 条目集」（排队列表 ∪ 定时列表，**两列表 DTO 均需 +origin 字段**
  ——排队 DTO SessionQueueEntry（session_queue.py:34-70）现无 origin，定时
  DTO ScheduledMessageRead（schema.py:400-420）现无 origin，后端各补一列
  透传）。分支：
  - type∈瞬时四类 && 有恢复条目 →「上游瞬时故障，已自动重发」
  - type=quota_exceeded && reset_at && 有定时条目 →「额度耗尽，将于 {本地
    时间格式化 reset_at} 自动继续（可在定时消息中取消）」
  - raw 含 silent stream truncation && 有恢复条目 →「输出流中断，已自动续跑」
  - 其余 → 现状（不注入）。
- **scheduled-messages-bar.tsx**：origin=auto_resume:* 条目加「自动续跑」徽标
  （复用既有 Tag 样式），文案注明「系统自动排期，可取消」；cancel 动作既有。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/model-error/classifier.ts | 门控移除+classifyClaude→classifyBlob+断流关键词（provider_error 规则体）+extractResetAt（中文格式 only） |
| 修改 | sillyhub-daemon/src/model-error/types.ts | ModelError +resetAt |
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | lastWasFinalText/turnHadActivity（message_end 边粒度）+settle 收敛合成 error result |
| 修改 | sillyhub-daemon/src/daemon.ts | payload.error resetAt→reset_at wire 映射（camel 键剔除） |
| 修改 | backend/app/modules/daemon/model_error.py | ModelErrorDTO +reset_at |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | 钩子改名调用 maybe_auto_recover_failed_turn；_maybe_autoretry_auth_transient_turn 逻辑迁出并入（含 _CLI_AUTH_TRANSIENT_RE 常量随迁） |
| 修改 | backend/app/modules/daemon/session/service/auto_resume.py | 新增 maybe_auto_recover_failed_turn 判定序（G0+G5/G6 复用）+RESUME/QUOTA_NUDGE_PROMPT 常量 |
| 修改 | backend/app/modules/daemon/session/service/inject.py | inject_session_as_service +auto_resume_of 参并转发 _inject_into_session；忙轮分支透传 origin 复合值至 _handle_busy_turn（Grill P0-1/P1-3） |
| 修改 | backend/app/modules/daemon/scheduled_send.py | _dispatch_scheduled_entry origin 解析+G10 超越守卫+auto_resume_of 透传（Grill P1-4 定位修正） |
| 修改 | backend/app/modules/daemon/session/service/queue.py | _handle_busy_turn +origin 可选参（忙轮 INSERT :186-207 透传；既有调用不变）；派发路径零改动 |
| 修改 | backend/app/modules/daemon/schema.py | ScheduledMessageRead +origin |
| 修改 | backend/app/modules/daemon/router/session_queue.py | SessionQueueEntry/_queue_entry_dto +origin（前端双信号数据源；plan 审查 P1-1 定位） |
| 修改 | backend/app/modules/agent/model.py | AgentSessionScheduledMessage +origin 列 |
| 新增 | NEW:backend/migrations/versions/20260912110000_add_scheduled_message_origin.py | 线性迁移（当前 head 1d763051eb15 后追加），downgrade 对称 |
| 修改 | backend/openapi.json | gen:types 重生成随动 |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types（ModelErrorDTO.reset_at / 两个列表 DTO origin） |
| 修改 | frontend/src/components/agent-log/run-error-item.tsx | autoRecoverHint 三分支推导+props |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | 父级聚合 pending auto_resume 条目下发 props |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 定时数据上提 hook+下发（Grill P1-6） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 同上（TurnTimeline 两个挂载点） |
| 修改 | frontend/src/components/daemon/scheduled-messages-bar.tsx | 「自动续跑」徽标+数据上提适配 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | 分支矩阵测试（G0 全守卫/三分支/链上限/nudge 文案锁定/auth 并入回归） |
| 修改 | sillyhub-daemon/tests/model-error/classifier.test.ts | 泛化+断流关键词+resetAt 用例（文件已存在——plan 审查 P1-3 核实） |
| 修改 | sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts | 静默收敛用例（零活动正例/[text,thinking] success 反例/usage-only/合成 error 正例） |
<!-- 执行期偏差：未触碰（收口全在 driver 侧，归一化器零改动；verify 对账修正声明） -->

daemon→backend 协议字段：reset_at（§5.5 全链）；无其它新对外字段。

## 7. 接口定义

```ts
// types.ts
interface ModelError { type; code; message; retryable; hint; raw;
  resetAt: string | null; }          // 新增最后字段

// classifier.ts（签名不变，行为变更）
classifyModelError(input: ClassifyModelInput): ModelError | null
//   input.agent 仅日志归因；规则体 classifyBlob 全 agent 生效

// pi-rpc-driver.ts（内部状态，无对外签名变化；收敛分支持 §5.2 伪码）
```

```python
# model_error.py
class ModelErrorDTO(BaseModel):
    type: ModelErrorType
    code: str | None = None
    message: str
    retryable: bool
    hint: str | None = None
    raw: str | None = None
    reset_at: str | None = None      # 新增

# auto_resume.py
RESUME_NUDGE_PROMPT: str
QUOTA_NUDGE_PROMPT: str
async def maybe_auto_recover_failed_turn(svc, agent_run: AgentRun) -> None
#   静默容错（内部全 try/except），由 close_run_steps._close_post_commit 调用

# inject.py
async def inject_session_as_service(
    ..., auto_resume_of: uuid.UUID | None = None)
#   转发至 _inject_into_session 同名既有参（inject.py:391）

# queue.py
async def _handle_busy_turn(..., origin: str | None = None)
#   忙轮 INSERT 透传用（inject 链传入）；既有调用零传参不变
```

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| turn result（故障轮） | daemon SessionManager._onResult | backend close_interactive_run | runId, status, is_error, error{type, retryable, reset_at?} | run：running→failed（interactive_interrupted）；error_detail 落库 |
| 自动恢复入队（瞬时） | backend close 钩子 | agent_session_queued_messages | origin='auto_resume:<rid>', prompt, 快照 | INSERT pending（队尾） |
| 自动恢复排期（额度） | backend close 钩子 | agent_session_scheduled_messages | origin='auto_resume:<rid>', prompt, dispatch_at=reset_at+120s | INSERT pending |
| 定时到点派发 | scheduled_send_sweeper | inject_session_as_service | origin 解析 rid, auto_resume_of, G10 通过 | scheduled：pending→dispatched；新 run：pending，metadata_.auto_resume_of=rid |
| G10 超越守卫命中 | 定时/排队派发 | —（记日志） | source rid 之后有更新 run | 定时条目→cancelled(superseded) / 排队条目删除 |
| 排队派发 | dispatch_queued_messages | inject | origin 解析 rid, auto_resume_of | 队列行删除；新 run 带 metadata_.auto_resume_of（既有） |
| 定时忙轮转排队 | scheduled_send _dispatch | inject → queue._handle_busy_turn | origin 复合值透传（inject 链中段穿透） | scheduled→dispatched；queued INSERT pending（origin 保留） |
| 用户取消自动续跑 | 前端定时列表 | 既有 cancel 端点 | 条目 id | scheduled：pending→cancelled（既有语义=取消自动继续） |

## 8. 数据模型

```
agent_session_scheduled_messages:
  + origin TEXT NULL   -- 'auto_resume:<源 run uuid>'；NULL=用户预约（存量）
```

- soft-add、无索引诉求（会话维度条目数小，G10/幂等按 agent_session_id+status
  过滤后小集合扫描——与 queued_messages.origin 同论证，9-10 §1.1）。
- agent_runs / queued_messages 零新列（复用 metadata_.auto_resume_of 与
  queued origin）。

## 9. 兼容策略

- **旧 daemon + 新 backend**：pi 错误仍 unknown → 分支 C 不动作（=现状）；
  auth-transient 旧正则在 backend 侧保留命中（raw 兜底）→ auth 干净轮重放
  行为延续；静默中断不可见（=现状）。
- **新 daemon + 旧 backend**：ModelErrorDTO 忽略 reset_at 额外键（pydantic
  默认 ignore）；合成 truncation error 走既有 failed 收敛。
- **未配置/关闭开关**：config.auto_resume_interrupted=False → G0 直接返回，
  全类（含 auth）回到手动模式（NFR-3；auth 类行为面变化已在 §5.3 声明）。
- **不改的 API/表**：close_interactive_run 请求形态（error 内 soft-add）、
  排队/定时消息既有端点、9-10 全部守卫行为。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 静默检测误报（合法工具收尾/纯思考收尾轮被判中断）→ 多一轮 nudge | P2 | 紧链上限 2；nudge 文案「若已完成请说明」不强制干活；message_end 边粒度标记已消 [text,thinking] 排列误报 |
| R-02 | 自动恢复风暴（上游持续故障，重试轮再失败再恢复） | P1 | 紧链上限 2（transient）；quota 链上限 3；G0 幂等双表查；G10 超越守卫 |
| R-03 | 副作用重复执行（nudge 后 agent 重做已完成步骤） | P1 | nudge 不带原任务 + 文案强制「先查已做」；干净轮才重放原文；G5 截断/G6 附件守卫降级手动 |
| R-04 | reset_at 时区错读 | P1 | 只解析 GLM 中文格式并固定 +08:00（实证依据）；英文变体不解析退化为不排期；+120s 缓冲 |
| R-05 | 定时条目在重置时间后上游仍未恢复 → 续跑轮再 429 | P2 | quota 链上限 3 内自然重排（新 reset_at）；达限交回用户 |
| R-06 | 混布四象限炸裂 | P2 | §9 全象限论证；协议 soft-add 双向忽略 |
| R-07 | classifier 泛化改变 codex/cursor 错误卡文案（unknown→真实类型） | P2 | 属修复目标本身；前端 hint 链对新类型均有文案或落默认 |
| R-08 | 定时忙轮转排队丢 origin | P1 | _handle_busy_turn +origin 参经 inject 链显式透传；测试覆盖转排队后仍带 origin |
| R-09 | auth 类并入 G0 后开关关闭时不再自动重投（行为变化） | P2 | §5.3/§9 已声明为有意变更；测试更新；开关默认开 |

## 11. 决策追踪

- D-001 归类器门控移除（规则 provider 无关）→ FR-1.1 / §5.1
- D-002@v2 resetAt 协议字段：只解析 GLM 中文格式 +08:00，英文变体 null →
  FR-1.2/1.3 / §5.1 / R-04（v1 泛英文解析被 Grill P2-11 否决）
- D-003 静默检测在 driver 收敛点、message_end 边粒度、误报容忍+链上限兜底 →
  FR-2 / §5.2 / R-01
- D-004@v2 恢复骨架泛化于 auto_resume.py 单一源，auth 类并入统一判定序
  （含 origin 补标与 G0 生效面，行为变化声明）→ FR-3.1 / §5.3 / R-09
  （v1「auth 原样保留零回归」被 Grill P1-3 判矛盾）
- D-005 nudge 不带原 prompt（上下文完整，防副作用诱导）→ §5.3 / R-03
- D-006 quota 走定时消息 +120s 缓冲 → FR-3.5 / §5.3 / R-05
- D-007 双层链上限（transient 紧链 2 / quota 链 3）→ FR-3.4/3.5 / R-02
- D-008@v2 scheduled_messages.origin 列+派发补 G10/打标；落点修正为
  scheduled_send.py + inject.py 加参转发 + _handle_busy_turn 补 origin →
  FR-4/3.7 / §5.4 / R-08（v1「inject 零签名改动」被 Grill P0-1 证伪）
- D-009@v2 前端 hint 双信号推导；定时数据上提父层 + 两列表 DTO +origin →
  FR-5.1/5.2 / §5.6（v1「父级已有两列表数据」被 Grill P1-6 证伪）
- D-010 空轮不恢复（无任务可恢复）→ FR-3.2 G0
- D-011 断流关键词归 provider_error（Stream ended without finish_reason
  主实证必须命中可重试类）→ §5.1 / Grill P0-2
- 未解决：无（v2 已吸收 Grill 全部 P0/P1；P2-7/8/9/10/12 一并修入正文）

## 12. 自审（v2）

- Grill 23 项 checklist 全部处置：2 P0（inject 加参转发+文件清单修正 /
  断流关键词）、4 P1（G0 统一+auth 行为变化声明 / 文件清单错漏 /
  G5G6 守卫 / 前端数据上提+DTO origin）、6 P2（G4 口径 / FR-2.2 归类机制
  表述 / 命名统一 / wire 键剔除 / resetAt 收窄 / message_end 边粒度+usage-only）。
- 守卫复用面 v2 重核：queue.py:648-728（G10+打标）已存在；auto_resume.py:
  164-174（G4 created_at+id）/191-195（G5 截断）/198-200（G6 附件）已存在；
  inject.py:366-391 私有参已有、公开签名需加参（P0-1 修正后口径）。
- 字段数据流 §5.5 七跳（含 wire 键剔除）无 dormant；生命周期契约表 8 事件。
- 存疑 1 处：pi 零活动轮判定（FR-2.3）与 pi 后台任务形态无冲突——实证所有
  completed 轮 output_redacted 非空，plan 期测试覆盖。
