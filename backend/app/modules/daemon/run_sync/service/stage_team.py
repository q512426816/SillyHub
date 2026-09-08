"""stage / team 推进簇 + post-scan 校验（task-10 拆分）。

_publish_stage_status_changed / _trigger_stage_completion_callback（single
stage 完成 → sillyspec.db 视图同步 + 留痕待触发）/ _handle_team_run_
completion（schedule_loop 收敛兜底）/ _advance_team_stage（team mission 收敛
→ current_stage 推进的唯一桥）/ _run_post_scan_validation（平台侧结构化
校验）/ _resolve_lease_workspace（lease 反查 workspace）。D-007：get_redis
经 ``_rsvc.`` 延迟解析；log 经 ``_rsvc.log`` 保持原模块 logger 身份。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonTaskLease

if TYPE_CHECKING:
    from app.modules.agent.model import AgentMission
    from app.modules.change.model import Change


async def _publish_stage_status_changed(
    svc,
    agent_run: AgentRun,
    change_id: uuid.UUID,
    stage: str | None,
    status: str,
) -> None:
    """发 Redis ``stage_status_changed`` SSE 事件（形态A 按需触发，design §4.1）。

    砍 auto_dispatch 自动连轴后，single stage 完成（task-02）/ team stage 推进
    （task-03）都不再自动 dispatch 下一 stage。本事件提示前端 / agent：当前
    stage 已落「完成待触发」态，需显式调 ``advance_change_stage`` MCP/HTTP 推进。

    复用现有 ``agent_run:{id}`` channel（对齐 ``_publish_gate_status_changed``，
    前端按 event 字段分流，不新建 channel）；Redis 抖动只 warning，不影响已
    commit 的状态（gate_result / current_stage 已落库，SSE 漏发不回滚）。
    """
    try:
        redis = _rsvc.get_redis()
        await redis.publish(
            f"agent_run:{agent_run.id}",
            json.dumps(
                {
                    "event": "stage_status_changed",
                    "agent_run_id": str(agent_run.id),
                    "change_id": str(change_id),
                    "stage": stage,
                    "status": status,
                },
                default=str,
            ),
        )
    except Exception:
        _rsvc.log.warning(
            "stage_status_changed_redis_publish_failed",
            agent_run_id=str(agent_run.id),
            change_id=str(change_id),
            stage=stage,
        )


async def _trigger_stage_completion_callback(
    svc,
    agent_run_id: uuid.UUID,
) -> None:
    """stage dispatch 的 AgentRun 完成后同步 sillyspec.db 视图并留痕待触发。

    形态A task-02（design §4.1 调用点③）：砍 single 分支的 auto_dispatch 自动
    连轴。single stage 完成后只 ``sync_stage_status``（更新 sillyspec.db 视图）
    + 发 ``stage_status_changed`` SSE 提示前端/agent 显式推进，current_stage 不
    自动前进，停在「阶段完成待触发」态。

    task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
    后 path_source 形参已删，sync_stage_status 内部经 HostFsDelegate RPC 读
    sillyspec.db（D-004 / D-009），无 path_source 分流。

    仅对 stage dispatch（change_id 非空、status=completed）生效；scan
    （change_id=None）由 spec sync + scan_docs.reparse 单独回流，不走这里。
    team 分流（mission_id 非空 + team_mode）交 ``_handle_team_run_completion``
    → ``_advance_team_stage``（task-03），不在本分支。
    """
    from app.modules.change.dispatch import SillySpecStageDispatchService
    from app.modules.change.model import Change

    agent_run = await svc._session.get(AgentRun, agent_run_id)
    if agent_run is None or agent_run.change_id is None:
        return
    if agent_run.status != "completed":
        return

    change = await svc._session.get(Change, agent_run.change_id)
    if change is None:
        return

    # team→change 生命周期修复（task-11 接线）：team-mission run（mission_id
    # 非空 + change.stages.team_mode=True）走 team 生命周期——schedule_loop 收敛
    # 兜底 + 收敛后桥接推进 stage。single stage run（mission_id=None）保持既有
    # sillyspec.db sync 路径不变（零回归）。team 工作由 worker 经 MCP 完成，不落
    # sillyspec.db step，故不能走 single 的 sync_stage_status（会读到
    # stage_completed=False 把变更卡在 execute/verify）。
    stages_peek = change.stages if isinstance(change.stages, dict) else {}
    if agent_run.mission_id is not None and stages_peek.get("team_mode") is True:
        try:
            await svc._handle_team_run_completion(agent_run, change)
        except Exception as exc:
            _rsvc.log.warning(
                "team_run_completion_handler_failed",
                agent_run_id=str(agent_run_id),
                change_id=str(agent_run.change_id),
                mission_id=str(agent_run.mission_id),
                error=str(exc),
            )
        return

    svc = SillySpecStageDispatchService(svc._session)
    sync_result = await svc.sync_stage_status(
        svc._session,
        agent_run.change_id,
        agent_run.id,
    )
    if not sync_result.synced:
        _rsvc.log.info(
            "stage_callback_sync_skipped",
            agent_run_id=str(agent_run_id),
            change_id=str(agent_run.change_id),
            error=sync_result.error,
        )
        return

    # 形态A task-02（design §4.1 调用点③）：砍 auto_dispatch_next_step 自动连轴。
    # single stage 完成后停在「阶段完成待触发」态，current_stage 不自动前进；
    # 发 stage_status_changed SSE 提示前端/agent 显式调 advance_change_stage 推进。
    await svc._publish_stage_status_changed(
        agent_run,
        change_id=agent_run.change_id,
        stage=sync_result.current_stage,
        status="completed_pending_trigger",
    )
    _rsvc.log.info(
        "stage_callback_done",
        agent_run_id=str(agent_run_id),
        change_id=str(agent_run.change_id),
        stage=sync_result.current_stage,
    )


async def _handle_team_run_completion(
    svc,
    agent_run: AgentRun,
    change: Change,
) -> None:
    """team-mission run（worker 或 orchestrator）完成后：触发 schedule_loop
    收敛兜底（缺口 A）+ 收敛成功后桥接推进变更 stage（缺口 B）。

    缺口 A：``OrchestratorService.schedule_loop`` 是 team mission 后端收敛兜底
    （worker 全终态→收敛 / budget 触顶→强收），但 task-11 未接线、生产无调用方，
    主 agent 不主动 converge 时 mission 永久挂起。本方法在每次 team run 完成
    （worker / 主 agent）时调用它——schedule_loop 内部判条件，未达收敛返 None。

    缺口 B：team 工作由 worker 经 MCP 完成，不写 sillyspec.db step，single 的
    sync_stage_status 读到 stage_completed=False 不推进。收敛成功后本方法走
    ``_advance_team_stage`` 推进（execute→verify，verify→archive）。

    幂等：仅当 ``change.current_stage == team_stage`` 时推进；complete_stage 后
    current_stage 已变，后续重复触发（多 worker 依次完成）自然跳过，不重复推进。
    """
    from app.modules.agent.model import AgentMission
    from app.modules.agent.orchestrator import OrchestratorService

    mission = await svc._session.get(AgentMission, agent_run.mission_id)
    if mission is None:
        return

    constraints = mission.constraints if isinstance(mission.constraints, dict) else {}
    team_stage = constraints.get("stage") or "execute"

    # 幂等护栏：change 已离开 team_stage（已被推进过 / 被其它路径改态）→ 跳过。
    if change.current_stage != team_stage:
        _rsvc.log.info(
            "team_run_completion_skip_stage_advanced",
            change_id=str(change.id),
            team_stage=team_stage,
            current_stage=change.current_stage,
        )
        return

    # 缺口 A：触发后端收敛兜底。返回 None = 本次未收敛（仍有 worker 在跑 / 未触顶）。
    orchestrator = OrchestratorService(svc._session)
    mission_status = await orchestrator.schedule_loop(mission.id)
    if mission_status is None:
        return

    _rsvc.log.info(
        "team_run_completion_converged_advancing",
        change_id=str(change.id),
        mission_id=str(mission.id),
        team_stage=team_stage,
        mission_status=mission_status,
    )
    await svc._advance_team_stage(change, mission, team_stage)


async def _advance_team_stage(
    svc,
    change: Change,
    mission: AgentMission,
    team_stage: str,
) -> None:
    """team mission 收敛后推进变更 stage（缺口 B / 形态A task-03，design §4.3）。

    形态A 砍 auto_dispatch 后，本方法是 team mission 收敛→change.current_stage
    推进的**唯一桥**，不能整个删。保留两件事：
      - ``merge_gate_results``：verify stage 合并 worker gate_results 落主 agent
        run.gate_result（gate 决策数据源，advance_change_stage tool / review 据此
        显式决策）。
      - ``ChangeService.complete_stage``：推进 current_stage + 落 pending_review
        （execute→verify / verify+passed→archive / archive→archived）。

    删除原 ``StageSyncResult`` 伪造 + ``auto_dispatch_next_step`` 自动 dispatch
    下一 stage 的整块（design §4.1 调用点④）——下一 stage team mission 交
    ``advance_change_stage`` MCP/HTTP tool 显式触发 ``_dispatch_execute_team``。
    推进完成后发 ``stage_status_changed`` SSE 留痕（team stage 已推进，下一 stage
    待显式触发）。

    幂等：由 ``_handle_team_run_completion`` 的 ``current_stage == team_stage``
    护栏保证（complete_stage 后 current_stage 已变，重复触发自然跳过）。
    """
    from app.modules.agent.control import MissionControlService
    from app.modules.change.dispatch import merge_gate_results
    from app.modules.change.service import ChangeService

    ctrl = MissionControlService(svc._session)
    all_runs = await ctrl.worker_runs(mission.id)
    main_run = next((r for r in all_runs if r.role == "orchestrator"), None)

    # verify stage：合并 worker gate_results 落主 agent run，作为 gate 决策数据源
    # （对齐 task-07 single gate task：gate_status=decided + gate_result 落库）。
    # execute stage 无 gate（workers 产 patch 不产 gate_result）。
    # dict() copy 防 SQLAlchemy JSON 列原地改不标记 dirty（对齐 dispatch.py 模式）。
    stage_result: str | None = None
    if team_stage == "verify":
        worker_runs = [r for r in all_runs if r.role != "orchestrator"]
        gate_results = [r.gate_result for r in worker_runs if isinstance(r.gate_result, dict)]
        merged = merge_gate_results(gate_results)
        if main_run is not None:
            main_run.gate_result = dict(merged)
            main_run.gate_status = "decided"
            svc._session.add(main_run)
            await svc._session.commit()
            await svc._session.refresh(main_run)
            _rsvc.log.info(
                "team_verify_gate_merged",
                change_id=str(change.id),
                mission_id=str(mission.id),
                merged_exit=merged.get("exit_code"),
                worker_count=merged.get("worker_count"),
            )
        # verify → archive 需 result="passed"（_resolve_stage_completion）。
        # exit 0 视为 passed；非 0 不推进（stage_result 保持 None → complete_stage
        # verify+非 passed 返回 (verify, None)），change 停在 verify，交
        # advance_change_stage tool / review 显式决策（形态A：不自动 kickback/block）。
        if merged.get("exit_code") == 0:
            stage_result = "passed"

    # 桥：complete_stage 推进 current_stage + 落 pending_review（design §4.3）。
    # complete_stage 内部经 _resolve_stage_completion(stage, result) 决定 new_stage。
    cs = ChangeService(svc._session)
    complete_result = await cs.complete_stage(
        workspace_id=change.workspace_id,
        change_id=change.id,
        stage=team_stage,
        result=stage_result,
        summary=None,
    )

    # 留痕 SSE：team stage 已推进（或 verify gate 未过停留），下一 stage 待显式触发。
    sse_run = main_run if main_run is not None else (all_runs[0] if all_runs else None)
    if sse_run is not None:
        await svc._publish_stage_status_changed(
            sse_run,
            change_id=change.id,
            stage=complete_result.change.current_stage,
            status="completed_pending_trigger",
        )
    _rsvc.log.info(
        "team_stage_advanced",
        change_id=str(change.id),
        mission_id=str(mission.id),
        team_stage=team_stage,
        new_stage=complete_result.change.current_stage,
        dispatch_target=complete_result.dispatch_target,
    )


async def _run_post_scan_validation(
    svc,
    lease: DaemonTaskLease,
) -> None:
    """C: scan 完成后跑平台侧结构化校验（PostScanValidator）。

    task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
    后 path_source 分流整段删除，delegate + workspace 无条件解析。path_source
    形参同步清除（complete_lease 调用方 task-09 已改无参透传）。

    消费 sillyspec 平台模式产出的结构化回执：manifest.json / platform-scan.json
    / postcheck-result / 源码污染检测 / 7 份 scan 文档齐全性。仅对 scan run
    （``AgentRun.change_id`` 为空且 ``spec_strategy == "platform-managed"``）触发；
    校验结果写入 ``lease.metadata['post_scan_validation']``，**不翻转** scan 的
    成功语义（避免破坏现有行为，仅做增强校验与留痕）。

    daemon-client 模式下 source_root 可能不在 server 本机，PostScanValidator
    内部以 ``exists()`` 容错；外层另有 try/except 保证不阻塞 lease 完成。
    """
    from app.modules.agent.post_scan_validator import PostScanValidator

    if not lease.agent_run_id:
        return
    agent_run = await svc._session.get(AgentRun, lease.agent_run_id)
    if agent_run is None:
        return
    # 仅 scan run：无 change_id 且平台托管（stage run 走 _trigger_stage_completion_callback）
    if agent_run.change_id is not None:
        return
    if getattr(agent_run, "spec_strategy", None) != "platform-managed":
        return

    meta = dict(lease.metadata_ or {})
    source_root = meta.get("root_path")
    spec_root = meta.get("spec_root")
    runtime_root = meta.get("runtime_root") or (
        str(Path(spec_root) / "runtime") if spec_root else None
    )
    if not source_root or not spec_root or not runtime_root:
        _rsvc.log.info(
            "post_scan_validation_skipped_no_paths",
            lease_id=str(lease.id),
            has_root_path=bool(source_root),
            has_spec_root=bool(spec_root),
        )
        return

    # task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client
    # 后 path_source 分流整段删除（server-local 路径已废）。delegate + workspace
    # 无条件解析（复用 task-05 的 lazy facade + _resolve_lease_workspace），异常仍
    # 按 warning 降级到 delegate=None（NFR-02 零回归）。delegate 由 task-06 lazy
    # property 注入。
    delegate = None
    workspace = None
    if svc._facade is not None:
        try:
            delegate = svc._facade.host_fs_delegate
            workspace = await svc._resolve_lease_workspace(lease)
        except Exception as exc:  # delegate 构造/workspace 反查不应中断 lease
            _rsvc.log.warning(
                "post_scan_validation_delegate_unavailable",
                lease_id=str(lease.id),
                error=str(exc),
            )
            delegate = None
            workspace = None

    validator = PostScanValidator(
        source_root,
        spec_root,
        runtime_root,
        str(agent_run.id),
        delegate=delegate,
        workspace=workspace,
    )
    result = await validator.validate(agent_run.output_redacted or "", agent_run.exit_code or 0)
    meta["post_scan_validation"] = {
        "status": str(result.status.value),
        "has_errors": result.has_errors,
        "has_warnings": result.has_warnings,
        "errors": [
            {"code": e.code, "severity": e.severity, "message": e.message} for e in result.errors
        ],
        "warnings": [
            {"code": w.code, "severity": w.severity, "message": w.message} for w in result.warnings
        ],
        "metadata": result.metadata,
    }
    lease.metadata_ = meta
    flag_modified(lease, "metadata_")
    svc._session.add(lease)
    await svc._session.commit()

    _rsvc.log.info(
        "post_scan_validation_done",
        lease_id=str(lease.id),
        agent_run_id=str(agent_run.id),
        status=str(result.status.value),
        errors=len(result.errors),
        warnings=len(result.warnings),
    )


async def _resolve_lease_workspace(svc, lease: DaemonTaskLease):
    """反查 lease 关联 workspace（task-09 单一 daemon-client 模式）。

    链路同 lease/service.py:_resolve_lease_workspace_path_source：经 M:N
    关联表 AgentRunWorkspace。失败返回 None（不抛，caller 已 try/except
    兜底降级到 delegate=None，NFR-02 零回归）。
    """
    from sqlmodel import col

    from app.modules.workspace.model import AgentRunWorkspace, Workspace

    if lease.agent_run_id is None:
        return None
    ws_stmt = (
        select(AgentRunWorkspace.workspace_id)
        .where(col(AgentRunWorkspace.agent_run_id) == lease.agent_run_id)
        .limit(1)
    )
    ws_row = (await svc._session.execute(ws_stmt)).first()
    if ws_row is None:
        return None
    return await svc._session.get(Workspace, ws_row[0])
