---
author: qinyi
created_at: 2026-08-23 12:22:00
scale: large
tier: independent
---

# 设计文档（Design）— 工具上报 Agent 日志会话化

## 1. 背景

上一变更（2026-08-23-platform-agent-log-ingest）落地：CLI 探测本地 harness 日志 → `POST /api/agent-logs`（shpsync_ 鉴权，(workspace_id, log_path) upsert 落 `platform_agent_logs`）→ 会话详情尾部 workspace 级流内条目展示（ql-20260823-002-6a1a）。本期把它**会话化**：关联到具体平台会话，或自动创建「本地 Agent 会话」承载，且可继续对话。

用户四点拍板（D-001~D-004）：聚合键=workspace+harness+（change_key|quick_id）；会话可继续聊天派发；展示读库渲染、继续后转 DB 管理、未继续内容查看走 daemon 读本地文件；移除旧 workspace 级条目。

```
场景 A（有关联）                                场景 B（无关联）
平台会话 ─claim(agentSessionId)─> daemon        用户本机终端 → agent CLI
              └─spawn(env+SILLYHUB_SESSION_ID)─> agent CLI
                     └─ sillyspec run               └─ sillyspec run
                          │ 上报 + hub_session_id        │ 上报 + change_key/quick_id
                          ▼                              ▼
              platform_agent_logs.agent_session_id     find-or-create agent_sessions
              = 该平台会话（对话流内折叠条目）         (origin=tool_report, 聚合键) ← entries 链接
                                                            │ 用户首条消息
                                                            ▼
                                              inject 懒激活（绑机器/lease/active）→ 正常派发
```

## 2. 设计目标

见 requirements FR-01~FR-09。核心三条：关联通道唯一可靠路径是 daemon env 注入；自动会话落 `agent_sessions` 加 origin 列（复用列表/详情/继续全部既有链路）；「继续」用 inject 内自动懒激活（前端零新端点）。

## 2.5 非目标（Non-Goals）

同 proposal.md（不入库内容、不做底层 CLI 真 resume、不动鉴权/best-effort、无 TTL）。

## 3. 总体设计（三仓）

### 3.1 sillyspec CLI 仓（协议 v1.1：可选字段，向后兼容）

- `src/run/command.js`：**上报调用块移至 changeName（:507）/quickSessionId（:547-581）解析之后**（Grill P1-3：现位置 :379-393 在解析前拿不到值），增传 `context`：`hubSessionId = env.SILLYHUB_SESSION_ID`（非空才带）、`changeKey`/`quickId`（当前 run 的 change 名；quick 会话拆 quick-<id> 为 quickId，互斥 quick 优先）。
- `src/agent-session-log.js`：
  - **entry 级 ctx（Grill P1-5 修正）**：留底产物与上报 payload 的**每个 entry** 增可选 `change_key`/`quick_id`——检出/更新该 entry 的那次 run 的 ctx 随 entry 持久化（未被本次 run 触及的存量 entry 保留原 ctx，不追新）；body 顶层不再带 ctx（仅 `hub_session_id` 保持 body 级——run 所属会话唯一）。这样变更 B 的日志不会因全量重推挂到变更 A 的会话（D-001「按变更区分内容」按 entry 成立）。
  - `schema_version` 保持 1（纯可选增量）。
- `docs/platform-agent-log-protocol.md` §1 增补：entry 级 ctx 字段、body 级 hub_session_id、daemon 注入 env `SILLYHUB_SESSION_ID` 说明。
- 测试：mock fetch 断言 entry 级 ctx 透传与存量 entry ctx 保留；quick/change 互斥；env 缺省不带。

### 3.2 sillyhub-daemon 仓（env 注入单点）

- 注入键：`SILLYHUB_SESSION_ID`。注入层放 `src/spawn-env.ts` 合并层 tool_config（层 1）**之上**（防 tool_config 大写同名键覆盖，Grill 建议）。
- **两个注入源（Grill P1-4 修正——restore/reload 是从零重建 env，不回放 state.env）**：
  1. create 路径：`daemon.ts` `_startInteractiveSession`（agentSessionId 取 claim payload :3414）→ `buildSpawnEnv` 入参透传；
  2. restore/`_reloadSession` 路径：`interactive/session-manager.ts` 两处 `buildSpawnEnv` 重建（:2655/:3038）增传 `state.sessionId`（SessionState 持有平台会话 id）。
- 测试：三条路径 spawn env 均含 `SILLYHUB_SESSION_ID=<会话id>`；非平台会话派发不含该键。

### 3.3 本仓 backend

#### 3.3.1 数据模型（一个迁移）

- `agent_sessions` 增列：
  - `origin` String(16) NOT NULL server_default 'chat'（'chat' | 'tool_report'）；
  - `aggregation_key` String(255) NULL——tool_report 会话的聚合键文本 `"{harness}|{ctx_key}"`（ctx_key = change_key 或 quick_id 或空）；普通索引 `(workspace_id, aggregation_key)` 查 find 用（非唯一约束：workspace nullable + 并发靠 find-then-insert 容错，撞极小概率重复行时按 last_active_at 取最新，D-006；败者僵尸行接受存在、下次上报自然收敛到最新行，不做清理）；
  - `title` String(255) NULL（Grill P1-1 修正：AgentSession 原无 title 列，router 现由首条 user_input 派生——对 tool_report 会话（发消息前无 user_input）恒空）。chat 会话保持 NULL 走既有派生不变；tool_report 会话写入自动标题；列表 router 标题派生（:1896-1920）改为 `session.title ?? 首条 user_input 派生`；详情经 AgentSessionRead from_attributes 自动带出 title 列值（无派生逻辑，天然兼容）。
- `platform_agent_logs` 增列：`agent_session_id` UUID FK agent_sessions ON DELETE SET NULL NULL + 普通索引。
- 迁移 `20260823120000_agent_log_sessionization.py`（down_revision=当前 head；对称 downgrade；无回填——存量 ws 级展示由 FR-08 移除，存量行不迁移归属）。

#### 3.3.2 schema（platform_sync）

- `AgentLogPushRequest` 增 `hub_session_id: uuid.UUID | None`（body 级）；`AgentLogEntry` 增 `change_key: str | None (max 128)`、`quick_id: str | None (max 128)`（**entry 级**，Grill P1-5；extra=ignore 宽松不变）。
- `AgentLogListItem` 增 `agent_session_id`。
- 会话列表/详情响应（daemon/schema AgentSessionRead）增 `origin: str = "chat"`。

#### 3.3.3 service：`PlatformSyncService.upsert_agent_log_entries` 扩展（关联/聚合）

新入参 `hub_session_id`（body 级）+ `user_id`（token 派生 user，建会话 owner 用），落库后执行归属：

1. **hub_session_id 分支**：select `agent_sessions` where id=hub_session_id AND workspace_id=token 派生 ws AND deleted_at IS NULL——命中 → 该批 entries 全部 UPDATE `agent_session_id`；未命中/跨 ws → 静默跳过归属（entries 仍入库，D-005 best-effort）。
2. **无 hub_session_id 分支（entry 级 ctx 归属，Grill P1-5）**：entries 按 `(harness, coalesce(entry.change_key, entry.quick_id, ''))` 分组；每组 find-or-create：
   - find：`origin='tool_report' AND workspace_id=ws AND aggregation_key="{harness}|{ctx}"` AND deleted_at IS NULL，取 last_active_at 最新一行；
   - create：`AgentSession(id, user_id=token 派生 user, workspace_id=ws, provider=harness 映射（claude-code→'claude'、codex→'codex'、其他→'claude'，D-007), status='pending', origin='tool_report', aggregation_key=…, title="{harness} · {ctx 或 '本地活动'}"（quick_id 显示为 quick 短码）, config_snapshot={"harness":…}, turn_count=0)`；
   - 刷新该会话 `last_active_at = now`；该组 entries UPDATE `agent_session_id`。
3. 归属与 entries upsert 同事务（一次 commit）。

#### 3.3.4 懒激活（daemon/session/service.py `inject_session` 分支）

`_inject_into_session` 前置守卫扩展：`session.origin == 'tool_report' and session.lease_id is None` → 调新私有方法 `_activate_tool_report_session(session, user_id, prompt)`：

1. **机器选择（Grill P1-2 修正）**：不做成员绑定预检，**沿用 `prepare_interactive_dispatch` 内部既有自选**（`_get_online_runtime`：用户自有 first-online + shared 借用）——与 create_session「仅 provider 入口」同语义，不引入新选择器；已知限制记录：多用户共享绑定场景下可能选中与上报机器不同的在线机（cwd 兜底 mkdir 建目录，daemon.ts:3569），接受（个人平台主场景无感）。
2. 补会话字段：`provider`（保持 create 时映射，不覆盖）、`cwd = 最新关联 entry.agent_cwd or workspace.root_path`。
3. 建 interactive lease + 首轮 run：`RunPlacementService.prepare_interactive_dispatch`（与 create_session 同路径，prompt 存 lease metadata；**首条消息即首轮**），`turn_count` 置 1（对齐 create :957）；commit/notify 照 create 自持，`status='pending'→'active'` 由既有派发流转。
4. config_snapshot 补 machine_name（展示）。
5. 已激活（lease 存在）的 tool_report 会话走既有 inject 原路（无特殊分支）。
6. 无在线机器：`NoOnlineDaemonError` 是裸 Exception（placement.py:203-236，Grill P2）——激活分支**自包 AppError 子类**（中文 detail「当前没有可用的在线守护进程，无法继续该会话」+ http_status 409），不裸抛 500。

`GET /api/daemon/sessions` 列表/详情：SQL/DTO 增 `origin` 下发；tool_report 会话 status='pending' 在 router `_SessionStatusQuery` 合法集合内（Grill #4：实际符号名，含 "pending"），无默认 status 过滤、列表不 join daemon——天然可见。

#### 3.3.5 内容查看端点（platform_sync router）

`GET /api/agent-logs/{entry_id}/content`（`_read_auth`，scope 校验 entry 可见）：

1. 读 entry（含 agent_session 关联）→ 定位 daemon_id：entry.agent_session.runtime→daemon_instance_id 优先；无（pending 未激活）→ `resolve_daemon_instance_for_workspace(entry.workspace_id)`；都无 → 404 中文。
2. **直连 `send_host_fs_rpc`/`hub.send_rpc`（Grill P2 修正：`HostFsDelegate.read_file` 走 `_via_rpc_or_degrade` 会把离线/远端错静默降级为空串，与错误语义冲突）**：`host_fs.read_file {path}`，超时 30s；daemon 侧整文件 utf8 读（无上限）——**后端按字节截断尾部 262144**（编码回解时 `errors="ignore"` 防多字节字符被切）后返回 `{content, truncated, size_bytes}`。
3. **format 门控（Grill P2，复核补强：改黑名单）**：format 命中黑名单（`sqlite` / `zstd` 等二进制标识）→ 409 中文「该日志格式为二进制，暂不支持在线查看」；其余（含 `*-jsonl`、`opencode-session-json-tree`、`unknown` 等文本类）放行。
4. daemon 拒绝（allowed_roots 外 / 文件不存在）→ 409 / 404 中文（白名单文案含配置指引）；机器离线 → `DaemonRuntimeOffline` 既有 504（task-05 实证：该类 http_status=504，原设计笔误 503）；RPC 超时同 504。

#### 3.3.6 `GET /api/agent-logs` 增 `session_id` 过滤参数（scope 内校验，越权空列表同既有语义）。

### 3.4 本仓 frontend

- `src/lib/agent-logs.ts`：`listAgentLogs(sessionId)` 改造（query 参数 session_id）；新增 `readAgentLogContent(entryId)`。
- `AgentLogCard` 改造为 `sessionId` 驱动（普通会话尾部折叠条目：查关联 entries，形态沿用 ql-20260823-002 的折叠/展开/复制）；新增 `AgentLogSessionBody`（tool_report 会话内容主体：全量 entries 气泡流渲染，复用 `AgentLogEntry` 行组件 + 「查看内容」按钮调内容端点，抽屉/内联展开显示文本尾部 + 截断提示）。
- `session-list-panel.tsx`：origin=tool_report 条目 🧾「本地 Agent」徽标（brand 语义阶）+ chips（harness engine 色、变更名已含标题）。
- `session-panel.tsx` SessionPanelPage：**判据 `session.turn_count === 0`（Grill P2：turn_count=0 且 origin=tool_report → 纯日志主体）** → 主体渲染 `AgentLogSessionBody`（输入区正常保留，placeholder「发消息继续这个会话（将派发到绑定机器的 agent）…」）；turn_count>0（已继续过）→ 正常对话流 + 尾部关联折叠条目（同普通会话）；**移除** workspace 级 `streamFooter` 挂载（turn-timeline 的 streamFooter 注入口保留，改传会话关联条目）。
- `src/lib/query-keys.ts`：`agentLogs` 键入参从 workspaceId 改为 sessionId（Grill #18）。
- gen:types 同步（AgentSessionRead.origin / agent-logs schema / content 端点）。

## 4. 错误处理

- 归属失败（跨 ws/无会话）静默降级 D-005；激活失败走既有中文错误链路（前端 toast）。
- 内容端点三类失败显式中文（409 白名单 / 503 离线 / 404 无归属）。
- CLI 侧不感知服务端归属结果（任意 2xx 即成功，协议不变）。

## 5. 测试策略

- backend：`test_agent_log_push.py` 增协议 v2 用例（关联命中/降级/聚合幂等/entry 级 ctx 分组/无 ctx 单桶）；`app/modules/daemon/tests/`（平铺目录）增懒激活（成功/离线/已激活直通）与列表 origin 下发；内容端点单测（mock ws_rpc / 黑名单 format 409 / 离线 503 / 超时 504）。
- daemon 仓：spawn env 注入断言。
- CLI 仓：payload 字段断言。
- frontend：列表徽标渲染、tool_report 详情主体、关联折叠条目、旧挂载移除后零残留、内容查看交互（mock）。
- 回归：三仓全量 + gen:types 幂等。

## 6. 文件变更清单（File Changes）

本仓 backend：
- `backend/app/modules/platform_sync/model.py`（AgentSessionLogORM +agent_session_id）
- `backend/app/modules/agent/model.py`（AgentSession +origin/+aggregation_key/+title）
- `backend/migrations/versions/20260823120000_agent_log_sessionization.py`（新）
- `backend/app/modules/platform_sync/schema.py`
- `backend/app/modules/platform_sync/service.py`
- `backend/app/modules/platform_sync/router.py`
- `backend/app/modules/daemon/schema.py`（AgentSessionRead +origin）
- `backend/app/modules/daemon/session/service.py`（懒激活 + 列表 origin）
- `backend/app/modules/daemon/router.py`（列表/详情 origin 下发 + 标题派生改 session.title 优先）
- `backend/app/modules/platform_sync/tests/test_agent_log_push.py`
- `backend/app/modules/daemon/tests/test_tool_report_activation.py`（新）
- `backend/app/modules/platform_sync/tests/test_agent_log_content.py`（新，内容端点用例）
- `backend/app/modules/agent/tests/test_agent_session_model.py`（task-03 披露：字段清单守卫测试随加列机械更新 19→22）
- `backend/app/modules/agent/tests/test_mission_session_id.py`（同上，字段不变守卫）

本仓 frontend：
- `frontend/src/lib/agent-logs.ts`
- `frontend/src/lib/query-keys.ts`
- `frontend/src/components/daemon/agent-log-card.tsx`（改造+AgentLogSessionBody）
- `frontend/src/components/daemon/session-panel.tsx`
- `frontend/src/components/sessions/session-list-panel.tsx`
- `frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`
- `frontend/src/lib/api-types.ts`（gen:types 产物）
- `backend/openapi.json`（gen:types 产物）

主仓 daemon 目录（sillyhub-daemon/ 非独立仓，plan review P1 修正）：

- `sillyhub-daemon/src/daemon.ts`
- `sillyhub-daemon/src/spawn-env.ts`
- `sillyhub-daemon/src/interactive/session-manager.ts`
- `sillyhub-daemon/tests/spawn-env.test.ts`

## sillyspec 仓变更

- `src/agent-session-log.js`
- `src/run/command.js`
- `docs/platform-agent-log-protocol.md`
- `test/agent-session-log.test.mjs`

## 7. 生命周期契约

本变更**新增**生命周期路径（tool_report 会话），复用既有 session 状态机（pending/active/reconnecting/ended/failed），生命周期契约表：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 工具上报（无关联） | SillySpec CLI（REST） | backend 归属服务 | workspace(token 派生)、harness、aggregation_key | find-or-create `origin=tool_report` 会话（status=pending），last_active_at 刷新；已有活跃/终态会话均只刷 last_active_at 不改 status |
| 工具上报（有关联） | SillySpec CLI（REST） | backend 归属服务 | hub_session_id、workspace 校验 | 目标会话 status 不变，仅 entries 挂接 |
| 首条消息（懒激活） | 用户（前端 inject） | backend inject_session | prompt、runtime 绑定成功 | tool_report 会话 pending→（lease+runtime 绑定）→随首轮派发转 active |
| 继续对话/结束/断连/重开 | 既有链路 | daemon | — | 与 chat 会话完全同构（active↔reconnecting↔ended/failed，reopen 既有守卫） |

## 8. 决策记录

- **D-001（用户）聚合键**：workspace + harness +（change_key | quick_id，缺失回落 ws+harness 单桶）——防刷屏且按变更/快速修复区分会话内容。
- **D-002（用户）可继续**：懒激活复用 inject（前端零新端点），首条消息即首轮派发；底层 CLI 真 resume 列二期。
- **D-003（用户）展示与内容**：元信息读库渲染；未继续的内容查看走 daemon `host_fs.read_file`（256KB 截断）；继续后即正常 DB 管理会话。
- **D-004（用户）移除旧挂载**：workspace 级流内条目删除，`streamFooter` 注入口保留复用。
- **D-005 归属 best-effort**：hub_session_id 未命中/跨 ws 静默降级（entries 仍入库），不 4xx——与上报通道 best-effort 语义一致。
- **D-006 聚合并发容错**：aggregation_key 不做唯一约束（workspace nullable），find-then-insert 极小概率并发重复时取 last_active_at 最新，后续上报自然收敛到该行。
- **D-007 provider 映射**：claude-code→claude、codex→codex、其余（zcode 等）→'claude'（激活派发用默认引擎；harness 真实身份由 config_snapshot.harness 展示，创建时写入）。
- **D-008 关联键走 env 而非日志探测**：originator/session_id 探测不可靠（多 harness、cwd 归属弱），daemon 注入 env 是唯一确定性通道（MCP_SESSION_ID 先例）。
- **D-009（Grill P1-5 修正）entry 级 ctx 归属**：CLI 全量重推留底 entries 时，ctx 按「检出/更新该 entry 的那次 run」随 entry 持久化，服务端按 (harness, entry.ctx) 归属——用户「按变更区分会话内容」按 entry 严格成立；body 级仅保留 hub_session_id。
- **D-010（Grill P1-2 修正）激活机器选择回落平台既有语义**：沿用 prepare_interactive_dispatch 内部自选（用户自有 first-online + shared 借用，与「仅 provider 创建会话」同语义），不新增成员绑定预检；多用户共享绑定的错机风险接受并记录（cwd 兜底）。

## 9. 风险登记（Risk）

- **R-01 allowed_roots 覆盖面**：家目录日志大概率不在白名单 → 内容查看大量 409；缓解：错误文案带配置指引，二期可考虑 daemon 侧日志专用白名单。
- **R-02 自动会话 owner**：token 派生 user（多为管理员本人）——他人 token 上报产生他人会话，符合隔离语义。
- **R-03 存量数据**：既有 platform_agent_logs 无归属——不回填（未上线可清），旧 ws 级展示随 FR-08 移除。
- **R-04 三仓联动时序**：后端先落（旧 CLI 上报不带新字段全兼容），CLI/daemon 各自独立发布即可，无部署顺序强依赖。

## 10. 自审（Self-Review）

- 产物门槛：Non-Goals/FR-01~09/文件变更清单/生命周期契约表逐项命中。
- 设计事实均经源码调研锚定（AgentSession 字段、inject 守卫、buildSpawnEnv 单点、host_fs 能力与白名单、列表不 join daemon）。
- Grill 审查待独立子代理（下一步）。
