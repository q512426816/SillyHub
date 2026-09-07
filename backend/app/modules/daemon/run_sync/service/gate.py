"""gate 决策簇（task-10 拆分）：close 收口后的 verify gate 后台任务。

_is_gate_rejected_first_failure（闸拒绝失败收口触发面判定）/ _gate_applicable
（仅 verify stage completed run 进 gate）/ _resolve_gate_workspace_id /
_run_gate_decision_task（H1 独立 session + R3 cas 抢占 + 跑 gate + 落
gate_result + SSE）/ _publish_gate_status_changed / _resolve_gate_spec_root
（code_root / spec_dir 分离）。

D-007（本拆分 patch 面的精确落点）：get_session_factory（1 处 patch，
test_run_sync_gate_decision_task:419）与 _run_gate_via_delegate（1 处 patch，
:250）均为本命名空间 patch 目标——本子模块一律 ``import
app.modules.daemon.run_sync.service as _rsvc`` 后经 ``_rsvc.`` 延迟解析；
get_redis（43 处 patch 之一）与 log 同理。
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.session.service import get_session_readiness


async def _is_gate_rejected_first_failure(svc, agent_run: AgentRun, session: AgentSession) -> bool:
    """task-06 / FR-06 / D-006@v1（Grill M1-R 终版）：闸拒绝失败收口触发面判定。

    daemon 会话闸（task-04 SessionManager.create 抛 SessionLimitReached）拒绝
    的分身子会话：daemon notifyRunResult 标首 run failed 回传，但会话从未
    mark_ready（闸拒绝发生在 create 阶段，daemon 从未上报 ready——探测口径
    对齐 session/service.py :3021 clear 先例）。三条件齐备才命中，缺一不可：

    ① ``run.status == "failed"``（首 run completed 不涉及）；
    ② 首 run——该会话 AgentRun 行数恰 1（即本 run；调用点 pending 写入已
       add，count 查询 autoflush 后本 run 在内，追问轮行数 > 1 不命中）；
    ③ 会话从未 ready（readiness 单例只读直探 ``_ready`` 成员——不建
       ``_events`` 残留槽位）且 ``parent_session_id`` 非空（分身子会话，
       普通用户会话 NULL 不涉及）。

    追问轮中途失败的存活分身（曾 mark_ready / 已有更早 run）、首 run
    completed、parent NULL 普通会话均不命中（触发面收窄防误杀——turn 失败
    ≠会话死亡，P1 原则）。命中由调用方覆写多轮 keep-active 为 failed（对齐
    P1 ``_fail_worker_subsession`` 语义，非 ended），杜绝闸拒绝后子会话占
    daemon 会话额度且 mission 卡死。

    Note: 只读探测（readiness 单例 + 一次 count 查询），不改
    daemon/session/service.py（约束铁律），不修改传入对象。
    """
    if agent_run.status != "failed":
        return False
    if session.parent_session_id is None:
        return False
    if session.id in get_session_readiness()._ready:
        return False
    run_count = await svc._session.scalar(
        select(func.count()).select_from(AgentRun).where(AgentRun.agent_session_id == session.id)
    )
    return run_count == 1


# ── Driver Gate enqueue helpers（task-05 / design §5.1） ─────────────────


async def _gate_applicable(svc, agent_run: AgentRun) -> bool:
    """gate 仅 verify stage 的 completed run 跑（design §5.4 gate 当前仅 verify）。

    change_id 非空 + completed 但 ``current_stage`` 非 verify（quick / brainstorm /
    plan / execute / archive）的 run 不进 gate：这些 stage 无 verify gate 产物，
    强行跑 ``sillyspec gate verify`` 必然解析失败 exit 2 误报失败（quick 独立
    quicklog 流程、change_key 含中文等尤甚——实测见 ql-20260813-006）。落库的
    ``change`` 经 identity map 命中（close 内已 get 过），不额外查库。
    """
    if agent_run.change_id is None or agent_run.status != "completed":
        return False
    from app.modules.change.model import Change

    change = await svc._session.get(Change, agent_run.change_id)
    return change is not None and change.current_stage == "verify"


async def _resolve_gate_workspace_id(svc, agent_run: AgentRun) -> uuid.UUID | None:
    """推导 gate 任务所需 workspace_id（task-05）。

    稳定来源优先级（design §5.1）：
      1. Change.workspace_id —— stage run 必有 change，且与
         _trigger_stage_completion_callback:1029 同一来源，一致。
      2. AgentSession.workspace_id（D-003@v1 change-scoped binding）兜底。
    失败返回 None（caller 已守门 change_id 非空，此处只兜底查不到的极端），
    不抛 —— gate enqueue 不得影响已 commit 的终态行（H4 守门）。
    """
    from app.modules.change.model import Change

    try:
        change = await svc._session.get(Change, agent_run.change_id)
        if change is not None:
            return change.workspace_id
    except Exception as exc:
        _rsvc.log.warning(
            "gate_resolve_workspace_change_failed",
            run_id=str(agent_run.id),
            change_id=str(agent_run.change_id),
            error=str(exc),
        )

    if agent_run.agent_session_id is not None:
        from app.modules.agent.model import AgentSession

        try:
            session = await svc._session.get(AgentSession, agent_run.agent_session_id)
            if session is not None:
                return session.workspace_id
        except Exception as exc:
            _rsvc.log.warning(
                "gate_resolve_workspace_session_failed",
                run_id=str(agent_run.id),
                session_id=str(agent_run.agent_session_id),
                error=str(exc),
            )
    return None


async def _run_gate_decision_task(
    svc,
    *,
    agent_run_id: uuid.UUID,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
) -> None:
    """Gate 决策后台任务（task-07，design §5.2 / §7 / §7.5）。

    Wave 2 task-05 仅接通 close_interactive_run 的 enqueue 调用点；本方法为
    task-07 的真实逻辑：在独立 session（H1）里 cas 抢占 gate_status pending→running
    （R3 防双发）→ 跑 sillyspec gate verify（task-06 _run_gate_via_delegate →
    task-01 HostFsDelegate.run_command）→ 存 gate_result + decided → 发
    gate_status_changed SSE（形态A task-01：不再自动推进 stage，current_stage 不变，
    推进交 advance_change_stage tool 读 gate_result 显式决策）→ 异常 fail-loud
    （failed + exit 2）。

    四条硬约束（design §10 R5-R7）：
      - **H1**：``async with _rsvc.get_session_factory()() as gate_session`` 独立 session。
        RunSyncService.__init__ 只接注入 session 无 session_factory 字段，后台任务
        生命周期独立于 HTTP 请求 session（R6）。全程禁用 ``svc._session``。
      - **R3**：``UPDATE ... WHERE gate_status='pending'`` 原子 cas，
        ``result.rowcount == 0`` 直接 return（防 reconcile + 原任务 double-enqueue，
        R10）。生产 PG 原子可靠；SQLite 测试用真 UPDATE 验 rowcount（R9）。
      - **H2**（形态A task-01 修订）：原 H2 内联 sync_stage_status +
        auto_dispatch_next_step 块已删（砍自动连轴，design §4.1 调用点①）；gate_session
        仅用于 cas + 落 gate_result + 发 SSE，current_stage 不变。
      - **H4**：由 task-05 close_interactive_run 经 ``_fire_background_task`` enqueue
        （强引用 ``_background_tasks`` set 防 GC + ``add_done_callback`` 取异常防静默）。

    失败语义（design §7 异常分支）：任何异常 → ``gate_status='failed'`` +
    ``gate_result={'exit_code': 2, 'errors': [str(exc)], 'raw_envelope': {}}`` + commit
    （fail-loud 不降级，不吞异常）。形态A：gate_result 交 advance_change_stage tool
    / 前端据 exit_code 显式决策（0 推进 / 1 打回 / 2 卡住，design §5.4）。
    """
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    # H1：独立 session（get_session_factory），禁用 svc._session。后台任务生命
    # 周期独立于 HTTP 请求；conftest._redirect_session_factory 让测试同引擎。
    session_factory = _rsvc.get_session_factory()
    async with session_factory() as gate_session:
        try:
            # R3：cas gate_status pending→running（原子防 double-enqueue）。
            # rowcount==0 表示已被抢（reconcile + 原任务并发 / 已 decided/failed），
            # 直接 return 不跑 gate（design §7.5 生命周期契约表 + R10）。
            cas_stmt = (
                update(AgentRun)
                .where(
                    AgentRun.id == agent_run_id,
                    AgentRun.gate_status == "pending",
                )
                .values(gate_status="running")
            )
            cas_result = await gate_session.execute(cas_stmt)
            await gate_session.commit()
            if cas_result.rowcount == 0:
                _rsvc.log.info(
                    "gate_decision_task_cas_miss",
                    agent_run_id=str(agent_run_id),
                )
                return

            # 取 workspace / change（gate 命令需 change.name + spec_root + workspace 对象）。
            workspace = await gate_session.get(Workspace, workspace_id)
            if workspace is None:
                raise RuntimeError(f"workspace not found: {workspace_id}")
            change = await gate_session.get(Change, change_id)
            if change is None:
                raise RuntimeError(f"change not found: {change_id}")
            change_name = change.change_key
            code_root, spec_dir = await svc._resolve_gate_spec_root(gate_session, workspace, change)
            if not code_root:
                raise RuntimeError(f"gate code_root unresolvable for change {change_id}")

            # task-06 _run_gate_via_delegate（走 task-01 HostFsDelegate.run_command
            # 在 daemon 跑 sillyspec gate verify，27s+），已含 _read_gate_result 解析
            # 返回 {exit_code, errors, raw_envelope}。
            gate_result = await _rsvc._run_gate_via_delegate(
                gate_session,
                workspace,
                change_name,
                code_root,
                spec_dir,
                stage="verify",
            )

            # 存 gate_result + decided；flag_modified 防 SQLAlchemy JSON in-place
            # mutation 不标记 dirty（对齐 lease.service._sync_stage_status_from_run
            # 的模式，gate_result 是 dict 原地改不入库——这里整体替换则自然 dirty）。
            run_row = await gate_session.get(AgentRun, agent_run_id)
            if run_row is None:
                raise RuntimeError(f"agent_run disappeared during gate task: {agent_run_id}")
            run_row.gate_result = gate_result
            run_row.gate_status = "decided"
            flag_modified(run_row, "gate_result")
            await gate_session.commit()

            # 形态A task-01（design §4.1 调用点①）：砍 auto_dispatch 自动连轴。
            # gate 结果已落库（gate_result + gate_status=decided），current_stage
            # 不变；推进交 advance_change_stage tool 读 gate_result 显式决策。
            # task-11 / design §5.7：commit 后发 gate_status_changed SSE 通知前端
            # 更新徽标（复用 agent_run:{id} channel，对齐 close 的 try/except 容错）。
            await svc._publish_gate_status_changed(run_row, gate_result)

            _rsvc.log.info(
                "gate_decision_task_done",
                agent_run_id=str(agent_run_id),
                change_id=str(change_id),
                gate_exit_code=gate_result.get("exit_code"),
            )
        except Exception as exc:
            # design §7 异常分支：fail-loud——gate_status=failed + exit 2 +
            # errors 含异常信息（不吞异常、不降级为 read_verify_result）。
            # rollback 撤销 cas running 及任何未提交改动，重新置 failed + gate_result。
            await gate_session.rollback()
            failed_gate_result = {
                "exit_code": 2,
                "errors": [str(exc)],
                "raw_envelope": {},
            }
            try:
                run_row = await gate_session.get(AgentRun, agent_run_id)
                if run_row is not None:
                    run_row.gate_result = failed_gate_result
                    run_row.gate_status = "failed"
                    flag_modified(run_row, "gate_result")
                    await gate_session.commit()
                    # task-11 / design §5.7：failed 分支 gate_status=failed + gate_result
                    # commit 成功后发 gate_status_changed SSE（复用 agent_run:{id}
                    # channel，对齐 close 的 try/except 容错）。此处 run_row 确定
                    # 非 None 且已 commit，failed_gate_result 含 errors=[str(exc)]。
                    await svc._publish_gate_status_changed(run_row, failed_gate_result)
            except Exception as commit_exc:
                _rsvc.log.exception(
                    "gate_decision_task_failed_commit_error",
                    agent_run_id=str(agent_run_id),
                    error=str(commit_exc),
                )
            _rsvc.log.exception(
                "gate_decision_task_failed",
                agent_run_id=str(agent_run_id),
                change_id=str(change_id),
                error=str(exc),
                exc_info=exc,
            )


async def _publish_gate_status_changed(
    svc,
    agent_run: AgentRun,
    gate_result: dict | None,
) -> None:
    """发 Redis ``gate_status_changed`` SSE 事件（task-11 / design §5.7）。

    gate 后台任务 27s+ 完成（decided/failed）后，前端需更新 gate_status 徽标
    （"客观核验中"→"已通过"/"失败"）。close 的 SSE 只发 ``turn_completed``（agent
    完成），gate 完成无 SSE → 徽标卡住。本方法补这一条事件，**复用现有
    ``agent_run:{id}`` channel**（task-12 前端按 event 字段分流，不新建 channel）。

    对齐 ``close_interactive_run:955-975`` 的 try/except 容错模式：Redis 抖动只
    warning，不影响已 commit 的 gate_result（gate_result 已落库，SSE 漏发不回滚）。

    ``errors_summary`` 取 ``gate_result.errors`` 的 ``str()[:500]``（截断防超大
    payload）；errors 为空 / None 时 ``errors_summary=None``。
    """
    try:
        redis = _rsvc.get_redis()
        errors = (gate_result or {}).get("errors") if isinstance(gate_result, dict) else None
        errors_summary = (str(errors)[:500]) if errors else None  # 截断防超大 payload
        await redis.publish(
            f"agent_run:{agent_run.id}",
            json.dumps(
                {
                    "event": "gate_status_changed",
                    "agent_run_id": str(agent_run.id),
                    "gate_status": agent_run.gate_status,
                    "errors_summary": errors_summary,
                },
                default=str,
            ),
        )
    except Exception:
        _rsvc.log.warning(
            "gate_status_changed_redis_publish_failed",
            agent_run_id=str(agent_run.id),
            gate_status=agent_run.gate_status,
        )


async def _resolve_gate_spec_root(
    svc,
    gate_session: AsyncSession,
    workspace: "object",
    change: "object",
) -> tuple[str | None, str | None]:
    """解析 gate 的 ``(code_root, spec_dir)``（task-01 gate-cwd-specdir-fix）。

    返回二元组，分离 gate 的 cwd（跑测试）与 specBase（读 local.yaml/spec 产物）：

    - **code_root**：gate 跑测试的 cwd（项目代码根，有 backend/frontend 代码）。
    - **spec_dir**：gate 读 local.yaml/spec 产物的 specBase（via ``--spec-dir``）。

    daemon-client platform-managed/repo-mirrored：``code_root=workspace.root_path``
    + ``spec_dir=SpecWorkspace.spec_root``（平台 specDir）。
    repo-native/无 SpecWorkspace：``code_root=workspace.root_path`` + ``spec_dir=None``
    （gate specBase 走默认 ``resolveSpecDir(code_root)=code_root/.sillyspec``）。
    ``workspace.root_path`` 缺失返回 ``(None, None)``（caller 抛 RuntimeError 置
    gate_status=failed，fail-loud）。

    之前（P3 task-07）返回单个 ``spec_root`` 一肩挑两担（cwd 既跑测试又读
    local.yaml），daemon-client 平台模式下 cwd=specDir 跑不了测试 / cwd=代码根
    找不到 local.yaml（坑 3）。本变更分离，配合 sillyspec runGate cwd/specBase
    分离（machine-interface.js:107 + index.js:323 接线）。
    """
    from sqlmodel import col as _col

    from app.core.spec_paths import SpecPathResolver

    code_root = getattr(workspace, "root_path", None)
    if not code_root:
        return None, None
    code_root = str(code_root)

    try:
        from app.modules.spec_workspace.model import SpecWorkspace

        stmt = select(SpecWorkspace).where(_col(SpecWorkspace.workspace_id) == change.workspace_id)
        spec_ws = (await gate_session.execute(stmt)).scalars().first()
        if spec_ws is not None and spec_ws.strategy != "repo-native" and spec_ws.spec_root:
            # platform-managed：spec_root 本身即扁平根（SpecPathResolver
            # platform_managed=True 的 _spec_root() == svc.root）；repo-mirrored
            # 同理（spec_root 为 daemon 同步的扁平快照根）。spec_dir 用它，
            # code_root 仍用 workspace.root_path（项目代码根，跑测试）。
            resolver = SpecPathResolver(
                spec_ws.spec_root,
                platform_managed=True,
            )
            return code_root, str(resolver._spec_root())
    except Exception as exc:
        _rsvc.log.warning(
            "gate_resolve_spec_root_spec_ws_failed",
            workspace_id=str(getattr(change, "workspace_id", None)),
            error=str(exc),
        )

    # repo-native / 无 SpecWorkspace：spec_dir=None（gate specBase 走默认
    # resolveSpecDir(code_root)=code_root/.sillyspec）。
    # 单一 daemon-client 模式（D-007@2026-07-10）：无 path_source 分流，
    # code_root 即 workspace.root_path，gate 自己解析 .sillyspec。
    return code_root, None
