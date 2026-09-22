---
author: qinyi
created_at: 2026-09-10 08:55:00
change: 2026-09-10-auto-resume-interrupted-turn
scale: large
---

# 设计（Design）— daemon 重启后自动续跑被中断的交互轮

> v2（Grill 独立审查后修订）：吸收 P1-1（SAVEPOINT 事务语义）/P1-2（派发时守卫
> G10）/P1-3（position 队首+满员守卫）与 P2-4/5/6/7/8/9/10/11。

## 背景与目标（问题描述）

daemon 重启时进行中的一轮被收敛 failed(daemon_restarted)、会话自动恢复 active
（上下文完整），但被中断的**任务**需用户手动点失败卡「重新发送」。生产实例：
阿里云会话 e3d7ddfa 单日 3 轮被打断均需人工重发。**目标：重启恢复后，被中断的
任务自动继续执行**（用户确认：全自动+续跑提示词包装+默认开启）。详见 proposal.md。

## 范围与总体方案（设计）

范围=普通单聊主会话（parent NULL 且 kind=chat）；Non-Goals=worker（已有专用
重派）/群聊影子/daemon_stopped/附件自动重发。总体方案：backend 在
`recover_session_after_daemon_restart` 收敛中断轮的同事务内（SAVEPOINT）做 11 道
守卫，全过则把中断轮最后一条 user_input 包续跑提示词、以 origin='auto_resume:<源
run id>' 落排队消息（position 队首）；会话恢复 active 后复用既有 D-008 钩子派发
（派发时加一道 G10 守卫防手动重发竞态），新 run 打 metadata_.auto_resume_of 标记，
链上限 2 次防崩溃循环；`PATCH /sessions/{id}/auto-resume` 会话级开关；daemon 零改动。

## 0. 决策索引

| 决策 | 内容 | 依据 |
|---|---|---|
| D-001@v1 | 入队点在 `recover_session_after_daemon_restart`（与 run 收敛同事务），不在 confirm | recover 手里有 `interrupted_run_id`；confirm 无中断上下文且是 reopen 复用端点 |
| D-002@v2 | 派发主体复用 D-008 钩子 + `dispatch_next_queued_messages`，**派发侧仅加一道派发时守卫（G10）+ 打标传递** | Grill P1-2：仅入队时查最新轮挡不住「confirm 后、派发前用户手重发」竞态——派发重放前须复查 source_run 之后无更新 run |
| D-003@v1 | 续跑提示词包装（非原样重发） | 中断时 agent 可能已执行部分副作用；包装头让 agent 先自查已完成部分再继续（用户确认） |
| D-004@v1 | 默认开启，`session.config.auto_resume_interrupted` 显式 false 关闭 | 用户确认默认开；缺省=开保证存量会话无感生效 |
| D-005@v1 | 链上限 2 次，计数沿 `agent_runs.metadata` 的 `auto_resume_of` 链回溯 | 防 daemon 崩溃循环自动重发风暴；对齐 worker_redispatch 节流思想但更严 |
| D-006@v1 | 仅 `daemon_restarted` 触发；`daemon_stopped`（用户主动优雅停）不复活 | 语义区分：崩溃 vs 用户意图 |
| D-007@v1 | 附件轮降级手动（不自动重发） | 附件引用快照可能过期。检测复用后端单一源 `attachment_marker_line`（session_attachment/service.py:143-145）宽松前缀口径 `^\[附件:<uuid36>\|`（Grill P2-10：kind 词表不硬编码 image\|file，防两处格式漂移） |
| D-008@v1 | 范围=主会话（parent NULL 且 kind=chat） | worker 已有专用重派；群聊影子输入走桥接链路另议 |
| D-009@v2 | 新列：`agent_session_queued_messages.origin`（TEXT NULL，**复合值 `'auto_resume:<源run uuid>'`**，四件套统一口径）+ `agent_runs.metadata`（JSON NULL，ORM 属性名 `metadata_` 照 AgentRunLog 先例 model.py:580-583——`metadata` 是 SQLAlchemy 保留属性，直写报错，Grill P2-5） | 派发成功即删队列行 → 计数唯一持久锚在 run metadata；uuid 无冒号，`split(':',1)` 解析安全（Grill P2-4 核实无硬伤） |
| D-010@v2 | 配置开关走 `PATCH /sessions/{id}/auto-resume`——**路由形态**照 ctx-window 先例（session_crud.py:713-724，owner 校验归 service、204），**存储机制**照 config merge 先例（control.py:574-583：dict 复制后整体赋值；ctx-window 是专用列非 config，不可混引）；请求 DTO 落 `daemon/schema.py`（Grill P2-11） | 两先例各取所长；R6 已核实：session.config 写入面仅 create（整包新建无键可丢）/control merge/inject config_switch 只读不写 config——键不会被覆写丢失（Grill 结案） |
| D-011@v1（Grill P1-1） | 入队段包 SAVEPOINT：`_maybe_enqueue_auto_resume` 全程 `async with svc._session.begin_nested()`——DB 级失败 rollback to savepoint 后**弃续跑保恢复**（主链 commit 照常）；进程崩溃→外层事务全有或全无（run 收敛+入队原子）；纯 Python 异常同 savepoint 收敛 | 「同事务」与「吞异常不回滚主链」在 PG 上矛盾（事务中毒后 commit 必炸）；SAVEPOINT 是唯一同时满足两者的解。SQLite 测试方言更宽松，须专测「INSERT 失败不炸 recover」 |
| D-012@v1（Grill P1-3） | 续跑条目 `position` 显式置**队首**（`MIN(position)-1`）：被中断轮先于重启前已 pending 的追问（它们当初就是在等这轮）——语义=恢复原执行顺序，非"天然 created_at 先"（该声称只在空队列成立，v1 R3 已废）；**满员守卫**：pending ≥ `SESSION_QUEUE_MAX_PENDING`(5) → 弃自动续跑记日志降级手动 | position NOT NULL default 0 与老条目并列会意外重排序；满员插第 6 条破坏前端口径 |
| D-013@v1（Grill P2-6） | 中断时正挂 pending AskUser dialog 的轮**不自动续跑**（G9）：converge 已把 dialog 置 cancelled（recovery.py:266-270），自动续跑会重放原始任务而非"等回答"断点——agent 虽会重问（自愈）但烧链名额+多一轮副作用风险+时间线残留 cancelled 卡，降级手动更稳 | pending_approval ∈ ACTIVE_TURN_STATUSES，等回答也是被中断形态，但断点语义不同 |

## 1. 数据层

### 1.1 migration（线性追加，downgrade 对称）

```
agent_session_queued_messages:
  + origin TEXT NULL          -- 'auto_resume:<源run uuid>' = 续跑条目；NULL = 用户排队（存量）
agent_runs:
  + metadata JSON NULL        -- ORM 属性 metadata_（sa_column=Column("metadata", JSON)）
                               -- 续跑轮: {"auto_resume_of": "<源 run id uuid str>"}
```

- 全 soft-add，旧行 NULL=非续跑；无索引诉求（每会话队列行数小、G8/G10 按
  agent_session_id+status 过滤后小集合扫描）。

### 1.2 配置键

- `session.config["auto_resume_interrupted"]`：三态——`False`=关；缺省/`True`=开。
- 写通道：`PATCH /sessions/{id}/auto-resume`（body `SessionAutoResumeUpdateRequest
  {enabled: bool}` 落 daemon/schema.py；service 层 owner 校验 + config dict 复制
  merge 整体赋值，照 control.py 先例）。
- 读通道：recover 守卫直读 `session.config`。

## 2. 入队（backend，recover 事务内，FR-01/FR-03）

`recover_session_after_daemon_restart` 在 converge interrupted run 之后、写
reconnecting 之前插 `_maybe_enqueue_auto_resume(svc, session, interrupted_run_id)`
（新文件 `daemon/session/service/auto_resume.py`）。**全程 SAVEPOINT（D-011）**：

```
async with svc._session.begin_nested():          # DB 失败 → 弃续跑保恢复
  守卫序列（任一失败 → 记 info 日志 return，SAVEPOINT 正常释放）：
  G1 session.parent_session_id is None and session_kind == 'chat'
  G2 config.get("auto_resume_interrupted") is not False
  G3 interrupted_run.error_code == 'daemon_restarted'（converge 刚写的值，直读 ORM）
  G4 interrupted_run 是会话最新 run（created_at desc + id tiebreak）
  G5 取该 run 最后一条 channel='user_input' 日志（AgentRunLog 按 run 归属，
     id desc limit 1）；无 → 不触发；**长度恰为 5000（inject 落库截断上限
     inject.py:657）→ 视为已截断，不触发**（Grill P2-7：防包装文二次截断退化）
  G6 该日志不含附件标记行（复用 attachment_marker_line 单一源宽松前缀，D-007）
  G7 链上限：自 interrupted_run 沿 metadata_.auto_resume_of 回溯，链长 ≥2 → 不触发
  G8 幂等：不存在 pending 且 origin == f'auto_resume:{interrupted_run_id}' 的条目
  G9 中断时无被取消的 pending dialog：converge 的 cancel_pending_dialogs_for_run
     若取消过 ≥1 行（查该 run 名下 status='cancelled' 的 dialog）→ 不触发（D-013）
  G10' 满员：pending 条目数 < SESSION_QUEUE_MAX_PENDING(5) → 否则不触发（D-012）
  全过 → INSERT AgentSessionQueuedMessage(
          prompt=wrap_resume_prompt(原文),
          sender_user_id=session.user_id,
          origin=f'auto_resume:{interrupted_run_id}',
          position=MIN(pending position)-1)      # 队首（D-012）
```

### 2.1 续跑提示词模板（单一源常量，auto_resume.py 导出，测试锁定）

```
[系统续跑提示] 平台服务重启中断了上一轮执行，会话上下文已完整恢复。
请先检查上一轮已完成的操作（已修改的文件、已执行的命令），确认无误后从断点
继续完成下面的任务；已完成的步骤不要重复执行。

{ORIGINAL_PROMPT}
```

## 3. 派发与打标（backend，FR-02/FR-05）

- confirm 的 D-008 钩子（recovery.py:580-597）零改动：翻 active 后 probe pending
  → fire `dispatch_next_queued_message`。
- `dispatch_queued_messages`（queue.py）重放处两处新增（D-002@v2）：
  1. **派发时守卫（G10）**：`entry.origin` 以 `auto_resume:` 前缀命中 → 查
     source_run 之后会话是否存在更新的 run（created_at 更晚）→ 存在（用户已手动
     重发/新发言）→ **静默删行跳过记日志**（防任务两遍，Grill P1-2）；
  2. **打标传递**：解析 origin 取 source_run_id → inject 调用带可选参
     `auto_resume_of` → `AgentRun(metadata_={"auto_resume_of": ...})`（同事务落，
     无窗口——倾向 inject 可选参，plan 阶段终审签名形态）。
- 恢复失败路径零改动：`mark_session_recovery_failed` → `_fail_pending_queued_messages`
  收敛续跑条目 failed。
- **续跑条目在队列 UI 的语义**（Grill P2-9）：edit 409 拒绝（照 TASK_WAKEUP 条目
  先例 queue.py:446-451，防改坏包装头）；reorder 409 拒绝（队首语义固定）；
  delete 允许=用户手动取消自动续跑（特性，文案注明）。

## 4. 前端（FR-06/FR-07）

- **SessionConfigBar**（`components/sessions/session-config-bar.tsx`，v1 路径笔误
  已正）：新增「中断自动续跑」开关（默认开），调 `PATCH /sessions/{id}/auto-resume`；
  `api-types.ts` 随 OpenAPI 重生成。
- **run-error-item**：`daemon_restarted` 当前不在前端错误码映射（零出现，无现
  hint 可"保持"）——hint 文案由**父级**（持有 session 的会话页/turn-timeline）
  按开关状态经 props 注入：开="服务重启中断本轮，会话恢复后将自动续跑"；关=
  "服务重启中断本轮，会话已保留，可手动重发"（组件自身拿不到 config，DTO 已含
  config schema.py:32，父级下发可行，Grill P2-8）。
- **续跑轮标记**：MVP=包装头原文可见；「自动续跑」徽标（turn-timeline 识别
  run metadata_ 的 auto_resume_of）本期实现。

## 5. 关键时序

```
daemon 重启
  └─ daemon → POST /sessions/{id}/recover {interrupted_run_id}
       ├─ converge run → failed(daemon_restarted) + 取消其 pending dialog   （既有）
       ├─ _maybe_enqueue_auto_resume（SAVEPOINT）：G1-G9+满员 守卫           （新）
       │    └─ INSERT 队列行 origin='auto_resume:<rid>' position=队首 pending
       └─ session → reconnecting + rotate token                              （既有）
  └─ daemon restoreAndReconnect（pi --session / codex resume）
       ├─ 成功 → confirm → active                                            （既有）
       │    └─ D-008 钩子 probe pending → dispatch                           （既有）
       │         └─ G10 派发时守卫：source_run 后有更新 run？→ 删行跳过      （新）
       │              └─ inject（包装 prompt）→ 新 run
       │                   metadata_.auto_resume_of=<rid>                    （新）
       └─ 失败 → mark_recovery_failed                                        （既有）
            └─ _fail_pending_queued_messages 收敛续跑条目                    （既有）
```

## 6. 守卫矩阵测试映射（验收对照）

| 守卫 | 正例 | 反例 |
|---|---|---|
| G1 范围 | chat 主会话触发 | worker/影子不触发 |
| G2 开关 | 缺省触发 | config 显式 false 不触发 |
| G3 错误码 | daemon_restarted | daemon_stopped 不触发 |
| G4 最新轮（入队时） | 中断轮即最新 | 已有更新 run 不触发 |
| G5 输入 | 有 user_input 触发 | 无输入 / 长度=5000 截断不触发 |
| G6 附件 | 纯文本触发 | 含 `[附件:...]` 行不触发 |
| G7 链上限 | 链长 1 触发 | 链长 2 不触发 |
| G8 幂等 | 首次入队 | recover 网络重入不重复入队 |
| G9 pending dialog | 中断时无 dialog 触发 | 中断时挂被取消 dialog 不触发 |
| G10 派发时（queue 侧） | source 后无新 run 派发 | source 后用户已手发 → 删行跳过 |
| 满员（G10'） | 队列 <5 入队 | ≥5 弃自动记日志 |
| SAVEPOINT（D-011） | 守卫正常 | 入队 INSERT 注入失败 → recover 主链照常 commit |
| position（D-012） | 空队/有队首插 | 既有 pending 条目时续跑条目排最前 |

## 7. 风险登记

| # | 风险 | 对策 |
|---|---|---|
| R1 | 副作用重复执行 | D-003 包装先自查；链上限；仅 daemon_restarted |
| R2 | daemon 崩溃循环自动重发风暴 | G7 链上限 2 + G8 幂等 + G10 派发时守卫 |
| R3 | 与用户手动重发/新发言竞态 | **v2 重写**：两层防御——入队时 G4 + 派发时 G10（v1「天然 created_at 先」声称只在空队列成立，已废）；续跑条目队首（D-012）保持与重启前 pending 追问的原执行顺序 |
| R4 | recover 事务膨胀/事务中毒 | SAVEPOINT 隔离（D-011）：DB 失败弃续跑保恢复，进程崩溃全有或全无；G5 单行索引查询 + 单 INSERT，毫秒级 |
| R5 | 旧 daemon/旧 backend 混布 | backend 侧全自洽；旧 backend 无 origin 列照旧人工通道；无协议版本耦合 |
| R6 | config 键被覆写丢失 | **已核实结案**（Grill）：session.config 写入面仅 create 整包（新建无键可丢）/control merge/switch 只读——不存在清除该键的写入方 |
| R7（Grill P2-7） | 续跑链文本退化（包装已截断文本/双层包装头） | G5 截断检测（长度=5000 不触发）降级手动 |
| R8（Grill P2-6） | 等回答轮被自动续跑重放原始任务 | G9：被取消 pending dialog 的轮不自动续跑（降级手动，agent 自愈重问） |

## 8. 模块影响

## 8. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | 两列 soft-add（origin / run metadata_） |
| 新增 | backend/migrations/versions/20260910120000_add_auto_resume_origin_and_run_metadata.py | 线性迁移，downgrade 对称 |
| 新增 | backend/app/modules/daemon/session/service/auto_resume.py | 守卫序列+SAVEPOINT+提示词模板 |
| 修改 | backend/app/modules/daemon/session/service/recovery.py | recover 接线 _maybe_enqueue_auto_resume |
| 修改 | backend/app/modules/daemon/session/service/queue.py | G10 派发时守卫+origin 解析+打标传递+edit/reorder 409 |
| 修改 | backend/app/modules/daemon/session/service/inject.py | auto_resume_of 可选参→AgentRun metadata_ |
| 修改 | backend/app/modules/daemon/router/session_insights.py | SessionRunRead 加 metadata（API 出口，plan 审查 P0-1） |
| 修改 | backend/app/modules/daemon/schema.py | SessionAutoResumeUpdateRequest DTO |
| 修改 | backend/app/modules/daemon/router/session_crud.py | PATCH /sessions/{id}/auto-resume |
| 修改 | backend/app/modules/daemon/session/service/session_lifecycle.py | 开关 config merge 写入（service 归属处） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 重生成（含 SessionRunRead.metadata） |
| 修改 | backend/openapi.json | OpenAPI 随 PATCH 端点与 SessionRunRead 更新 |
| 修改 | frontend/src/lib/daemon/sessions.ts | PATCH 客户端 + 手写 SessionRunRead interface 补 metadata |
| 修改 | frontend/src/components/sessions/session-config-bar.tsx | 「中断自动续跑」开关 |
| 修改 | frontend/src/components/agent-log/run-error-item.tsx | daemon_restarted hint 注入 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | hint 父级计算 + 续跑徽标 |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | enrichDisplayTurns 中继补 autoResumeOf |
| 新增 | backend/app/modules/daemon/tests/test_auto_resume_integration.py | 全链集成验证 |

daemon（sillyhub-daemon）：零改动。测试文件变更随各任务卡 target_files。

## 8.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| daemon 重启 recover | daemon | backend `recover_session_after_daemon_restart` | interrupted_run_id / runtime_id / lease_id / provider / agent_session_id | run：active 态→failed(daemon_restarted)；该 run 的 dialog：pending→cancelled（既有）；session：→reconnecting（既有）；**新增**：续跑队列行 pending（origin=auto_resume:<rid>，SAVEPOINT 内） |
| 恢复成功 confirm | daemon | backend `confirm_session_reconnected` | session_id / runtime_id / lease_id | session：reconnecting→active（既有）；触发 D-008 probe→fire dispatch（既有，零改动） |
| 恢复失败 mark-recovery-failed | daemon | backend `mark_session_recovery_failed` | session_id / runtime_id / reason | session：→failed（既有）；续跑队列行：pending→failed（既有 `_fail_pending_queued_messages`，零改动） |
| 队列派发 dispatch | backend 后台任务 | `dispatch_queued_messages`→inject | entry.origin=auto_resume:<rid>（G10 复查 source 后无更新 run） | 队列行：pending→删除（既有语义）；新 run：pending，metadata_.auto_resume_of=<rid>（新） |
| G10 派发时守卫命中 | backend 后台任务 | —（记 info 日志） | source run 之后存在更新 run | 队列行：pending→删除（跳过派发，防任务两遍） |
| 开关设置 PATCH auto-resume | 前端 SessionConfigBar | backend 端点（owner 校验） | enabled: bool | session.config.auto_resume_interrupted 写入（无行状态变化） |
| 队列 UI delete 续跑条目 | 前端 | backend 队列端点 | 条目 id | 队列行：pending→删除（=用户手动取消自动续跑，特性） |

注：edit/reorder 对续跑条目 409 拒绝（§3）；队列行派发成功即删、失败留 failed 供
重试/删除（既有语义，续跑条目继承）。

## 9. 自审（Self-Review）

- 写作期自审通过项：守卫矩阵逐条有正反用例映射（§6）；数据层 soft-add 可回滚；
  时序图覆盖成功/失败两分支；三处复用点（D-008 钩子/排队派发/失败收敛）声称
  均经源码行号核实；模块影响清单与 tasks T1-T6 对齐。
- 写作期 3 个自审存疑及处置：
  1. ⚠️ inject 打标传递方式（可选参 vs 派发后补 UPDATE）→ 倾向可选参（同事务
     无窗口），plan 阶段终审签名形态（§3 已标注）；
  2. ⚠️ G4 最新轮 created_at 并列 tiebreak → 定为 id 兜底（§2 G4 已写死）；
  3. ⚠️ config_switch 白名单写键集需核实 → Grill 独立审查已核实：switch 只读
     session.config 不写（inject.py:536），键不会被覆写，R6 结案。
- Grill 独立审查（独立上下文子代理）：pass-with-notes（无 P0/3 P1/8 P2），全部
  吸收进本 v2（D-002@v2/D-009@v2/D-010@v2/D-011~D-013、G9/G10/满员、R3/R6/R7/R8）；
  Unresolved Blockers 无。review.json 见
  `.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-09-10-083813/`。
