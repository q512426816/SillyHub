---
author: qinyi
created_at: 2026-09-22 19:45:47
scale: large
---

# 设计文档（Design）— 会话任意点分叉与谱系溯源（session-fork-continuation）

## 背景

平台交互会话（backend daemon 模块 + sillyhub-daemon 三驱动 claude/codex/pi）目前只有**整会话恢复**（`POST /sessions/{id}/reopen` → `daemon:session_resume` → `restoreAndReconnect`，sillyhub-daemon/src/interactive/session-manager/persistence.ts:162-493），不支持从历史某一轮"回头"开分支。两个真实诉求叠加：

1. **通用诉求**：用户在正常会话中想回到之前某一轮，换个方向继续对话（像 ChatGPT 编辑消息产生的分支 / git checkout 历史点开新分支），原会话不受影响。
2. **肥会话续接的前置**：sillyspec 法证（round5/r5l-forensic-verdict.md）实证单会话上下文滚到 490K 后每条琐碎命令按 ~0.5M token 计价；"阶段边界换窗续接"依赖的正是"带着截至某点的前缀上下文开新会话"这一原子能力（handoff 自动触发按 D-006 后置，但地基在本变更打好）。

调研确认的关键事实（三轮 explore，证据均已入 decisions.md）：Claude Agent SDK（vendored 0.3.247）原生具备任意点分叉——`resumeSessionAt`（resume 只恢复到指定消息 UUID 为止，sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1886-1892）+ `forkSession`（resume 后分叉出新 session ID，:1548-1551）；平台已有 `forkSession` 生产先例（人格热切换，claude-sdk-driver.ts:476-479）与 SDK 换新 id 回写链（backend/app/modules/daemon/run_sync/service/submit_commit.py:198-216），但 `resumeSessionAt` 全仓零使用。codex 只能整 thread 恢复、pi 只能整会话文件恢复（pi RPC 有 fork/switch_session 命令但平台明确未接，pi-rpc-driver.ts:780-782）。

## 设计目标

- FR-01 **通用轮级分叉入口**：任意普通会话的任意**已终态轮**后可发起分叉（不依赖 sillyspec 变更上下文）；进行中轮不可选。
- FR-02 **分叉会话创建与继承**：新会话 B 继承截至分叉点（含该轮）的上下文，workspace/供应商/模型/档案按源会话当前值快照继承；fork 记录三件套（源会话/锚轮/引擎锚点）落 B 侧；**源会话 A 零字段改动、可继续对话**（D-005）。
- FR-03 **claude 原生真截断**：复用既有 create-with-resume 管道，透传 `resumeSessionAt`+`forkSession`，B 的上下文是截断后的原生历史，对分叉点之后的事完全不知情。
- FR-04 **种子档降级**：codex（及 pi 若 spike 失败）以「前情转述」种子消息启动（用户轮全文+助手轮摘要，体积帽截尾），UI 明确标注与原生档的语义差异（D-004）。
- FR-05 **谱系溯源 UI**：B 顶部常驻溯源块（分叉自哪个会话@第几轮+引擎档标注），点击以浮层查看原会话完整记录（WorkerSessionOverlay 泛化）；多跳分叉呈链式面包屑；会话列表 B 挂 A 附属分组带分叉徽标（origin=fork 与分身分组区分）。
- FR-06 **能力位三端单源**：ProviderCaps 增第 16 键 `sessionFork`（枚举 native/seed/none；生成器已支持枚举值键——`dialog` 键为既有先例，providers.ts:327），gen-provider-caps.mjs 三端生成 + alignment 守护升 16 键。
- FR-07 **轮锚点落库**：AgentRun 增 `engine_anchor`（claude=该轮末 chain-entry 消息 UUID），run_sync 上行回填——native 档分叉点的引擎侧定位依据。

## 非目标

- **handoff 自动续接不做**（D-006）：阶段/Wave 边界机械切窗、触发器、sillyspec CLI `handoff --json` 补种子字段全部后置独立变更；本变更不含任何 sillyspec 仓改动。
- **原会话冻结不做**（D-005）：分叉不终结、不挂起、不限制 A；A/B 并发写同一 worktree 属既有风险面（两个会话并发本就可发生），本变更不新增防护。
- **不做消息级（轮内）分叉**：粒度=轮（AgentRun）边界（D-003），不支持"某一轮中间某条消息"处切开。
- **不改造既有 resume/reopen 语义**：整会话恢复链零改动，fork 走 create 侧新路径。
- **不做分支可视化画布**（canvas/树形图）：谱系用溯源块+面包屑+列表附属组表达，树形视图留给后续。

## 拆分判断

不拆分。虽然跨 backend / sillyhub-daemon / frontend 三组件，但功能是**单一内聚闭环**（选点→分叉→谱系展示→溯源回看），拆成"数据模型/执行链路/UI"三个变更会让 fork 记录列、caps 键、锚点链三条契约悬空跨变更存在，对账成本高于一体交付。非批量模式（无模板×数据形态）。规模 large（多文件、跨模块、schema 变更）→ 四件套 + plan 路线。

## 总体方案

### Wave 1：地基（锚点 + 能力位 + spike 定档）

1. **数据模型迁移**：AgentSession 增 `fork_of_session_id`/`fork_at_run_id`/`engine_fork_anchor`，`origin` 值域增 `'fork'`；AgentRun 增 `engine_anchor`（见数据模型节）。
2. **caps 第 16 键**：providers.ts 增 `sessionFork`（claude=native、codex=seed、cursor=none、pi=待 spike），gen-provider-caps.mjs 支持枚举值键并三端刷新，alignment 测试升 16 键。
3. **双 spike（先行门，结论落 D-008）**：
   - pi spike：实测 pi RPC `fork`/`switch_session` 能否截断到指定消息——能则 pi=native（Wave2 接 driver fork 启动路径），不能则 pi=seed。
   - claude spike：真机验证 `resumeSessionAt`×`forkSession` 组合行为（`resumeDropsTurn` 校验边界——含守卫开关状态与确定性拒绝时的错误浮出路径；锚点应取轮末哪种消息），断言"B 对分叉点后内容不知情"。

### Wave 2：分叉执行链路（backend 主导，D-007）

`POST /api/daemon/sessions/{id}/fork`：
- **校验**：run 归属该会话、run 已终态、provider caps≠none；native 档另校验 `engine_anchor` 存在（缺失→422 提示该轮不可原生分叉/可退种子档）。
- **native 路径**：复用 create-with-resume 管道——`create_session(origin='fork', fork_of=..., fork_at_run=..., engine_fork_anchor=...)`；fork 参数下行链=placement.py 写 lease.metadata（`resume_at_uuid`+`fork_session`）→ claim 时 `build_claim_payload` interactive 白名单（backend/app/modules/daemon/lease/context.py:459 起；`resume_session_id` 即经此白名单透传的既有先例）组装进 claim payload → daemon 认领解析 execPayload（daemon.ts resume 链旁）→ `CreateSessionInput` → `_buildDriverOptions` → claude-sdk-driver options（`resume`+`resumeSessionAt`+`forkSession`）。SDK 换新 session id 的回写走既有 submit_commit 链（forkSession 与人格热切换同款）。**无新 WS 协议消息**。实现注意：driver-factory.ts 既有 forkSession 转发点嵌在 systemPrompt 热切换守卫内（:245-260），本变更的 fork 参数转发需与该守卫解耦或并行扩展（R-07）。
- **seed 路径**：`build_seed_prompt` 读该会话截至分叉轮的 logs（GET /logs 同源查询），组装「前情转述」种子（用户轮全文优先、助手轮摘要、超 `FORK_SEED_MAX_CHARS` 帽截尾并声明），作 B 的首条 prompt 经既有 create 链下发。

### Wave 3：前端 UI（原型 prototype-session-fork.html 已确认）

1. 轮头动作区「⑂ 从此分叉」：caps 门控（none 不渲染）、终态轮判定、native 档锚点缺失置灰。
2. 分叉确认弹层：分叉点信息 + 引擎档位语义标注（native=真截断 / seed=前情转述有损）。
3. 溯源块 + 谱系面包屑（新组件 lineage-block）：B 顶部常驻，点击浮层查看原会话。
4. 浮层泛化：worker-session-overlay.tsx 标题参数化，加「已分叉」状态条。
5. 会话列表：origin=fork 子会话挂源会话附属分组（复用分身分组渲染模式、origin 区分），分叉徽标。
6. page/dialog 双挂载点同步（session-panel 双模式惯例）。

### Wave 4：测试收口

backend fork 端点 pytest（归属/终态/档位门/种子帽/快照继承/A 零影响）；daemon 参数透传单测 + caps alignment 16 键；frontend 组件测试；claude 真机 E2E 手工验收（B 不知分叉点后的事）记入验证记录。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | AgentSession 增 fork 三列+origin 值域 'fork'；AgentRun 增 engine_anchor 列+索引（见数据模型节） |
| 新增 | NEW:backend/migrations/versions/20260922194500_add_session_fork_columns.py | alembic 迁移：四新列 + ix_agent_sessions_fork_of 索引 |
| 新增 | NEW:backend/app/modules/daemon/session/service/fork.py | fork_session 服务：fork 点校验、native/seed 分派、build_seed_prompt 组装器、fork 记录三件套+快照继承落库 |
| 修改 | backend/app/modules/daemon/session/service/create.py | create_session 签名增 fork 参数组（fork_of/fork_at_run/engine_fork_anchor，origin='fork'），默认缺省零回归 |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | facade re-export fork_session（既有集中 re-export 惯例） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | POST /sessions/{id}/fork 端点。数据流：producer=fork.py → SessionForkResponse → consumer=frontend sessions.ts forkSession() |
| 修改 | backend/app/modules/daemon/schema.py | SessionForkRequest/Response DTO；SessionRead 增 fork_of_session_id/fork_at_run_id/engine_fork_anchor 透出。数据流：producer=model.py 列 → DTO → pnpm gen:types → frontend/src/lib/api-types.ts → consumer=lineage-block 渲染 |
| 修改 | backend/app/modules/agent/placement.py | lease.metadata 增 resume_at_uuid/fork_session（只写 metadata，不组装 payload）。数据流：producer=fork.py 写 metadata → placement.py 保存 → claim 时 lease/context.py 白名单组装 → daemon.ts 解析 → session-manager → driver options |
| 修改 | backend/app/modules/daemon/lease/context.py | build_claim_payload（:459 起）interactive 分支白名单透传 resume_at_uuid/fork_session 两键（resume_session_id 即经此白名单的既有先例）——漏此环节 fork 参数到不了 daemon，native 档静默断链（Grill B-1；路径经增量复审定位修正） |
| 修改 | backend/app/modules/daemon/run_sync/service/submit_commit.py | AgentRun.engine_anchor 回填（claude 轮末 chain-entry UUID，session_id 回填点 :194-197 旁同款语义）。数据流：producer=daemon 消息上报 → 本处落列 → consumer=fork.py native 档锚点 |
| 修改 | backend/app/modules/agent/provider_caps.py | 生成镜像：sessionFork 第 16 键（枚举）。数据流：producer=sillyhub-daemon providers.ts 单源 → gen-provider-caps.mjs 生成 → 本文件+frontend provider-caps.ts → consumer=fork 端点门控/前端按钮门控 |
| 新增 | NEW:backend/app/modules/daemon/tests/test_session_fork.py | fork 端点+种子组装+档位门控+快照继承+A 零影响 pytest |
| 修改 | sillyhub-daemon/src/interactive/providers.ts | PROVIDER_CAPS 增 sessionFork 第 16 键：claude=native、codex=seed、cursor=none、pi=spike 定档 |
| 修改 | sillyhub-daemon/scripts/gen-provider-caps.mjs | 生成器支持枚举值键（非布尔），三端产物刷新 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/types.ts | CreateSessionInput 增 resumeAtUuid/forkSession 可选字段。数据流：producer=daemon.ts execPayload 解析 → CreateSessionInput → 建会话 → driver options |
| 修改 | sillyhub-daemon/src/interactive/session-manager/index.ts | 建会话路径把 fork 参数并入 driverOpts（resume 键旁，session-manager.ts 既有 driverOpts.resume 同款） |
| 修改 | sillyhub-daemon/src/interactive/claude-sdk-driver.ts | options 增 resumeSessionAt/forkSession 透传（forkSession 有人格热切换生产先例 :476-479） |
| 修改 | sillyhub-daemon/src/interactive/pi-rpc-driver.ts | （仅 pi spike 成时）fork 启动路径；spike 失败则本行不动 |
| 修改 | sillyhub-daemon/src/daemon.ts | execPayload 增 resumeAtUuid/forkSession 解析（:9278-9281 resume 链旁） |
| 新增 | NEW:sillyhub-daemon/tests/session-fork.test.ts | fork 参数透传 + caps 16 键契约测试 |
| 新增 | NEW:.sillyspec/changes/2026-09-22-session-fork-continuation/spike-pi-fork.md | pi fork 截断语义 spike 实测记录（Wave1 交付物，D-008 落盘依据；含 claude resumeSessionAt 组合验证记录） |
| 修改 | frontend/src/lib/provider-caps.ts | 生成镜像 sessionFork 键（数据流同 caps 链） |
| 修改 | frontend/src/lib/daemon/sessions.ts | forkSession API 封装 + SessionRead fork 字段手写镜像（gen:types 覆盖不到处补齐惯例） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 轮头动作区增「从此分叉」入口（caps 门控+终态轮判定+锚点缺失灰） |
| 新增 | NEW:frontend/src/components/daemon/session-fork/lineage-block.tsx | 溯源块+谱系面包屑组件。数据流：SessionRead fork 字段 → 渲染；点击回调开原会话浮层 |
| 新增 | NEW:frontend/src/components/daemon/session-fork/fork-confirm-modal.tsx | 分叉确认弹层（引擎档位语义标注，D-004） |
| 修改 | frontend/src/components/daemon/session-panel/worker-session-overlay.tsx | 标题参数化（「分身会话」→ 通用 title prop），复用为原会话浮层 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | page 模式挂载：轮级入口+溯源块+浮层 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | dialog 模式同上（双挂载点同步惯例） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | origin=fork 附属分组+分叉徽标（:2403-2489 分身分组渲染模式旁，origin 区分防混树） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/session-fork-entry.test.tsx | 轮级入口三重门控+确认弹层组件测试（task-07） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/session-fork-lineage.test.tsx | 溯源块/面包屑/浮层/列表分组组件测试（task-08） |
| 修改 | backend/openapi.json | gen:types 产物同步（fork 端点+SessionRead 新字段） |
| 修改 | frontend/src/lib/api-types.ts | 同上（pnpm gen:types 生成，禁手写） |

（本变更全在主仓，不涉 local.yaml repos 注册的其他仓——D-006 明确不动 sillyspec 仓。）

## 接口定义

```python
# backend — 端点（session_crud.py）
POST /api/daemon/sessions/{session_id}/fork
Request  SessionForkRequest: { at_run_id: UUID (必填), title: str | None }
Response SessionForkResponse: {
  forked_session_id: UUID, lease_id: UUID, run_id: UUID | None,
  tier: Literal["native", "seed"],
  lineage: { source_session_id: UUID, source_title: str, at_run_seq: int }
}
Errors: 404 会话/run 不存在或 run 不属于该会话；409 run 进行中；
        422 caps sessionFork=none，或 native 档 engine_anchor 缺失（文案提示可退种子档）

# backend — 服务（fork.py）
async def fork_session(*, db: AsyncSession, user: User, session_id: UUID,
                       at_run_id: UUID, title: str | None = None) -> SessionForkResult
def build_seed_prompt(rows: Sequence[AgentRunLog], *, max_chars: int = FORK_SEED_MAX_CHARS) -> str
def build_fork_lease_metadata(session: AgentSession, run: AgentRun) -> dict  # native 档 metadata
FORK_SEED_MAX_CHARS = 24_000  # 种子体积帽，超限截尾+截尾声明行
```

```typescript
// daemon — 透传字段（types.ts CreateSessionInput 增可选键）
interface CreateSessionInput { /* 既有 */ resume?: string;
  resumeAtUuid?: string;   // claude resumeSessionAt：截断到该消息（含）
  forkSession?: boolean;   // claude forkSession：分叉出新 SDK session id
}
// claude-sdk-driver：driverOpts → SDK options { resume, resumeSessionAt, forkSession }
```

```typescript
// frontend — API 封装（sessions.ts）
export async function forkSession(sessionId: string, body: { at_run_id: string; title?: string })
  : Promise<SessionForkResponse>
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| fork session（B 创建） | backend fork service | backend DB + daemon（经既有 lease 认领链） | sourceSessionId, atRunId, forkOf, forkAtRun, engineForkAnchor, origin='fork', tier | B: pending→active（走既有 create 链）；**A: 零状态变化**（D-005） |
| claim lease（B） | daemon | backend | leaseId, claimToken | pending→claimed（既有链零改动；fork 参数随 execPayload 下行） |
| submit message（B 首轮） | daemon | backend | leaseId, claimToken, runId | append messages（既有链；native 档首轮即用户首问，seed 档首条=种子 prompt） |
| turn result（B 首轮终态） | daemon | backend | runId, status, agentSessionId（fork 后新 SDK id） | running→completed；agent_session_id 最新值覆盖回写（既有 submit_commit 链，forkSession 换 id 同人格热切换先例） |
| session end | 既有语义 | — | — | 不新增：fork 不终结 A、不预终 B（表列全事件对齐既有 claim/inject/heartbeat 链，零改动复用） |

## 数据模型

```text
agent_sessions 新列（全部可空，零迁移兼容）：
  fork_of_session_id   UUID NULL FK→agent_sessions.id  # 分叉源（单向挂 B 侧）
  fork_at_run_id       UUID NULL FK→agent_runs.id      # 锚轮
  engine_fork_anchor   TEXT  NULL                      # claude=源轮末 chain-entry 消息 UUID；seed 档 NULL
  origin 值域增 'fork'（String(16) 容量内；与 chat/tool_report 并列）
  约束：fork 会话不写 parent_session_id（恒 NULL）、tree_depth 恒 0——
  谱系由 fork_of_session_id 单向链表达，不与分身树（parent/tree_depth 为
  dispatch_worker 专用语义）混用；列表渲染分叉组按 origin+fork_of 判定，
  分身组仍按 parent_session_id 判定（session-list-panel.tsx:2413-2456 现状）
  索引：ix_agent_sessions_fork_of (fork_of_session_id)

agent_runs 新列：
  engine_anchor        TEXT  NULL   # 轮引擎锚（D-008/010 分档）：claude=轮末 chain-entry UUID
                                    # （轮终态回填）；pi=该轮首条用户消息 entryId；codex 恒 NULL
                                    # pi 档 fork 锚=at_run 下一轮 engine_anchor（before），
                                    # 末轮后分叉走 clone 全量
```

## 兼容策略（brownfield）

- **未分叉时行为零变化**：全部新列可空、新端点独立、create_session 新参数缺省走原路径；旧前端收到 16 键 caps JSON 忽略未知键（消费侧显式查 sessionFork，缺键视为 none 不渲染入口）。
- **存量轮锚点缺失**：迁移前的 AgentRun 无 engine_anchor → native 档该轮入口置灰（提示缺锚点）；seed 档不受影响（读库即时可用）——不回填存量（锚点不可靠重建）。
- **回退路径**：fork 端点校验失败 B 不落库（行创建在事务内，任一校验失败整体回滚）；caps=none 引擎 422；pi spike 失败只是 caps 值落 seed，链路无废弃件。
- **不改变**：既有 resume/reopen 语义、AgentRunLog 写链、dispatch_worker 分身 parent 语义、群聊影子会话（刻意不挂 fork 谱系，同 model.py:1403 惯例）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SDK `resumeSessionAt`×`forkSession` 组合行为未实测（resumeDropsTurn 校验可能拒非轮边界锚点；锚点取轮末哪条消息未定） | P0 | Wave1 claude spike 真机断言（fork 点后内容不可见+锚点消息类型），结论固化进 D-008 与 driver 实现 |
| R-02 | pi fork 截断语义未验证（可能整文件分叉无截断） | P1 | spike 前置门（D-007）：不能截断即 caps 落 seed，不接 native 参数防语义错误 |
| R-03 | 种子档体积失控/转述质量有损引发「模型忘了」误报 | P1 | FORK_SEED_MAX_CHARS 帽+截尾声明+用户轮全文优先；UI 档位标注（D-004） |
| R-04 | A/B 并发写同一 worktree 文件 | P1 | 既有风险面（两会话并发本就存在），非目标声明不新增防护；handoff 特例后置时再议冻结语义 |
| R-05 | engine_anchor 回填遗漏（上行链某分支不写） | P2 | 单测锁 submit_commit 回填点（对齐 session_id 回填 :194-197 语义）；漏写仅表现该轮入口灰，不炸链路 |
| R-06 | 无长驻进程/外部资源，生命周期面不适用（fork 复用既有 spawn/lease 链，不引入新后台任务/文件锁/子进程） | — | 显式留痕 |
| R-07 | driver-factory.ts 既有 forkSession 转发点嵌在 systemPrompt 热切换守卫内（:245-260），fork 参数转发若沿用该点易把两语义耦死 | P2 | 实现时为 fork 链独立转发分支（Grill X2 陷阱提示）；daemon 透传任务卡验收点 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01、§非目标（handoff 后置） | 已覆盖 |
| D-002@v1 | FR-05、§总体方案 Wave3 | 已覆盖 |
| D-003@v1 | FR-01/FR-07、§数据模型（engine_anchor） | 已覆盖 |
| D-004@v1 | FR-03/FR-04/FR-06、§接口定义（tier 出参） | 已覆盖 |
| D-005@v1 | FR-02、§生命周期契约表（A 零状态变化行） | 已覆盖 |
| D-006@v1 | §非目标、§文件变更清单（无 sillyspec 仓段） | 已覆盖 |
| D-007@v1 | §总体方案 Wave2、§文件变更清单（placement/daemon 透传链） | 已覆盖 |

**多裁定组合推演**（D-004 两档 × D-007 pi 定档门 × D-005 A 保留，三裁定互约束）：

| 组合格 | 推演 | 结论 |
|---|---|---|
| pi=native + A 活跃 | B 经 forkSession 以新 SDK id 读截断副本；A 原会话文件仅 A 追加（forkSession=复制出新 id，人格热切换先例无争用） | 无冲突 |
| pi=seed + A 活跃 | B 种子启动，不触碰任何引擎会话文件 | 无冲突 |
| codex=seed + 锚点缺失轮 | seed 不依赖 engine_anchor，读库即可 | 无冲突 |
| native 档 + B 首轮进行中用户再分叉 A | 两分叉互不感知（各自独立 B 行+SDK id），谱系两叶 | 无死锁 |

无死锁格；唯一未决依赖 = R-01/R-02 两项 spike（Wave1 前置门消化）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1 ~ D-007@v1（决策追踪表逐行）
- [x] 生命周期契约表已含（session/lease 关键词触发）
- [x] UI 原型：prototype-session-fork.html 已在变更目录（Step5 用户已确认）
- [x] ⚠️ 自审存疑一：SDK resumeDropsTurn 对锚点消息类型的精确拒绝边界未定（R-01，Wave1 claude spike 断言后固化，不阻塞设计成立）
- [x] ⚠️ 自审存疑二：engine_anchor 取「轮末 assistant chain-entry」还是「轮末任意消息」由 spike 实测定（影响 submit_commit 回填一行，波及面小）
