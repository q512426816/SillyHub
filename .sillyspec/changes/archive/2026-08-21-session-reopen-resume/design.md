---
author: qinyi
created_at: 2026-08-21 11:19:15
scale: large
change: 2026-08-21-session-reopen-resume
---

# 设计文档（Design）— 打通会话重新开启（reopen）链路

> 版本：v2（2026-08-21 独立审查 fail 后修订：修复 F1 confirm 封装前置条件、F2 超时基准选列，吸收 5 项 gap）

## 1. 背景与问题

平台交互会话（`agent_sessions`）支持"结束后重新开启"（reopen，`POST /api/daemon/sessions/{id}/reopen`），前端会话页也已有"重新开启"按钮（`frontend/src/app/(dashboard)/sessions/page.tsx:1010`）。但该功能在生产上从未真正可用，存在三处断链（2026-08-21 双子代理行级验证 + 独立设计审查复核结论）：

1. **恢复钥匙断链**：`AgentSession.agent_session_id`（SDK resume key，`backend/app/modules/agent/model.py:589`）全仓库无生产代码写入——daemon 重启恢复上报时后端仅作日志（`daemon/session/service.py:1843` "log/audit only"），只有测试手动 seed 过。而 reopen 硬依赖该列（`daemon/session/service.py:2348`，空则 409）→ **生产上点"重新开启"必 409**。同时 daemon 每轮上报的 SDK 会话 id 已流入 `AgentRun.session_id`（`daemon/run_sync/service.py:746-749`），数据在库只是没回填。
2. **状态翻转断链**：reopen 后 daemon 侧 `_routeSessionResume`（`sillyhub-daemon/src/daemon.ts:2944-3008`）能从零重建会话并 `driver.start({resume})`（不依赖内存 Map 与本地 sessions.json，已验证），但成功后只调 `notifySessionReady`，后端 `router.py:1343` 仅记日志不翻状态 → 会话永远停在 `reconnecting`，后续 inject 因 `status != "active"` 409（`session/service.py:1177`），前端输入框永久禁用。
3. **卡死无兜底**：恢复过程 WS 丢失 / `SessionAlreadyExistsError`（`session-manager.ts:2439`，在进入 try 块**之前**抛出，现有 onSessionEnd(failed) 收敛并不覆盖它）时，会话卡 `reconnecting`：再点 reopen 报"仍活跃"（`session/service.py:2353`），inject 报"未激活"，两头堵死。现有的 `alert_stuck_terminating_leases`（`daemon/lease_service.py:283`）仅告警不收敛，注释中承诺的 "task-07 idle sweep" 无收敛实现。

## 2. 目标与非目标

**目标**：用户可随时"重新开启"已结束会话并继续对话（客户端式体验），无需保持任何激活状态；异常卡死有手动重试 + 自动收敛双保险。

**非目标（不在范围内 / Non-Goals）**：
- 跨机器恢复（transcript 在原机器 `~/.claude/projects/` 磁盘上，恢复必须路由回原 runtime——`runtime_id` 已钉定，天然满足；跨机器属远期方向）
- 对话记录（transcript）云端备份 / 无状态历史重建（原方案 C，本次不做）
- 闲置会话自动回收策略调整（idle 回收默认关闭维持现状）
- daemon 侧 SESSION_RESUME 处理逻辑重写（已验证可用，仅补确认回调）

## 3. 方案总览（用户已确认：方案 B 双端协议确认）

```
浏览器"重新开启" ──▶ POST /sessions/{id}/reopen
                        │ 校验: agent_session_id 非空 + cwd 非空 + runtime 在线 + 状态可重开
                        ▼
              新 interactive lease（旋转 claim_token）+ WS SESSION_RESUME
                        │ payload: session_id/lease_id/agent_session_id/cwd/provider/runtime_id
                        ▼
        daemon _routeSessionResume：从零构造 SessionState + driver.start({resume})
              │                                    │
              │ 恢复成功                            │ 恢复失败 / SessionAlreadyExists
              ▼                                    ▼
   hubClient.confirmReconnected(        hubClient.markRecoveryFailed(
     sessionId, runtimeId, leaseId)       sessionId, runtimeId, leaseId, reason)
              │（runtimeId 取自 SESSION_RESUME payload，F1 修复）  │
              ▼                                    ▼
   后端校验 lease_id 匹配后               后端校验 lease_id 匹配后
   翻 reconnecting → active              置 failed（可再次 reopen）
              │
              ▼
   用户 inject 继续对话（SSE 通道既有 agent_session:{id} 不变）

  兜底（并行）：手动重试窗口（reconnecting 且 last_active_at 超时 180s 允许再次 reopen）
              + 后端巡检协程（同基准超时自动收敛 failed）
```

数据层补齐（前提）：增量回填 + 存量迁移，让 `agent_sessions.agent_session_id` 真正持有恢复钥匙。

## 4. 详细设计

### DS-1 增量回填 resume key（backend）

- 位置：`daemon/run_sync/service.py` `submit_messages` 内，现有 `latest_session_id` 写 `AgentRun.session_id` 的同代码块（:746-749 附近；该处为"仅空时写"，保留不动）。
- 逻辑：若 `agent_run.agent_session_id`（会话 FK）非空（batch run 该 FK 为 None，跳过），`get(AgentSession, fk)` 后执行**最新值覆盖**：`session.agent_session_id = latest_session_id`（无条件覆盖，非"仅空时写"——fork/reload 会换新 id，旧 key resume 会回到分叉前历史，语义错误）。
- 事务：与现有消息落库同一 `commit()`（:771），无新增竞态；会话行在 `create_session` 的 commit（`session/service.py:903`）后必然已存在。
- 并发语义（审查修订）：覆盖写为最终一致（以最后到达消息为准）；乱序迟到的旧 id 可能把 key 短暂回退到 fork 前值——窗口极小且同会话下一次消息上报自愈，风险登记在案不加去重复杂度。
- 依据：双子代理验证第 2/3 项——两 provider 的 id 均经消息顶层 `session_id` 字段流入（claude 为 SDK 每条消息顶层 session_id；codex 为 `toFlatMessage` 注入 thread id，`codex-app-server-driver.ts:415-426`），且会话内稳定。

### DS-2 存量迁移回填（backend Alembic）

- 仿 `backend/migrations/versions/20260713_fix_session_zombie.py` 数据迁移先例：raw SQL + 不可逆 downgrade（downgrade 为 no-op 并注释说明）+ 独立测试文件。
- SQL 语义：`UPDATE agent_sessions s SET agent_session_id = (SELECT r.session_id FROM agent_runs r WHERE r.agent_session_id = s.id AND r.session_id IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) WHERE s.agent_session_id IS NULL AND s.provider IN ('claude','codex') AND s.deleted_at IS NULL`——取**最后一轮** run 的值（fork 场景取最新 id）。
- 注意 PostgreSQL 方言为主，测试环境 aiosqlite 的子查询兼容性按 zombie 迁移先例处理。

### DS-3 daemon 恢复成功/失败双向确认（sillyhub-daemon）【F1 修复核心】

- **前置条件（F1）**：`hub-client.ts` 的 `confirmReconnected`（:809-818）与 `markRecoveryFailed`（:824-835）开头均有 `if (!runtimeId) return;` 静默吞掉，而 runtimeId 取自 `_recoveryRuntimeBySession` 映射——该映射**仅** `recoverSession`（:800，daemon 重启链路）写入。reopen 链路不经 recoverSession，必须显式供 runtimeId：`_routeSessionResume` 从 SESSION_RESUME payload 解析 `runtime_id`（payload 已含，`backend session/service.py:2431`），写入 `_recoveryRuntimeBySession` 映射（与 recover 链路同构）或给两个封装加可选 runtimeId 参数——execute 时二选一，以改动最小者为准，**禁止**依赖映射里不存在的值。
- 成功路径：`daemon.ts` `_routeSessionResume`（:2944-3008）在 `restoreAndReconnect` 成功、`notifySessionReady` 之后调 `hubClient.confirmReconnected(sessionId, {leaseId})`。best-effort 语义：调用失败仅告警不回滚（WS 断线由后端兜底收敛）。
- 失败路径：`SessionAlreadyExistsError` 在进入 try 前抛出（`session-manager.ts:2439`，现有收敛不覆盖）——需把该异常纳入恢复失败分支；与 `restoreAndReconnect` 抛错一并调 `hubClient.markRecoveryFailed(sessionId, {leaseId, reason})`，让后端**立即**置 failed（而不是等兜底巡检）。
- 确认绑定 lease（审查 gap 修复）：confirm / mark-recovery-failed 均携带本次 SESSION_RESUME 的 `lease_id`，供后端做陈旧确认防误翻（见 DS-4）。
- 同步修正 `daemon.ts:2932` 与实现矛盾的注释（"backend 收 confirm 切 active"现为事实）。

### DS-4 后端 confirm-reconnected 服务 reopen 流程（backend）

- `confirm_session_reconnected`（`session/service.py:2060-2122`）已有 `reconnecting → active` 翻转（daemon 重启恢复链路在用，审查确认**无** recover-only 守卫，比预期更省事；幂等行为为"非 reconnecting 时返回当前状态，不报错"）。
- **陈旧确认防误翻（gap 修复）**：请求体 `SessionRuntimeRequest` 增加可选 `lease_id`；提供时校验 `lease_id == session 当前 lease_id`，不匹配视为过期尝试（幂等返回当前状态，不翻不变）。未提供时（既有 daemon 重启恢复链路）维持现状——向后兼容。
- `mark_session_recovery_failed` 同样接受可选 `lease_id` 并做同样校验。
- `notify_session_ready` 端点维持仅记日志（readiness 事件），**状态翻转单一真理源 = confirm-reconnected**，避免双写歧义。

### DS-5 手动重试窗口（backend + frontend 微调）【F2 修复】

- reopen 前置校验放宽：`status == "reconnecting"` 且**超时**即放行 reopen（重新旋转 lease/claim_token 重发 SESSION_RESUME）；窗口内维持现状 409（恢复还在路上）。
- **超时基准（F2）**：`session.last_active_at` 距今 > 180s——**不用** `lease.created_at`：reopen 路径新建 lease 属实（`session/service.py:2389-2404`），但 `recover_session_after_daemon_restart` 只轮换既有 lease 的 claim_token（:1926-1941，不新建行），长会话 daemon 重启后 lease.created_at 早超窗，会把恢复进行中的会话误判超时；两条路径翻转 reconnecting 时均写 last_active_at 为 now（:1929、:2414），以它为基准对两路径一致。execute 时核实 reopen 路径确写该列，未写则补写。
- 前端：`reconnecting` 状态本地计时超过 **240s**（比后端 180s 多 60s 缓冲，保证按钮出现时后端窗口必然已开，避免吃到"仍在窗口内"的 409）仍未 active 时，在既有 ended/failed 横幅位置显示同样的"重新开启"入口（复用 `handleReopen`，`sessions/page.tsx:746`）；不改 DTO（前端本地判断，后端为权威校验）。

### DS-6 自动巡检收敛（backend）

- `backend/app/main.py` lifespan 新增常驻协程 `session_reconnect_sweeper`（仿 `mission_patrol_loop` 先例，`main.py:192`），周期 60s：
- 扫描 `status == "reconnecting"` 且 `last_active_at` 距今 > 180s（与 DS-5 同基准同阈值）的会话 → 置 `failed`（`ended_at` 写入）、挂起 lease 置 **`cancelled`**（审查 gap 修复：明确取值——`expired` 在 `expire_leases` 中仅适用于 `lease_expires_at` 非 NULL 的租约（`lease/service.py:853-864`），interactive lease 恒为 NULL，选 `cancelled` 与"恢复放弃"语义一致）。
- 幂等：`UPDATE ... WHERE status='reconnecting'` 条件更新，多 worker 重复执行无害（本项目单 backend 实例部署）。
- 该协程同时覆盖"旧版 daemon 未升级不发 confirm"的过渡期。

### DS-7 scan 类会话排除（backend）

- reopen 前置校验新增：`session.cwd` 为空 → 409 专用错误码。错误类定义位置按现状放 `session/service.py` 异常区（:181-213 一带）+ `core/errors.py` 惯例（注：模块无独立 errors.py，v1 写法有误），文案中文："该会话无关联工作目录，无法恢复对话记录"。
- 依据：scan/bootstrap 会话创建时不写 cwd（`agent/service.py:1709`、`spec_workspace/bootstrap.py:498`），claude transcript 按 `projects/<encoded-cwd>/` 定位，空 cwd 必然 resume 失败，提前拒绝优于让 daemon 报错。

### DS-8 前端微调（frontend，无结构性变化）

- "重新开启"按钮启用条件从 `ended/failed` 扩展到"reconnecting 本地计时 >240s"（DS-5）；后端 409 错误提示透传文案中文化（`notify.error` 现直接弹后端英文原文）。
- 若 backend DTO/schema 变更（SessionRuntimeRequest 加可选 lease_id 会进 OpenAPI）→ 按仓库规则跑 `pnpm gen:types` 并提交 `api-types.ts` + `openapi.json`。

## 5. 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| reopen 请求（窗口外） | 浏览器 | backend `POST /sessions/{id}/reopen` | session_id；前置：agent_session_id 非空、cwd 非空、runtime 在线、status ∈ {ended, failed} | session: ended/failed → reconnecting（写 last_active_at=now）；新建 interactive lease（旋转 claim_token）；WS `daemon:session_resume` |
| reopen 请求（reconnecting 且 last_active_at 超时 >180s） | 浏览器 | backend 同上 | 同上 | 同上（旧挂起 lease 置 cancelled，再新建） |
| SESSION_RESUME | backend WS Hub | daemon `_routeSessionResume` | session_id, lease_id, agent_session_id, cwd, provider, runtime_id | daemon 侧从零重建 SessionState + 写 `_recoveryRuntimeBySession` 映射（F1）；DB 无变化 |
| confirm-reconnected（恢复成功） | daemon | backend `POST /sessions/{id}/confirm-reconnected` | session_id, runtime_id, **lease_id（新，可选）** | lease_id 匹配当前 lease 且 status=reconnecting → active；不匹配或非 reconnecting → 幂等返回当前状态不翻转（防陈旧确认误翻第二次 reopen） |
| mark-recovery-failed（恢复失败/冲突） | daemon | backend `POST /sessions/{id}/mark-recovery-failed` | session_id, runtime_id, **lease_id（新，可选）**, reason | lease_id 匹配且 status=reconnecting → failed（可再次 reopen）；不匹配 → 幂等跳过 |
| 消息上报（含 resume key 回填） | daemon | backend `POST /leases/{lease_id}/messages` | 消息顶层 session_id（SDK 会话 id） | AgentRun.session_id 填充（既有，仅空时写）+ AgentSession.agent_session_id 最新值覆盖（新增） |
| 兜底巡检收敛 | backend sweeper 协程 | DB 直写 | 无外部触发；条件 status=reconnecting 且 last_active_at 超时 >180s | session: reconnecting → failed；挂起 lease → cancelled |
| inject（恢复后对话） | 浏览器 | backend `POST /sessions/{id}/inject` | session_id, content；前置 status=active | session 保持 active；turn_count+1；新 AgentRun |

既有不变契约：`AgentRun.session_id`（claude resume id，D-001@v1）语义不动；session↔runs 1:N（D-005@v1）不动；`AgentSession.agent_session_id` 注释声明的"SDK resume key"语义本次首次真正落地。

## 6. 文件变更清单（File Changes）

| 文件 | 变更 |
|---|---|
| `backend/app/modules/daemon/run_sync/service.py` | DS-1 增量回填（submit_messages 内，约 :746 块） |
| `backend/migrations/versions/20260821120000_backfill_session_agent_session_id.py` | DS-2 新增存量迁移（+ 独立测试文件；文件名为 task-02 任务卡定案，挂 alembic head 20260821100000 之后） |
| `backend/app/modules/daemon/session/service.py` | DS-4 confirm/mark-failed 可选 lease_id 校验；DS-5 reopen 超时窗口（last_active_at 基准）；DS-7 cwd 空拒绝（异常定义于本文件异常区） |
| `sillyhub-daemon/src/daemon.ts` | DS-3 双向确认回调（含 runtimeId 供给与 SessionAlreadyExists 分支）+ 注释修正 |
| `sillyhub-daemon/src/hub-client.ts` | DS-3 runtimeId 参数化或映射写入（F1）；confirm/mark-failed 携带 lease_id |
| `backend/app/modules/daemon/sweep.py`（新文件，或并入 session service 层） | DS-6 巡检协程 |
| `backend/app/main.py` | DS-6 lifespan 挂载 sweeper |
| `frontend/src/app/(dashboard)/sessions/page.tsx` | DS-5/DS-8 重开按钮条件放宽（reconnecting 本地计时 >240s）+ 文案 |
| 测试 | backend：run_sync 回填（含 fork 覆盖、batch 跳过）、reopen 窗口两分支、confirm/mark-failed 幂等与 lease 绑定、sweeper 收敛、迁移；daemon：resume 成功/失败回调、runtimeId 供给；frontend：按钮条件 |

## 7. 风险登记（Risk）

| 风险 | 等级 | 缓解 |
|---|---|---|
| daemon+backend 必须同步发版，旧 daemon 不发 confirm → 卡 reconnecting | 高 | DS-6 巡检 + DS-5 手动窗口双兜底覆盖过渡期；发版顺序先 backend 后 daemon |
| F1：hub-client 确认封装静默吞（runtimeId 映射仅 recover 链路写入） | 高 | DS-3 前置条件：SESSION_RESUME payload 自带 runtime_id，显式供给；daemon 测试断言"confirm 真正发出" |
| 迟到的陈旧确认误翻/误杀第二次 reopen 的 reconnecting | 中 | DS-4 confirm/mark-failed 绑定 lease_id 校验，不匹配幂等跳过 |
| 乱序迟到消息把回填 key 短暂回退 fork 前值 | 低 | 最终一致：同会话下一次上报自愈；不引入去重复杂度 |
| SQLite 测试环境对迁移子查询的兼容 | 低 | 按 zombie 迁移先例处理；迁移带独立测试 |
| 存量 run 无 session_id（老数据）回填不全 | 低 | 预期内：这类旧会话本就无法恢复（SDK transcript 可能已不存在），维持 409 拒绝 |
| sweeper 误伤"恢复慢但正在路上"的会话 | 低 | 180s 窗口 >> 正常恢复秒级耗时；failed 可再次 reopen，损失一次重试成本；基准用 last_active_at（F2 修复后对 recover/reopen 两路径一致） |
| 多 worker 部署 sweeper 重复执行 | 低 | 条件更新幂等；当前单实例部署 |

## 8. 测试策略

- backend（pytest，按模块测试目录惯例）：DS-1 回填（含 fork 覆盖、batch run 跳过）；DS-4 confirm/mark-failed 幂等 + lease_id 不匹配跳过；DS-5 窗口内外两分支；DS-6 sweeper 收敛与幂等；DS-7 cwd 空 409；DS-2 迁移 up/down。
- daemon（vitest）：_routeSessionResume 成功调 confirmReconnected（含 runtimeId 供给断言，防 F1 回归）、SessionAlreadyExists 与失败路径调 markRecoveryFailed、best-effort 不阻塞。
- frontend（vitest）：reconnecting 本地计时 >240s 显示重开入口。
- 联动验收（verify 阶段）：本地起 postgres+redis，模拟 daemon（测试桩）走通 reopen→resume→confirm→inject 全链路。

## 9. 自审（Self-Review）

- 链路完整性：三处断链（钥匙/翻转/兜底）各有 DS 对应，闭环。✔
- 独立审查 v1 两阻断已修：F1（DS-3 前置条件 + 测试断言）、F2（DS-5/6 改 last_active_at 基准）；5 项 gap 全部吸收（lease 绑定、cancelled 取值、措辞修正、错误类位置、前端 240s 缓冲）。✔
- 与现有决策一致性：D-001@v1（run.session_id 不动）、D-005@v1（1:N 不动）、D-004（注释承诺的 sweep 本次落地）无违反。✔
- 最小改动面：未引入新表/新端点/新 WS 消息类型，全部复用既有设施（confirm/mark-recovery-failed 端点、hub-client 封装、lease 旋转、patrol 先例）；唯一 schema 变更为既有请求体加可选 lease_id（向后兼容）。✔
- 遗留确认点（execute 时核实，不阻塞设计）：reopen 路径写 last_active_at 的落点；F1 选"映射写入"还是"参数透传"；DS-6 sweeper 放独立文件还是 session service 层。✔ 已在风险表登记
- 规模判定：跨 backend+daemon+frontend 三模块、含状态机变更与数据迁移 → **scale: large**，走四件套 + plan。✔
