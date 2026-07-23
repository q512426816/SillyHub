---
author: qinyi
created_at: 2026-07-13T16:11:06
scale: large
---

# 设计文档（Design）— 修复交互式会话僵尸状态

> 简述：根治交互式 AgentSession 状态字段与底层 run 生命周期脱钩，消除"僵尸 pending 会话"。方案A：backend 集中回写，daemon 零改动。

---

## 1. 背景

### 1.1 现象

runtimes 页面会话列表大量显示"待处理"（status=pending）绿色徽标，点进去发现会话早已结束。本机 PG 实测（2026-07-13）：`agent_sessions` 状态分布 active 26 / ended 3 / **pending 7**，7 个 pending 全是僵尸——背后 run 真实状态为 3 completed / 3 failed / 1 killed，没有一个在跑。

### 1.2 根因（3 agent 调研 + DB 验证，推翻初始假设）

僵尸 pending 会话有 **4 个独立来源**，非单一 bug：

| 来源 | 机制 | 代码位置 |
|---|---|---|
| **A. 批量创建不激活** | `dispatch_to_daemon` 用 raw SQL INSERT `agent_sessions(status='pending', turn_count=0)` 独立 commit，从不设 active | placement.py:292-316 |
| **B. 轮次完成不收口（主因）** | `close_interactive_run` 回写 run 终态但全程不碰 session 表；gap-4 的 end_session 链路只在 idle/error/手动/stage-complete_lease 触发，普通对话 turn 完成永不触发 | run_sync/service.py:730-1010 |
| **C. kill 不收口** | `cancel_lease` 只 set run=killed + lease=cancelled，不碰 session.status；`MissionControl.cancel` 同理 | lease_service.py:281-346 / control.py:108 |
| **D. idle sweep 未实现** | 设计文档的"30min idle 自动 end"（task-07 D-004）从未接线，main.py lifespan 无后台扫描 | model.py:497 注释自承 |

### 1.3 DB 铁证（样本 ea65aeee-9ac5-40e9-9490-aaebe6dd82d5）

- session: `status=pending, turn_count=0, last_active_at=NULL, agent_session_id=NULL`（全是初始值）
- lease: `status=claimed`（daemon 正常接管），`metadata.agent_run_id=NULL`
- run: 跑了 26 分钟 26 轮 576 条日志后 `status=failed (interactive_failed)`

字段组合精确匹配 dispatch_to_daemon 批量路径（来源 A），非 create_session 主路径（后者 service.py:442 单 commit，要么全 active 要么全回滚，不存在 pending 残留中间态）。

---

## 2. 设计目标

- **G1**：`AgentSession.status` 准确反映生命周期——创建 dispatch 中=pending、daemon 接手后=active、单轮任务完成=ended/failed、多轮对话 turn 完成=active（等下一轮）、被 kill=ended。
- **G2**：消除存量——历史 7 个（及未来发现的所有同类）僵尸 pending 会话一次性清理。
- **G3**：daemon 零改动（D-006@v1），仅 rebuild backend 镜像即生效。
- **G4**：不回归——现有 interactive lifecycle / change-detail-session / placement 测试全绿。

---

## 3. 非目标

- **N1**：不接线 backend idle sweep（病灶 D，D-007@v1）。多轮对话 session 在 daemon 离线时可能长期 active，靠手动 end + daemon 侧 `_scanIdle` 兜底。
- **N2**：不改 AgentSession 状态机枚举（不加 killed 态、不加 session_kind 字段，D-002@v1）。
- **N3**：不改 sillyhub-daemon 任何代码（D-006@v1）。
- **N4**：不处理 batch lease（stage/scan 经 complete_lease 已有 should_end 门控，lease/service.py:559-590，不在本次范围）。
- **N5**：不做历史兼容（CLAUDE.md 规则 11，可重置开发/测试数据）。

---

## 4. 拆分判断

无需拆分。3 处病灶（A 被 B 覆盖、B、C）+ 数据清理都围绕同一核心 AgentSession 状态机、集中在 backend `app/modules/daemon/`，高耦合不可独立交付。预估 medium 规模，6-8 task，单变更完成。非批量模式（无重复模板×数据结构）。

---

## 5. 总体方案

### Wave 1 — 病灶B 核心：close_interactive_run 回写 session 终态

`close_interactive_run`（run_sync/service.py:730）收到 daemon 的 run 终态通知（notifyRunResult 链路）后，本来只 set `agent_run.status`（completed/failed）+ commit（:929）。新增：在 run 终态 commit（:929）**之前同事务**内，新 query `AgentSession`（close_interactive_run 方法体 :730-1010 原本不触及 session 表，D-009@v1；:1039 的 session query 属于 commit 之后调用的 `_resolve_gate_workspace_id` helper，不可复用），调辅助函数 `_apply_session_terminal_status` 回写 session：

- 单轮任务（D-002@v2 反向判定：非 `interactive+无change_id` 的全部）→ run=completed 写 `ended` + `ended_at`；run=failed 写 `failed`
- 多轮对话（`spec_strategy=='interactive' AND change_id is None`）→ 写 `active` + `last_active_at`（保持，等下一个 AgentRun）
- 幂等守卫（D-005@v1）：仅 `session.status IN ('pending','active','reconnecting')` 才写

此 Wave 自然覆盖来源 A（D-001@v1）：批量路径创建的 pending session 在首轮 turn 完成时直接 pending→ended/failed（跳过 active），无需单独激活。

### Wave 2 — 病灶C：cancel_lease + MissionControl.cancel 收口

`cancel_lease`（lease_service.py:281）interactive 分支（`lease.kind=='interactive'`）在 set `run=killed` + `lease=cancelled` + WS SESSION_INTERRUPT 之后，补 UPDATE `session.status='ended'` + `ended_at`（D-003@v1，kill=正常终止）。`MissionControl.cancel`（control.py:108）经 cancel_lease 自动覆盖，无需单独改。同样幂等守卫。

### Wave 3 — 数据迁移：历史僵尸清理

alembic data migration（D-004@v1），按 run 终态映射 7 类存量 pending→ended/failed。

### Wave 4 — 测试 + 前端微调 + 验收

单测覆盖（4 case 回写 / cancel 收口 / 迁移映射 / 幂等）+ 回归 + 前端文案 P2（"待处理"→"启动中"，可选）。

---

## 6. 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | close_interactive_run（:730）：run 终态 commit 前调 `_apply_session_terminal_status` 回写 session（§5 Wave1） |
| 修改 | `backend/app/modules/daemon/lease_service.py` | cancel_lease（:281）interactive 分支补 UPDATE session=ended（§5 Wave2） |
| 修改 | `backend/app/modules/daemon/session/service.py` | 新增辅助函数 `_apply_session_terminal_status(run, session) -> str`（单轮/多轮门控 + 幂等，D-002/D-005） |
| 新增 | `backend/migrations/versions/20260713_fix_session_zombie.py` | data migration 清历史僵尸，down_revision='20260712_team_orch'（§5 Wave3） |
| 修改（P2 可选） | `frontend/src/components/daemon/session-list-layout.tsx` | pending 文案"待处理"→"启动中"（:67） |
| 新增 | `backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py` | close_interactive_run 回写 4 case（单轮 ended/failed、多轮 active、幂等） |
| 新增 | `backend/app/modules/daemon/tests/test_cancel_lease_session.py` | cancel_lease interactive 收口 + MissionControl.cancel 覆盖 |
| 新增 | `backend/tests/test_session_zombie_migration.py` | data migration 映射正确性 |

**不动**：sillyhub-daemon/* 全部（D-006@v1）、main.py lifespan（D-007@v1）、AgentSession model schema（D-002@v1）。

---

## 7. 接口定义

### 7.1 辅助函数 `_apply_session_terminal_status`

**单轮/多轮判定表**（D-002@v2 反向判定；Design Grill 发现 AgentRun 无 ask_user_only 字段，改用 spec_strategy×change_id）：

| spec_strategy | change_id | 归类 | session 终态（run completed） |
|---|---|---|---|
| `interactive` | None | **多轮对话** | 保持 `active`（等下一个 AgentRun） |
| `interactive` | 非空 | 单轮（stage 经 interactive dispatch） | `ended` |
| `platform-managed` | 任意 | 单轮（scan） | `ended` |
| `sillyspec` | 任意 | 单轮（stage） | `ended` |
| `quick-chat` | 任意 | 单轮（quick-chat） | `ended` |
| `oneshot` / 其他 / None | 任意 | 单轮（mission worker 等） | `ended` |

```python
# backend/app/modules/daemon/session/service.py（新增）
def _apply_session_terminal_status(
    run: AgentRun,
    session: AgentSession,
) -> str | None:
    """根据 run 终态 + 任务类型，计算 session 应进入的终态（D-002@v2 反向判定）。

    多轮对话（spec_strategy=='interactive' AND change_id is None）→ 'active' 等下一轮。
    其余所有任务（stage/scan/mission worker/quick-chat/oneshot）→ 收口：
      run.status='completed' → 'ended'
      run.status='failed'    → 'failed'
    幂等：session 已 ended/failed → 返回 None（不覆盖，D-005@v1）。

    返回新 status 或 None（无需更新）。
    """
    if session.status in ("ended", "failed"):
        return None  # D-005 幂等守卫
    is_multi_turn = run.spec_strategy == "interactive" and run.change_id is None
    if is_multi_turn:
        return "active"  # 多轮对话保持 active，等下一个 AgentRun（非当前 run 续跑）
    return "ended" if run.status == "completed" else "failed"
```

### 7.2 close_interactive_run 回写点

```python
# run_sync/service.py close_interactive_run，:929 commit 之前插入
from app.modules.daemon.session.service import _apply_session_terminal_status
if agent_run.agent_session_id is not None:
    session = await self._session.get(AgentSession, agent_run.agent_session_id)
    if session is not None:
        new_status = _apply_session_terminal_status(agent_run, session)
        if new_status is not None:
            session.status = new_status
            if new_status in ("ended", "failed"):
                session.ended_at = datetime.now(UTC)
            else:
                session.last_active_at = datetime.now(UTC)
            self._session.add(session)
# :929 await self._session.commit()  ← 同事务原子提交
```

### 7.3 cancel_lease 收口点

```python
# lease_service.py cancel_lease interactive 分支，set run=killed + lease=cancelled 之后
if lease.kind == "interactive" and agent_run.agent_session_id is not None:
    session = await self._session.get(AgentSession, agent_run.agent_session_id)
    if session is not None and session.status in ("pending", "active", "reconnecting"):
        session.status = "ended"  # D-003 kill=正常终止
        session.ended_at = datetime.now(UTC)
        self._session.add(session)
```

---

## 7.5 生命周期契约表（session / lease / agent_run / lifecycle / state transition 关键词，必填）

本次变更**补全**的 session 终态收口（标 ★ 为本次新增/修复）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化（修复前 → 修复后） |
|---|---|---|---|---|
| create session（多轮） | backend | daemon | sessionId, leaseId, claimToken, prompt | session: pending → active（service.py:423，主路径已正确） |
| create session（批量/单轮） | backend | daemon | sessionId, leaseId, agentRunId | session: **pending（停驻）** → 修复后由 turn result 收口（D-001） |
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | lease: pending → claimed |
| turn result（单轮任务完成） | daemon | backend | runId, status(completed/failed), output | run: running → completed/failed；**★ session: pending → ended/failed**（D-002） |
| turn result（多轮对话完成） | daemon | backend | runId, status, output | run: running → completed/failed；**★ session: pending → active**（保持，D-002）；session active → active（last_active_at 刷新） |
| session end（手动 / daemon idle / driver error） | daemon / 前端 | backend | sessionId, reason | session: active/pending → ended（end_session:786，已实现，gap-4） |
| ★ cancel / kill（interactive） | 前端 / MissionControl | backend | runId | run: → killed；lease: → cancelled；**★ session: → ended**（D-003，本次补） |

**契约表与代码任务的对应**：
- "turn result（单轮/多轮）" → Wave1 task（close_interactive_run 回写）+ test_close_interactive_run_session_status
- "cancel / kill" → Wave2 task（cancel_lease 收口）+ test_cancel_lease_session
- 其余事件（create/claim/end）链路已实现，本次不改，回归测试守护。

---

## 8. 数据模型

**零结构变更**（D-002@v1）。AgentSession 状态机不变：

```
pending → active → reconnecting → ended
                ↘                ↗
                 → failed ←——
（kill → ended，D-003；无 killed 态）
```

唯一 schema 动作：alembic **data** migration（改数据不改结构），见 §5 Wave3 与 D-004@v1。

---

## 9. 兼容策略（brownfield）

- **C1 零 API/表结构变更**：所有现有端点、DTO、表结构不变。前端、daemon 无感知。
- **C2 已部署旧 daemon 兼容**（D-006 决定性优势）：session 终态回写在 backend 收到 daemon 的 notifyRunResult 后触发，不依赖 daemon 新功能。旧 daemon 照常 notifyRunResult，backend 照常收口 session。
- **C3 回退路径**：data migration down 不可逆（附 status 快照注释）；代码回退=移除 `_apply_session_terminal_status` 调用 + cancel_lease 收口段，session 回到"不回写"原状（僵尸重新积累，但功能不崩）。
- **C4 幂等**（D-005）：重复的 turn result / 手动 end + 延迟 turn result 并发，均不覆盖已 ended/failed 的 session。

---

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | close_interactive_run 事务边界判断错误（回写未进 :929 commit 同事务，或独立 session 写入丢失） | P0 | 实现时确认 :929 commit 前插入回写；测试断言 session.status 与 run.status 同事务落库（roll back 一致） |
| R-02 | 单轮/多轮门控误判（某类任务被错判为多轮，session 卡 active；或反之多轮被收口 ended） | P0 | D-002 复用 complete_lease 已验证门控信号；测试覆盖 stage/scan/mission worker/quick-chat/多轮对话 5 类 |
| R-03 | cancel_lease 收口段会作用到**所有 interactive-kind lease**（含 stage/scan/quick-chat 批量路径，D-008@v1——placement.py:264 起 batch lease kind 也是 interactive） | P1 | 语义正确（取消即结束 session），非 bug，但不能声称"batch 不受影响"；回归测试**必须**覆盖 stage cancel / scan cancel（test_cancel_lease_session 补 case），守护 test_interactive_lifecycle_patch 不破坏现有 stage 生命周期 |
| R-04 | data migration 的 down_revision 撞链（并行变更新增 migration 致 head 偏移） | P1 | execute 前再 `alembic heads` 实测（**Design Grill 已官方核实当前单 head='20260712_team_orch'**，子代理误报 13 head 经 `alembic heads` 命令推翻——未正确处理 merge revision）；revision id 唯一化；记忆 [[migration-chain-fragmentation-pattern]] |
| R-05 | 多轮对话 daemon 离线时 session 长期 active（砍了 idle sweep 的取舍） | P2 | D-007 接受；靠手动 end + daemon 侧 _scanIdle 兜底；后续可补防御纵深 |
| R-06 | 前端"启动中"文案改动影响快照测试 | P2 | 仅 session-list-layout.tsx:67 文案常量；同步更新 __tests__；P2 可选不做 |

---

## 11. 决策追踪

| 决策 ID | 状态 | 覆盖章节 / FR |
|---|---|---|
| D-001@v1 病灶A被B覆盖 | accepted | §5 Wave1（A 并入 B）；§6 文件清单（无独立 A task） |
| D-002@v1 单轮/多轮门控 | **superseded by v2** | 原门控 ask_user_only 非 AgentRun 字段（死代码） |
| D-002@v2 反向判定（interactive+无change_id=多轮，其余单轮） | accepted | §7.1 代码 + 判定表；§7.5 契约表；§5 Wave1 |
| D-003@v1 kill→ended | accepted | §7.3（cancel_lease）；§7.5 契约表 |
| D-004@v1 迁移映射 | accepted | §5 Wave3；§8 |
| D-005@v1 幂等守卫 | accepted | §7.1 / §7.3（WHERE status IN...） |
| D-006@v1 方案A daemon 零改动 | accepted | §3 N3；§6（无 daemon 文件）；§9 C2 |
| D-007@v1 不接线 idle sweep | accepted | §3 N1；R-05 |
| D-008@v1 cancel_lease 收口覆盖所有 interactive-kind lease | accepted | §10 R-03；§5 Wave2 回归扩 stage/scan cancel |
| D-009@v1 回写为 commit 前新 query（非复用 :1039） | accepted | §5 Wave1；§7.2；R-01 |

无未解决决策。

---

## 12. 自审

| 检查项 | 结果 | 说明 |
|---|---|---|
| 需求覆盖 | ✅ | 病灶 B（含 A，D-001）+ C + 数据清理全覆盖；用户范围决策（A+B+C+迁移）全落地 |
| Grill/决策覆盖 | ✅ | design 引用全部 D-001~D-007@v1（§11 追踪表） |
| 约束一致性 | ✅ | 符合 CONVENTIONS（SQLAlchemy AsyncSession 显式 commit）、ARCHITECTURE（backend 单一数据后端、daemon 经 lease+WS） |
| 真实性 | ✅（Design Grill 修正后） | 表名/方法/行号实测；alembic head 经官方 `alembic heads` 核实单 head='20260712_team_orch'（子代理误报 13 head 已推翻）；ask_user_only 非 AgentRun 字段已修正（D-002@v2 反向判定）；":1039 复用"表述已修正为 commit 前新 query（D-009@v1） |
| YAGNI | ✅ | 不加 session_kind 字段、不接线 idle sweep、不改 daemon、不引入新端点 |
| 验收标准 | ✅ | §7.5 契约表每个事件对应 task+测试；G1-G4 可测；verify DB 实测无长期 pending |
| 非目标清晰 | ✅ | §3 N1-N5 明确 |
| 兼容策略 | ✅ | §9 C1-C4 |
| 风险识别 | ✅ | §10 R-01~R-06 含 P0 事务/门控风险；R-03 已按 D-008 修正 |
| 生命周期契约表 | ✅ | §7.5 含完整事件表，每个事件有必需字段 + 状态变化 + 对应 task/测试 |
| Design Grill 交叉审查 | ✅ | 子代理 adversarial 审查发现 5 项（B-1~B-5），B-1(alembic) 经官方命令推翻为误报，B-2/B-3/B-5 已修正（D-002@v2/D-008/D-009），B-4 由 D-002@v2 反向判定顺带解决。无 P0/P1 未决 blocker |

**自审 + Design Grill 结论**：通过。Design Grill 已执行，3 项实质修正（删 ask_user_only 死代码 / 修正 R-03 batch 论证 / 修正 :1039 表述），alembic 误报已官方命令推翻。无 P0/P1 blocker，进入 Step 13。
