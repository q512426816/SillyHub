---
author: qinyi
created_at: 2026-06-20T00:36:00
---

# design: 交互式会话历史回看体验增强

变更名：`2026-06-20-session-history-enhance`
原型：`prototype-session-history.html`
决策台账：`decisions.md`（D-001@v1 ~ D-005@v1）

## 1. 背景与目标

`/runtimes` 页的交互式会话（InteractiveSessionPanel，task-11）+ 会话列表/历史回看（task-12）已上线，但历史回看体验有三个缺口：

1. **回看只有 agent 一侧**：看不到用户自己发过的消息
2. **不能续聊**：历史会话（尤其已 ended/failed）是只读的，无法接着对话
3. **删除受限**：只有 ended/failed 能删，active 的会话删不掉

本变更一次性补齐这三点。续聊方案经用户确认为 **方案 A（reopen + SDK resume）**，范围 = **任意会话（含 ended/failed）都可续聊**，**仅 claude**（codex 无 resume driver，仅只读回看）。

## 2. 现状与根因

### 2.1 用户 prompt 不落库（→ 问题①）
- `AgentSession` / `AgentRun` 均无 prompt 字段；`AgentRunLog.channel` 仅 `stdout/stderr/tool_call`，无 user 类型（`backend/app/modules/agent/model.py:237-264`）
- 首条 prompt 只塞进 `daemon_task_leases.metadata.prompt`（`backend/app/modules/agent/placement.py:375-385`），不经 logs 端点暴露
- inject（追问）的 prompt **完全不落库**，只 WS 透传给 daemon（`service.py:1770-1896`）
- `get_agent_session_logs`（`service.py:2511-2579`）只 join AgentRunLog → 返回全是 agent 产出

### 2.2 续聊三层堵（→ 问题②）
- 前端 `SessionHistoryView`（`runtimes/page.tsx:957`）纯只读；`InteractiveSessionPanel` 只能从 idle 新建，无"打开已有 session"入口
- 后端 `inject_session` **硬卡 `status=='active'`**，ended/failed 直接 409（`service.py:1793-1797`）
- 无"重开已结束会话"能力；`recover_session_after_daemon_restart`（`service.py:2130-2141`）对 ended 写死 "no resurrect"（仅 daemon 重启路径）

**但 SDK 层可行**（已验证）：Claude Agent SDK 0.3.181 的 `options.resume` 不依赖进程内 session 存活（task-10 崩溃恢复 `daemon.ts:638-803` 已证明）；`AgentSession.agent_session_id` 在 end 后仍留 DB（`model.py:319-322`，end 不清）；daemon `restoreAndReconnect`（`session-manager.ts:744-811`）原生支持用 session_id resume。

### 2.3 删除状态受限（→ 问题③）
- 前端 `SessionsSidebar:927` `{!active ? 删除按钮 : null}`
- 后端 `delete_agent_session:2494-2501` 对 `status∈{pending,active,reconnecting}` 抛 409，要求先 end

## 3. 方案总览（Wave 分解）

| Wave | 问题 | 端 | 改动摘要 |
|---|---|---|---|
| W1 | ①回看含用户消息 | backend | create/inject 建对应 run 后插 `AgentRunLog(channel="user")` |
| W1 | ①回看含用户消息 | frontend | `SessionHistoryView` 按 channel 渲染用户气泡(右)/agent 气泡(左) |
| W1 | ③任意状态删除 | backend | `delete_agent_session` 去 active 拒绝；active 先内部 end 再硬删 |
| W1 | ③任意状态删除 | frontend | `SessionsSidebar` 去 `{!active}` 限制 |
| W2 | ②任意会话续聊 | backend | 新增 `reopen_session` + `POST /sessions/{id}/reopen` + WS `daemon:session_resume` |
| W2 | ②任意会话续聊 | daemon | `protocol.ts` 加 `SESSION_RESUME`；`_routeSessionControl` 加分支调 `restoreAndReconnect`+`markReconnected` |
| W2 | ②任意会话续聊 | frontend | `reopenSession()` API；`InteractiveSessionPanel` attach 已有 session 模式；选中会话"继续对话"按钮 |

W1 相互独立、可先行交付（都有独立价值）；W2 依赖 backend reopen，是最大块。

## 4. 详细设计

### 4.1 W1 · 问题①回看显示用户消息（D-001）

**后端**（`backend/app/modules/daemon/service.py`）：
- `create_session`（:1587）：建首 `AgentRun`（:1659 附近）flush 后，commit 前插一条
  `AgentRunLog(run_id=<首run.id>, channel="user", content_redacted=<脱敏 prompt>, timestamp=now)`
- `inject_session`（:1770）：建新 `AgentRun`（:1815）后、发 SESSION_INJECT 前，插同样一条 user log（run_id=新 run）
- 脱敏复用现有 `content_redacted` 机制（与 agent 输出一致；prompt 经与 `_channel_from_event_type` 同源的脱敏路径，user channel 不经事件映射，直接显式写）
- `get_agent_session_logs`（:2511）**SQL 不改**：现有 JOIN 已返回该 session 下所有 AgentRunLog，user log 天然按 run 分组、turn 顺序保留（anchor_ts 排序不变）

**前端**（`frontend/src/app/(dashboard)/runtimes/page.tsx`）：
- `SessionHistoryView`（:957）：渲染 `entries` 时按 `log.channel` 区分 —— `channel==="user"` → 右对齐 primary 气泡；其余 → 左对齐白底 agent 气泡。保留按 run 分组 + run tag
- `AgentRunLogEntry` 前端类型（`frontend/src/lib/daemon.ts`）：确认/补 `channel` 字段（后端 schema `AgentRunLogEntry` 已含 channel，见 `backend/app/modules/agent/schema.py:123-129`）

### 4.2 W1 · 问题③任意状态删除（D-003）

**后端**（`service.py` `delete_agent_session` :2473）：
- 删除 `:2494-2501` 的 `status∈ACTIVE → 409` 拒绝
- 改为：若 `session.status ∈ {pending, active, reconnecting}`，**先调内部 end 收口**（复用 end_session 的核心：发 `daemon:session_end` WS 关 daemon 侧 session + 把当前 run 标 killed + lease 置 completed），best-effort（daemon 离线不阻断本地删除）
- 再执行现有硬删：`UPDATE agent_runs SET agent_session_id=NULL`（:2503-2507，断外键）+ `session.delete()`（:2508），保留 run/logs 历史

**前端**（`page.tsx` `SessionsSidebar` :927）：
- 去掉 `{!active ? <删除按钮> : null}`，所有状态都渲染删除按钮
- 删除按钮点击仍走现有 `handleDelete`（confirm + `deleteAgentSession`）；active 删除的后台 end 由后端自动处理，前端无需额外步骤

### 4.3 W2 · 问题②任意会话续聊（方案 A，D-002 / D-004）

#### 4.3.1 后端 reopen

**新增方法** `DaemonService.reopen_session(session_id, user_id, runtime_id?, model?)`（参照 `recover_session_after_daemon_restart` `:2071` + `create_session` `:1587`）：
1. `SELECT AgentSession FOR UPDATE` + ownership 校验（user_id 匹配，否则 404 资源隐藏）
2. 前置校验：
   - `provider != "claude"` → 409 `DAEMON_SESSION_RESUME_UNSUPPORTED`（codex 无 driver）
   - `agent_session_id IS NULL` → 409 `DAEMON_SESSION_NO_AGENT_SESSION`（D-004，create 阶段失败的会话不可续）
   - `status ∈ {active, pending, reconnecting}` → 409（仍活跃，无需 reopen，引导直接 inject）
   - 目标 runtime 离线 → 409 `DAEMON_OFFLINE`（reopen 需在线 daemon 执行 SDK resume）
3. 新建 interactive lease（`kind="interactive"`，新 `claim_token=secrets.token_hex(32)`），不复活原 completed lease；更新 `session.lease_id`（+ `session.runtime_id` 若切换 daemon）
4. `session.status = "reconnecting"`（先 reconnecting；daemon resume 成功后经 confirm 切 active，复用 `confirm_session_reconnected` `:2352`）
5. 发新 WS 控制消息 `daemon:session_resume`（payload：`{session_id, lease_id, agent_session_id, cwd, provider, runtime_id}`）
6. commit
7. **方法同步返回 `{session_id, status: "reconnecting"}`，不阻塞等待 daemon confirm**（resume 是异步的：daemon 收 SESSION_RESUME → restoreAndReconnect → markReconnected → 上报 confirm → backend confirm_session_reconnected 切 active）。frontend 据返回值轮询，见 §4.3.3。

**新增路由** `POST /api/daemon/sessions/{id}/reopen`（`router.py`，紧邻 inject/end，约 :734）
**新增 WS 常量** `protocol.py`：`DAEMON_MSG_SESSION_RESUME = "daemon:session_resume"`（紧邻 :43 的 SESSION_END）

**失败/超时**：daemon resume 失败（jsonl 不存在/SDK 报错）时上报 error，backend 把 `status → failed`；reopen 后若 daemon 长时间不上报 confirm，由现有 reconnecting 超时 sweep 兜底（标注 ⚠️ 见风险）。

#### 4.3.2 daemon SESSION_RESUME 分支

**`sillyhub-daemon/src/protocol.ts`**：加 `SESSION_RESUME = "daemon:session_resume"`（紧邻现有 SESSION_END/INJECT，约 :82-101）
**`sillyhub-daemon/src/daemon.ts` `_routeSessionControl`**（:1375-1403）加 `SESSION_RESUME` case：
- 从 payload 构造 `PersistedSessionRecord`（`agentSessionId / cwd / provider / leaseId`，字段见 `interactive/types.ts`）
- 调 `this._sessionManager.restoreAndReconnect(record)`（**无需改 SessionManager 核心**，:744 已具备 new InputQueue + driver.start({resume}) + _runConsume + markReconnected）
- `restoreAndReconnect` 内部 markReconnected → daemon 上报 confirm → backend `confirm_session_reconnected` 把 status 切 active
- resume 成功后，后续 turn 直接走现有 `inject` 链路（reopen 已切 active，`inject_session` 放行，SESSION_INJECT → SessionManager.inject `:450-495`）

#### 4.3.3 前端 attach 模式 + 续聊入口

**`frontend/src/lib/daemon.ts`**：
- 新增 `reopenSession(sessionId): Promise<{session_id, status}>` → `POST /sessions/{id}/reopen`
- `AgentSessionRead` 已含 `status / provider / agent_session_id`，续聊可用性判断在前端算

**`InteractiveSessionPanel`（`components/daemon/interactive-session-panel.tsx`）**：
- props 增加 `attachSessionId?: string` + `initialTurns?: SessionTurnView[]`
- mount 时若 `attachSessionId` 存在 → `establishStream(sessionId)` 建 SSE + 用 `initialTurns` 预填 view.turns（从 getAgentSessionLogs 转换：user log→prompt、同 run 其余→output）
- **status 初始置 `reconnecting`**（reopen 同步返回 reconnecting，daemon resume 中）；attach 后启动**轮询** `getAgentSession(id)`（新增，见下）每 ~1.5s 拉一次 status：
  - `status==='active'` → 把面板 status 切 active，启用输入框，后续 inject 走现有 handleSend 的 active 分支
  - 仍 `reconnecting` → 输入框禁用 + 提示「恢复会话中…」
  - 超时（~15s）仍非 active 或变 `failed` → 提示「会话恢复失败，可能上下文已失效」，回退只读历史
- SSE 在 reconnecting 期间可先建立（订阅后续 turn/log），不阻塞

**`frontend/src/lib/daemon.ts`**：新增 `getAgentSession(sessionId): Promise<AgentSessionRead>` → `GET /api/daemon/sessions/{id}`（后端补单查端点，用于 reopen 后轮询 status；不复用 list 接口避免拉全量）。对应 backend `router.py` 加 `GET /sessions/{id}` + `DaemonService.get_agent_session(id, user_id)`。

**`runtimes/page.tsx` `SessionListSection`**：
- 选中会话后，`SessionHistoryView` 顶部增加「继续对话」按钮，可用性 = `provider==='claude' && agent_session_id && status∈{ended,failed}`（D-004）；codex / 无 agent_session_id 置灰并 title 提示
- 点击 → `reopenSession(selected.id)` → 成功后把选中会话切到 attach 模式的 `InteractiveSessionPanel`（传 attachSessionId + 预填历史 turn），右侧从"只读回看"切换为"可续聊面板"

## 5. 数据模型变更

**无 Alembic migration**。全部复用现有表/字段：
- 问题①：`AgentRunLog.channel` 新增取值 `"user"`（String 列，无枚举约束，无需 DDL）
- 问题②：复用 `AgentSession.status` 现有 `reconnecting` 状态 + `agent_session_id` 字段（end 后保留）；复用 `DaemonTaskLease` 新建 interactive lease
- 问题③：不改 schema

## 6. 生命周期契约表

### 6.1 AgentSession.status 转换
| from | event | to | 触发 |
|---|---|---|---|
| pending | create 首条 prompt 发出 | active | create_session |
| active | inject 追问 | active | inject_session（建新 run） |
| active | 用户 end / daemon 结束 | ended | end_session |
| active | daemon 重启 / 异常 | reconnecting | recover_session_after_daemon_restart |
| reconnecting | daemon resume 成功上报 | active | confirm_session_reconnected |
| reconnecting | resume 超时/失败 | failed | sweep / error 上报 |
| **ended/failed** | **用户点续聊** | **reconnecting** | **reopen_session（新增）** |

新增转换：`ended/failed →(reopen)→ reconnecting →(confirm)→ active`。reopen 仅 claude + agent_session_id 非空。

### 6.2 DaemonTaskLease（interactive）生命周期
- create_session 建 lease：`pending → claimed → completed`
- end_session：lease → `completed`（不删行，保留）
- **reopen_session：新建一条 interactive lease（原 completed lease 保留不动）**，session.lease_id 指向新 lease；rotate claim_token。不复活 completed lease（D-002，避免污染状态机）
- delete active：先 end → lease completed，再删 session（lease 行作为 completed 孤儿保留，与现状一致）

### 6.3 AgentRun（turn）生命周期
- 每个 turn = 1 个 AgentRun（`agent_session_id` 外键）
- create_session/inject_session 建 run（pending→running→completed/failed/killed）
- end_session 把当前 run 标 killed
- **reopen 不新建 run**（仅恢复 SDK session 上下文）；首个续聊 inject 才建新 run
- delete：`UPDATE agent_runs SET agent_session_id=NULL`（断外键），run/logs 保留

### 6.4 WS 控制消息契约
| 消息 | payload 必需字段 | 方向 | 用途 |
|---|---|---|---|
| `daemon:session_inject` | session_id, lease_id, run_id, prompt, claim_token | hub→daemon | 推进一个新 turn（现有） |
| `daemon:session_end` | session_id, lease_id | hub→daemon | 关闭 SDK session（现有） |
| **`daemon:session_resume`** | **session_id, lease_id, agent_session_id, cwd, provider, runtime_id** | hub→daemon | **重开已结束会话（新增）** |

## 7. 决策引用（design ↔ decisions）
- D-001@v1（prompt 落 AgentRunLog channel=user）→ §4.1
- D-002@v1（续聊范围/resume 机制）→ §4.3
- D-003@v1（任意状态删除 + active 先 end）→ §4.2
- D-004@v1（failed 重开前提 = agent_session_id 存在）→ §4.3.1 前置校验 + §4.3.3 按钮可用性
- D-005@v1（历史数据不补）→ §10

全部 D-xxx@v1 均被覆盖，无未解决项。

## 8. 验收标准
- **FR-1**（问题①）：新建 claude 会话发 2 条消息 → 历史回看该会话能看到 2 个用户气泡（右、primary）+ 对应 agent 回复（左），按 turn 分组顺序正确
- **FR-2**（问题②）：
  - ended claude 会话点「继续对话」→ reopen 成功 → 面板 attach → 发新消息能基于之前上下文回答（SDK resume 生效）
  - failed claude 会话（有 agent_session_id）同样可续聊
  - codex 会话 / 无 agent_session_id 的 failed 会话「继续对话」按钮置灰，title 提示原因
  - active 会话选中不显示「继续对话」（本就活跃，直接在 live 面板续）
- **FR-3**（问题③）：
  - 任意状态会话列表都显示删除按钮
  - 删除 active 会话后：daemon 侧 session 已关闭（不再续看）、lease 置 completed；session 行删除；run/logs 历史保留（回看仍可）
  - 删除 ended/failed 会话：直接删，run/logs 保留
- 测试：backend pytest（daemon session 相关）+ daemon vitest（SESSION_RESUME 分支、restoreAndReconnect 复用）+ frontend vitest（SessionHistoryView channel 渲染、续聊按钮可用性、删除按钮全状态）

## 9. 非目标
- 不做 codex 续聊（无 resume driver，仅只读回看）
- 不回填存量历史会话的 prompt（D-005）
- 不改 SDK / driver / SessionManager 核心（restoreAndReconnect 复用）
- 不做"reopen 后 lease 心跳/续期"等 lease 治理增强（复用现有 interactive lease 生命周期）
- 不改会话列表分页/排序（本次只加删除/续聊入口）

## 10. 兼容策略 / 历史数据（brownfield）
- **本变更上线前的会话**：inject 的 prompt 从未落库（D-005），无法补。回看旧会话仅显 agent 产出（无用户气泡），UI 不报错、不崩
- **本变更上线后的新 turn**：create/inject 均落 user log，回看完整
- **agent_session_id 缺失的旧 failed 会话**：续聊按钮置灰（D-004），不影响其余功能
- 回退路径：若 reopen 上线后 SDK resume 在生产不稳定，可在前端隐藏「继续对话」入口（feature flag 式），后端 reopen 端点保留但不暴露，问题①③不受影响（独立 Wave）

## 11. 风险与对策
| 风险 | 对策 |
|---|---|
| SDK resume 依赖 `~/.claude/.../<sid>.jsonl` 还在 + cwd 一致；jsonl 被清理则 resume 失败 | daemon resume 失败上报 error → backend status→failed；前端续聊失败提示「会话上下文已失效」 |
| reopen 后 daemon 不上报 confirm（离线/卡住），status 卡 reconnecting | 复用现有 reconnecting 超时 sweep 兜底；前端 reopen 后轮询 session status，超时提示重试 |
| active 删除时 daemon 离线，SESSION_END 发不出 | end 收口 best-effort（同 end_session 现状），本地仍强制删；daemon 侧 session 由其自身空闲超时清理 |
| 并发 reopen（用户连续点）/ reopen 一个正在 reconnecting 的 | reopen 前置校验 status∈{ended,failed}；reconnecting/active 直接 409；FOR UPDATE 行锁 |
| prompt 脱敏遗漏敏感信息 | 复用现有 content_redacted 脱敏路径（与 agent 输出一致），不单独处理 |

## 12. Wave 分解（供 plan）
- **Wave 0**：后端问题①（create/inject 落 user log）+ 前端回看渲染 + 后端问题③（delete 改）+ 前端去 active 限制 —— 独立可交付，立即可用
- **Wave 1**：后端 reopen 端点 + WS 常量 + daemon SESSION_RESUME 分支 —— 续聊链路打通（可单测 reopen 状态转换 + daemon route）
- **Wave 2**：前端 attach 模式 panel + 续聊按钮 + 端到端联调 —— 用户可见的续聊体验

## 13. 文件变更清单

### backend（改/新增）
- `backend/app/modules/daemon/service.py`（改）：`create_session`/`inject_session` 插 user log；`delete_agent_session` 去 active 拒绝 + active 先内部 end；新增 `reopen_session` + `get_agent_session`
- `backend/app/modules/daemon/router.py`（改）：新增 `POST /sessions/{id}/reopen` + `GET /sessions/{id}`
- `backend/app/modules/daemon/protocol.py`（改）：新增 `DAEMON_MSG_SESSION_RESUME = "daemon:session_resume"` 常量
- `backend/app/core/errors.py`（改）：新增 `DAEMON_SESSION_RESUME_UNSUPPORTED` / `DAEMON_SESSION_NO_AGENT_SESSION` / `DAEMON_OFFLINE`（沿用现有 AppError 子类体系）
- `backend/app/modules/daemon/tests/`（改/新增）：reopen 状态转换 / delete-active / user-log 落库测试

### sillyhub-daemon（改/新增）
- `sillyhub-daemon/src/protocol.ts`（改）：新增 `SESSION_RESUME`
- `sillyhub-daemon/src/daemon.ts`（改）：`_routeSessionControl`（:1375-1403）加 `SESSION_RESUME` 分支 → 构造 PersistedSessionRecord 调 `restoreAndReconnect` + `markReconnected`
- `sillyhub-daemon/src/interactive/types.ts`（可能改）：确认 `PersistedSessionRecord` 字段覆盖 reopen payload（agentSessionId/cwd/provider/leaseId）
- `sillyhub-daemon/tests/`（新增）：SESSION_RESUME route 分支单测

### frontend（改/新增）
- `frontend/src/lib/daemon.ts`（改）：新增 `reopenSession` + `getAgentSession`；`AgentRunLogEntry` type 补 `channel` 字段（后端 schema 已有，前端如缺则补）
- `frontend/src/components/daemon/interactive-session-panel.tsx`（改）：新增 attach 模式 props（`attachSessionId`/`initialTurns`）+ 轮询到 active 启用输入
- `frontend/src/app/(dashboard)/runtimes/page.tsx`（改）：`SessionHistoryView` channel 渲染 + `SessionsSidebar` 去 active 删除限制 + 续聊按钮接线（历史回看↔attach 面板切换）
- `frontend/src/app/(dashboard)/runtimes/page.test.tsx` + `frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx`（改）：channel 渲染 / 续聊按钮可用性 / 删除全状态测试

### 数据库
- **无 Alembic migration**（§5，复用现有表，channel 新增取值无需 DDL）

## 14. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖（三问题） | ✓ FR-1/2/3 覆盖对话式探索确认的全部需求 |
| decisions 覆盖 | ✓ §7 引用 D-001@v1~D-005@v1 全部当前版本，无未覆盖 |
| 约束一致性 | ✓ 符合 CONVENTIONS（router→service→model、AgentRunLog 复用、AppError 错误体系）|
| 真实性 | ✓ 表名/字段/方法名均带调研证据（AgentRunLog/AgentSession/DaemonTaskLease/restoreAndReconnect/confirm_session_reconnected/_routeSessionControl/claude-sdk-driver options.resume）|
| YAGNI | ✓ §9 非目标明确 |
| 验收可测 | ✓ FR-1~3 具体可测 |
| 非目标清晰 | ✓ §9 |
| brownfield 兼容 | ✓ §10 回退路径 |
| 风险识别 | ✓ §11 |
| 生命周期契约表 | ✓ §6（session.status/lease/run + WS 消息契约）|

**Design Grill**：已交叉审查，X-001（reopen 时机：backend reconnecting vs frontend attach active）已修正（§4.3.1 step7 + §4.3.3 轮询）。

**待 execute 实现时验证的点**（非设计存疑）：
- 前端 `AgentRunLogEntry` type 是否已含 `channel` 字段（后端 schema 已有）
- `markReconnected` 是否上报 confirm → backend `confirm_session_reconnected`，且其校验（runtime/lease/claim_token）对 reopen 新建 lease + rotate token 友好
- 新错误码注册位置（`core/errors.py` AppError 子类 vs daemon 模块内）

