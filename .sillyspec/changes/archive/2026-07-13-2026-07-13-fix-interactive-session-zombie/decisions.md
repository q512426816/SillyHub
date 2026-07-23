---
author: qinyi
created_at: 2026-07-13T16:11:06
---

# 决策台账 — 修复交互式会话僵尸状态

> 本变更的决策记录。每条含稳定版本 ID（D-xxx@vN）、type、status、source、question、answer、normalized_requirement、impacts、evidence、priority。长期术语待 archive 时再提升到 glossary.md。

---

## D-001@v1 — 病灶A被病灶B覆盖（前提挑战）

- **type**: premise
- **status**: accepted
- **source**: code
- **priority**: P0
- **question**: `dispatch_to_daemon`（placement.py:149-339）创建的 AgentSession 行是否有实际用途？病灶A要不要单独"激活"批量路径的 session？
- **answer**: session 行**必须保留**——它是 `agent_runs.agent_session_id` 的 FK 归属容器（D-005@v1 session↔runs 1:N 契约），且前端 runtimes 会话列表展示。`dispatch_to_daemon` 被 stage/scan/mission worker/quick-chat 广泛使用（test_start_stage_dispatch_transport:13 契约："stage 必须经 dispatch_to_daemon"，bfaa9256 起 lease kind 从 batch 改 interactive）。病灶A的"激活"**不单独动代码**——病灶B修复 close_interactive_run 时按任务类型区分终态（单轮任务 pending→ended/failed 直接收口，跳过 active），自然覆盖批量路径的 pending session。
- **normalized_requirement**: 不删除 dispatch_to_daemon 的 session 创建逻辑。close_interactive_run 的终态回写统一处理所有路径（create_session 主路径 + dispatch_to_daemon 批量路径）的 session。
- **impacts**: FR-1（close_interactive_run 回写）；简化方案，病灶A不再是独立 task。
- **evidence**:
  - placement.py:292-316（raw SQL INSERT agent_sessions pending + UPDATE agent_runs.agent_session_id + 独立 commit）
  - model.py AgentSession.agent_session_id 注释（D-005@v1 session↔runs 1:N）
  - test_start_stage_dispatch_transport.py:13（stage 经 dispatch_to_daemon 契约）
  - DB 实测：7 僵尸 lease.metadata.agent_run_id 全空、turn_count=0、agent_session_id=NULL，精确匹配此路径

---

## D-002@v1 — 单轮/多轮区分门控复用 complete_lease 现有逻辑（SUPERSEDED by D-002@v2）

- **type**: architecture
- **status**: superseded
- **superseded_by**: D-002@v2（Design Grill 发现 ask_user_only 非 AgentRun 字段，v1 门控第 3 条 `getattr(run,"ask_user_only",False)` 恒 False 死代码）
- **source**: code
- **priority**: P0
- **question**: close_interactive_run 回写 session 终态时，如何判断单轮任务（→ended/failed）还是多轮对话（→保持 active）？
- **answer**: ~~复用 complete_lease 门控信号集：change_id 非空 / spec_strategy / ask_user_only~~。v1 的 ask_user_only 条件失效（字段不存在）。
- **normalized_requirement**: 见 D-002@v2。
- **impacts**: 见 D-002@v2。
- **evidence**: v1 原始依据 lease/service.py:559-590、model.py:466-469；ask_user_only 缺陷见 D-002@v2。

---

## D-002@v2 — 单轮/多轮反向判定（多轮=interactive+无 change_id，其余全单轮）

- **type**: architecture
- **status**: accepted
- **supersedes**: D-002@v1
- **source**: design-grill
- **priority**: P0
- **question**: v1 门控第 3 条 ask_user_only 恒 False（AgentRun 无此字段）；如何稳健判定单轮/多轮，且覆盖 oneshot/quick-chat/sillyspec 各类 spec_strategy？
- **answer**: **反向判定**——只识别"多轮对话"，其余全部按单轮任务收口。多轮对话的唯一标识：`run.spec_strategy == 'interactive' AND run.change_id is None`（只有 create_session 主路径 session/service.py:387 的多轮对话满足）。其余所有路径（stage=sillyspec、scan=platform-managed、mission worker、quick-chat、oneshot，无论 change_id）→ turn 完成收口 ended/failed。
- **normalized_requirement**: `_apply_session_terminal_status(run, session)`：`is_multi_turn = (run.spec_strategy == 'interactive' and run.change_id is None)`。多轮 → session=active（保持等下一轮）；非多轮 → run.completed→ended / run.failed→failed。删除 ask_user_only 条件。
- **impacts**: FR-1（回写逻辑）；§7.1 代码；§7.5 契约表；测试 5 类 case。
- **evidence**:
  - model.py:26-304 AgentRun 全字段无 ask_user_only（Design Grill 核实）
  - ask_user_only 实际在 lease.metadata（placement.py:260/448/563）+ AgentSession.config（service.py:1389），非 run 列
  - spec_strategy 取值核实：interactive=多轮对话（session/service.py:387）/ platform-managed=scan（service.py:1291）/ sillyspec=stage（coordinator.py:521）/ quick-chat（main.py:186）/ oneshot（多处）
  - mission worker run 带父 mission change_id（mission.py:100/115），无 change 的自由 mission worker → 非多轮 → 收口（合理，worker 是单轮任务）

---

## D-003@v1 — kill 终态映射 ended（非 failed）

- **type**: boundary
- **status**: accepted
- **source**: code
- **priority**: P1
- **question**: 用户/系统 kill 一个 interactive session 时，session 标 ended 还是 failed？（AgentSession 状态机无 killed 态）
- **answer**: 用户主动 kill = 正常终止 → `session.status=ended`（非 failed）。终态映射：`run.status=killed` + `lease.status=cancelled/completed` + `session.status=ended`。失败（driver error / interactive_failed）才标 `session.status=failed`。
- **normalized_requirement**: cancel_lease interactive 分支调 end_session 等价逻辑（UPDATE session.status='ended' + ended_at=now），reason='killed'。MissionControl.cancel 经 cancel_lease 自动覆盖。
- **impacts**: FR-2（cancel_lease 收口）；数据迁移 D-004（killed→ended 对齐）。
- **evidence**:
  - model.py:466-469（status 取值：pending/active/reconnecting/ended/failed，无 killed）
  - lease_service.py:281-346（cancel_lease 当前 set lease=cancelled + run=killed + WS SESSION_INTERRUPT，不碰 session）
  - session/service.py:786 end_session（写 ended 的现有单事务收口）

---

## D-004@v1 — 数据迁移映射规则

- **type**: boundary
- **status**: accepted
- **source**: code + user
- **priority**: P1
- **question**: 历史 status='pending' 僵尸会话，按 run 终态如何映射 session 终态？
- **answer**: 映射规则：
  - run.status='completed' → session.status='ended'
  - run.status='failed' → session.status='failed'
  - run.status='killed' → session.status='ended'（对齐 D-003）
  - 无关联 run / run 仍 pending（孤儿） → session.status='ended'
  - ended_at = COALESCE(run.finished_at, now)
- **normalized_requirement**: alembic data migration（revision id 唯一化，down_revision='20260712_team_orch'）按上述规则 UPDATE agent_sessions.status + ended_at，仅处理 status='pending' AND deleted_at IS NULL。down 标注不可逆（附 status 快照注释）。
- **impacts**: FR-3（数据迁移）；verify（迁移后无长期 pending）。
- **evidence**:
  - DB 实测：7 僵尸（3 completed / 3 failed / 1 killed）
  - alembic head 官方核实：`alembic heads` = 单 head '20260712_team_orch'，DB stamp 一致（Design Grill 子代理误报 13 head，经官方 `alembic heads` 命令推翻——其未正确处理 merge revision）

---

## D-005@v1 — 并发幂等守卫

- **type**: risk
- **status**: accepted
- **source**: code
- **priority**: P1
- **question**: close_interactive_run 回写 session 终态时，若 session 已被手动 end（ended/failed），是否覆盖？
- **answer**: 不覆盖。仅当 `session.status IN ('pending','active','reconnecting')` 时才回写终态；已 `ended/failed` 的跳过（幂等）。防止：用户手动点结束（end_session 写 ended）后，daemon 延迟到达的 turn result（close_interactive_run）把 ended 覆盖回 active/ended。
- **normalized_requirement**: `_apply_session_terminal_status` 与 cancel_lease 收口均加 `WHERE status IN ('pending','active','reconnecting')` 守卫。
- **impacts**: FR-1 / FR-2 实现细节；测试 case（已 ended 不被覆盖）。
- **evidence**:
  - close_interactive_run（run_sync/service.py:730）与 end_session（session/service.py:786）存在并发到达可能（daemon notifyRunResult vs 用户 POST /end）

---

## D-006@v1 — 方案A backend 集中回写，daemon 零改动

- **type**: architecture
- **status**: accepted
- **source**: user
- **priority**: P0
- **question**: session 终态回写逻辑放 backend 还是 daemon？（详见 step 8 三方案对比）
- **answer**: **方案A** — backend 集中回写，daemon 零改动。close_interactive_run + cancel_lease 在 backend 直接 UPDATE session 终态。
- **normalized_requirement**: sillyhub-daemon 代码零改动。所有 session 终态回写在 backend app/modules/daemon/ 内完成。
- **impacts**: 整体方案；文件清单（无 daemon 文件）；部署（仅 rebuild backend 镜像）。
- **evidence**:
  - daemon 改动成本高（pnpm bundle + 分发 + 部署 + self-update 触发退出重启，参考 docs/sillyspec daemon-self-update 坑）
  - backend 信号全（change_id/spec_strategy 现成），daemon 侧信号不全
  - 用户 step 8 选定方案A

---

## D-007@v1 — 不接线 backend idle sweep（病灶D 砍掉）

- **type**: scope
- **status**: accepted
- **source**: user
- **priority**: P2
- **question**: 是否接线 main.py lifespan 后台 idle sweep（病灶D，30min 无活动转 ended）作为防御纵深？
- **answer**: **不接线**。用户接受多轮对话 session 在 daemon 离线时可能长期 active 的取舍，靠手动 end + daemon 侧 SessionManager._scanIdle（idle 超时→notifySessionEnd）兜底。idle sweep 留作后续防御纵深，不阻塞本次根治。
- **normalized_requirement**: 本次不新增后台定时任务。main.py lifespan 不改。
- **impacts**: 非目标 §3 明确；剩余风险 R-?（多轮对话 daemon 离线卡 active）记录。
- **evidence**: 用户 step 6 范围决策（选 A+B+C，未选 D）

---

## D-008@v1 — cancel_lease 收口范围覆盖所有 interactive-kind lease（含 stage/scan/quick-chat）

- **type**: boundary
- **status**: accepted
- **source**: design-grill
- **priority**: P1
- **question**: cancel_lease 收口段（门控 `lease.kind=='interactive'`）会作用到哪些 lease？stage/scan/quick-chat 批量路径的 lease kind 是什么？design v1 R-03"batch lease 不受影响"是否成立？
- **answer**: **R-03 原论证错误**。Design Grill 核实 placement.py:264 注释明示：dispatch_to_daemon（stage/scan/quick-chat 批量）的 lease kind **也是 interactive**（bfaa9256 起 stage 从 batch 改 interactive）。故 cancel_lease 收口段会作用到**所有 interactive-kind lease**（含 stage/scan/quick-chat 的取消）。语义正确（取消即结束 session），非 bug，但 design 不能声称"batch 不受影响"。第二道门控 `agent_session_id is not None` 同样挡不住（dispatch_to_daemon 路径 run 都有 agent_session_id，placement.py:313）。
- **normalized_requirement**: cancel_lease 收口段门控保持 `lease.kind=='interactive'`（覆盖所有 interactive lease 含批量路径），不额外排除 stage/scan。回归测试**必须**覆盖 stage cancel / scan cancel 路径，确认 session 收口 ended 不破坏现有 stage 生命周期。
- **impacts**: §10 R-03 重写；§5 Wave2 回归范围扩大；test_cancel_lease_session 补 stage cancel case。
- **evidence**:
  - placement.py:264 注释"改 kind=interactive 后必须补"
  - lease_service.py:345 `if lease.kind == "interactive"` 仅控制 WS SESSION_INTERRUPT 下发
  - placement.py:313 UPDATE agent_runs SET agent_session_id（批量路径 run 都有 session FK）
  - test_interactive_session_placement.py:320（bfaa9256 起 dispatch_to_daemon lease kind=interactive 契约）

---

## D-009@v1 — close_interactive_run 回写为"commit 前新 query"（非复用 :1039）

- **type**: consistency
- **status**: accepted
- **source**: design-grill
- **priority**: P2
- **question**: design v1 §5/§7.2 称"复用 :1039 已 query 的 AgentSession 在 :929 commit 同事务回写"是否属实？
- **answer**: **表述错误**。:1039 的 `session = await self._session.get(AgentSession, ...)` 属于 `_resolve_gate_workspace_id` helper（:1042），在 close_interactive_run :942 调用——即 :929 commit **之后**，不在 close_interactive_run 方法体内。close_interactive_run 方法体（:730-1010）无任何 AgentSession query。修正：回写需在 :929 commit **之前新 query** AgentSession 并同事务 add（design §7.2 给的修正代码本身是新 query，正确；仅 §5/§12"复用 :1039"措辞误导，需删除）。
- **normalized_requirement**: §5 Wave1 / §7.2 / §12 删除"复用 :1039 已 query 的 session"表述，改为":929 commit 前新 query AgentSession，set status，同事务 commit"。R-01 应对方向（同事务原子提交）保留。
- **impacts**: 文档真实性；R-01 实现指引。
- **evidence**: run_sync/service.py:1039-1042（_resolve_gate_workspace_id 内，:942 调用即 commit 后）；close_interactive_run :730-1010 方法体 grep 无 AgentSession。
