"""Team 主 agent 动态编排服务（2026-07-12-team-main-agent-orchestration D-001@v2）。

主 agent = 真 agent（走 daemon interactive lease + MCP tool），像项目经理：
读 worker 实际产出再决策（派/补/收敛）。本模块建主 agent run + 调度循环骨架，
完整三重收敛逻辑留 task-11，MCP tool 转发留 task-05/06。

旁路 GLM ``CoordinatorPlanner``：mode=team 时 ``create_mission`` 不调
``planner.plan``，改走 ``OrchestratorService.team_mission_entry`` 建主 agent run。
worker 由主 agent 通过 ``mcp_tools`` endpoint 动态 dispatch（不预先拆，D-002@v2）。

零回归：mode=single / None 仍走 ``MissionService.start_mission`` + GLM planner，
本模块完全不被触达。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

log = get_logger(__name__)

# 主 agent run 的 role 标记（model.role 自由字符串，task-02 已注释）。converge 链路
# （finalizer.py:206）要求 run.mission_id 非空才能触发收敛——主 agent run 必须写
# mission_id，role 仅作语义标记。
_ORCHESTRATOR_ROLE = "orchestrator"

# Worker Run 终态集合（mission.py:26 _FAILED + completed）。schedule_loop 三重收敛
# 信号 1 用：所有 worker run（role != orchestrator）全终态 = 收敛条件之一。
_WORKER_TERMINAL = ("completed", "failed", "killed")

# 默认主 agent 配置（main_agent_config 缺省时兜底）。agent_type 必须是 daemon 已知
# provider 名（"claude_code" 是 agent_type 不是 provider，placement.dispatch_to_daemon
# 会把 provider 落到 lease metadata，daemon 按 provider 路由；缺失时 daemon 兜底）。
_DEFAULT_AGENT_TYPE = "claude_code"
_DEFAULT_PROVIDER = "claude"


def _resolve_main_agent_config(
    main_agent_config: dict[str, Any] | None,
) -> dict[str, str]:
    """从 main_agent_config 抽出 agent_type / provider / model，缺省兜底。

    main_agent_config 形如 ``{agent_type, provider, model}``（D-003@v2）。任一字段
    缺失走默认值，保证主 agent run 永远有可执行的 agent_type（NOT NULL 约束）。
    """
    cfg = main_agent_config or {}
    return {
        "agent_type": str(cfg.get("agent_type") or _DEFAULT_AGENT_TYPE),
        "provider": str(cfg.get("provider") or _DEFAULT_PROVIDER),
        "model": str(cfg.get("model")) if cfg.get("model") else "",
    }


def render_orchestrator_prompt(mission: AgentMission) -> str:
    """渲染主 agent 首轮 prompt（mission objective + worker_preset 提示）。

    主 agent 是真 agent，首轮拿到 mission 目标 + 用户预设 worker 列表，自主决定
    派哪些 worker / 何时收敛。MCP tool（task-05/06）让主 agent 通过反向 endpoint
    派 worker / 读产出 / 收敛。
    """
    preset_hint = ""
    if mission.worker_preset:
        roles = [
            str(w.get("role") or w.get("agent_type") or "worker") for w in mission.worker_preset
        ]
        preset_hint = (
            f"\n用户预设 worker 角色：{', '.join(roles)}\n按需通过 dispatch_worker MCP 工具派发。"
        )
    return (
        f"你是多 Agent 团队的主 agent（项目经理，role=orchestrator）。\n"
        f"团队目标：{mission.objective}\n"
        f"{preset_hint}\n\n"
        "你的职责：拆解目标 → 派 worker → 读 worker 产出 → 判断是否达成 → 收敛。"
        "worker 完成后通过 get_worker_result 读其产出，全部达成后调 converge 收敛。"
        "决策过程通过 report_progress 落日志。"
    )


class OrchestratorService:
    """Team 主 agent 编排服务（D-001@v2）。

    职责：
    - ``team_mission_entry``：建 AgentMission（含 worker_preset/main_agent_config 落库）
      + 主 agent AgentRun（role=orchestrator, mission_id 非空）+ 派 daemon lease。
    - ``schedule_loop``：主 agent 调度循环骨架（三重收敛骨架，完整逻辑 task-11）。

    与 GLM planner 链路互斥：mode=team 走本服务，mode=single/None 走
    ``MissionService.start_mission``。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def team_mission_entry(
        self,
        *,
        workspace_id: uuid.UUID,
        objective: str,
        created_by: uuid.UUID | None,
        change_id: uuid.UUID | None,
        constraints: dict[str, Any] | None,
        budget_usd: float | None,
        worker_preset: list[dict] | None,
        main_agent_config: dict[str, Any] | None,
    ) -> tuple[AgentMission, AgentRun]:
        """建 mission + 主 agent run + 派 daemon lease。

        复用 ``MissionService.start_mission`` 的持久化模式（mission.py:98-125），
        但不调 GLM planner，主 agent run 单条 role=orchestrator。

        daemon 离线 / workspace 未绑定时，``dispatch_to_daemon`` 抛
        ``NoOnlineDaemonError``——本方法捕获并把主 agent run 标记 ``pending`` +
        ``error_code="no_online_daemon"``，不抛错（mission 仍建，后续靠 reconcile
        重派）。这与 single 模式 dispatch_worker 失败语义一致（router.py:783-784）。
        """
        merged = dict(constraints or {})

        mission = AgentMission(
            workspace_id=workspace_id,
            change_id=change_id,
            objective=objective,
            constraints=merged or None,
            budget_usd=budget_usd,
            worker_preset=worker_preset,
            main_agent_config=main_agent_config,
            created_by=created_by,
        )
        self._session.add(mission)
        await self._session.commit()
        await self._session.refresh(mission)

        cfg = _resolve_main_agent_config(main_agent_config)
        main_run = AgentRun(
            mission_id=mission.id,
            change_id=change_id,
            agent_type=cfg["agent_type"],
            provider=cfg["provider"] or None,
            model=cfg["model"] or None,
            status="pending",
            role=_ORCHESTRATOR_ROLE,
            objective=objective,
        )
        self._session.add(main_run)
        await self._session.commit()
        await self._session.refresh(main_run)

        # 派 daemon lease（interactive 永不过期，lease/service.py:186）。主 agent run
        # 派 lease 仿 execution.dispatch_worker（调 dispatch_to_daemon，传 prompt +
        # workspace 上下文）。daemon 离线 / 未绑定时捕获，run 留 pending 待重派。
        lease_id: uuid.UUID | None = None
        try:
            placement = RunPlacementService(self._session)
            lease_id = await placement.dispatch_to_daemon(
                main_run.id,
                created_by,
                workspace_id=workspace_id,
                provider=cfg["provider"] or None,
                model=cfg["model"] or None,
                prompt=render_orchestrator_prompt(mission),
                stage=_ORCHESTRATOR_ROLE,
                read_only=False,
            )
        except NoOnlineDaemonError as exc:
            main_run.error_code = "no_online_daemon"
            main_run.output_redacted = exc.message
            self._session.add(main_run)
            await self._session.commit()
            await self._session.refresh(main_run)
            log.warning(
                "orchestrator_dispatch_no_online_daemon",
                mission_id=str(mission.id),
                run_id=str(main_run.id),
                message=exc.message,
            )
        else:
            if lease_id is None:
                log.warning(
                    "orchestrator_dispatch_returned_none",
                    mission_id=str(mission.id),
                    run_id=str(main_run.id),
                )

        log.info(
            "orchestrator_mission_started",
            mission_id=str(mission.id),
            main_run_id=str(main_run.id),
            role=_ORCHESTRATOR_ROLE,
            worker_preset_len=len(worker_preset) if worker_preset else 0,
            lease_id=str(lease_id) if lease_id else None,
        )
        return mission, main_run

    async def schedule_loop(self, mission_id: uuid.UUID) -> str | None:
        """主 agent 调度循环兜底巡检（D-001@v2 三重收敛，task-11 完整实现）。

        三重收敛信号（design §7，OR——任一触发即 converge）：
        1. **worker 全部终态**（completed/failed/killed）→ converge。主 agent 可能
           卡住没主动收敛（daemon 离线 / MCP tool 未调），backend 巡检兜底触发。
        2. **主 agent 判断目标达成**：主 agent 通过 MCP tool ``converge_mission``
           主动收敛（mcp_tools.py:293，task-05 建）。schedule_loop 不重复触发——
           巡检主 agent run 终态时若 worker 已全终态，归并到信号 1 一起 converge。
        3. **预算/超时硬截断**：``mission.budget_usd`` 触顶（cost_so_far >= budget）
           → 强制 converge（标记 degraded，design §7 信号 3）。budget 拒新 worker
           dispatch 已由 ``control.can_dispatch_worker`` 复用（D-008@v1，零重写），
           本方法只补「已超支 → 强制收尾」兜底。

        重要：``derive_status``（mission.py:29）把 mission 下**所有** AgentRun
        （含主 agent run 自己）算进状态。主 agent run 通常 long-lived running，
        若直接喂 derive_status 永远返回 ``running``——本方法只对 **worker runs**
        （role != orchestrator）判收敛，再用 ``converge_mission_for_completed_run``
        以主 agent run 为锚点触发（finalizer 内部仍按全 run derive，主 agent 此时
        已 completed/被收敛路径标记终态，derive 一致）。

        本方法是 backend **兜底巡检入口**——主 agent 实际驱动靠 daemon MCP tool
        （task-05/06）反向调 backend endpoint，循环主体在 daemon 端。调用方
        （reconcile / 定时任务，task-11 暂未接线，留 task-12/13）按节奏调本方法即可。

        Returns:
            收敛后的 mission status（``done``/``degraded``/...），或 None 表示本次
            巡检未触发收敛（mission 仍在 running / planning / 已 cancelled）。
        """
        mission = await self._session.get(AgentMission, mission_id)
        if mission is None:
            log.warning("orchestrator_schedule_loop_mission_missing", mission_id=str(mission_id))
            return None
        # cancelled mission 不再收敛（control.cancel 已终态化）。
        if mission.cancelled_at is not None:
            return None

        # 延迟 import 避免与 control/mission/finalizer 的循环 import 风险（与
        # finalizer.converge_mission_for_completed_run 同款）。
        from app.modules.agent.control import MissionControlService
        from app.modules.agent.finalizer import converge_mission_for_completed_run
        from app.modules.agent.mission import derive_status

        ctrl = MissionControlService(self._session)
        all_runs = await ctrl.worker_runs(mission_id)
        worker_runs = [r for r in all_runs if r.role != _ORCHESTRATOR_ROLE]

        # 找主 agent run 作 converge 锚点（converge_mission_for_completed_run 需 run_id）。
        # 主 agent run 不存在（mission 损坏 / single 模式误调）→ 无法走标准收敛锚点，
        # 巡检跳过（single 零回归：single mission 本就不该走 schedule_loop）。
        main_run = next((r for r in all_runs if r.role == _ORCHESTRATOR_ROLE), None)
        if main_run is None:
            log.info(
                "orchestrator_schedule_loop_no_main_run",
                mission_id=str(mission_id),
                run_count=len(all_runs),
            )
            return None

        # 信号 3（budget 硬截断）：cost_so_far >= budget_usd → 强制 converge（degraded）。
        # budget_usd=None 视为无预算约束（不触发）。复用 control.cost_so_far，与
        # can_dispatch_worker 同一数据源（避免双源不一致）。
        forced_degraded = False
        if mission.budget_usd is not None:
            cost = await ctrl.cost_so_far(mission_id)
            if cost >= mission.budget_usd:
                forced_degraded = True
                log.warning(
                    "orchestrator_budget_exceeded_force_converge",
                    mission_id=str(mission_id),
                    cost=cost,
                    budget_usd=mission.budget_usd,
                )

        # 信号 1（worker 全终态）：所有 worker run 都到终态。空 worker 集合（主 agent
        # 还没派任何 worker）不算——否则 mission 刚建就空收敛。
        all_workers_terminal = bool(worker_runs) and all(
            r.status in _WORKER_TERMINAL for r in worker_runs
        )

        if not forced_degraded and not all_workers_terminal:
            # 三重信号本次巡检均未达成，不收敛。budget「未触顶 + worker 未全终态」
            # 是 mission 正常推进态，schedule_loop 静默返回（log debug 级）。
            log.debug(
                "orchestrator_schedule_loop_no_converge",
                mission_id=str(mission_id),
                worker_terminal=all_workers_terminal,
                forced_degraded=forced_degraded,
            )
            return None

        # 信号 2（主 agent 自主收敛）不在 schedule_loop 触发——主 agent 调 MCP
        # ``converge_mission`` endpoint 直接走 converge_mission_for_completed_run。
        # 这里信号 1 / 3 触发时，需让 mission 的 run 全终态，否则
        # converge_mission_for_completed_run 内 derive_status（mission.py:29 把 mission
        # 下所有 run 含主 agent / 活跃 worker 算进去）返回 running、Finalizer 不合并：
        # - 主 agent run 还在 running → 标 completed（信号 1）/ failed（信号 3 强收）。
        # - 信号 3 budget 触顶时仍有 running worker → 标 killed（预算已停，worker 烧钱
        #   必须停，与 control.cancel 同语义但走巡检路径无 lease 上下文，纯标记终态；
        #   不设 cancelled_at——cancel 是用户主动，budget 强收是治理兜底，derive 出
        #   degraded 而非 cancelled）。
        mutated = False
        if forced_degraded:
            for w in worker_runs:
                if w.status not in _WORKER_TERMINAL:
                    w.status = "killed"
                    self._session.add(w)
                    mutated = True
        if main_run.status not in _WORKER_TERMINAL:
            main_run.status = "completed" if all_workers_terminal else "failed"
            self._session.add(main_run)
            mutated = True
        if mutated:
            await self._session.commit()
            await self._session.refresh(main_run)
            log.info(
                "orchestrator_force_terminal_runs",
                mission_id=str(mission_id),
                main_run_id=str(main_run.id),
                main_new_status=main_run.status,
                reason="budget_exceeded" if forced_degraded else "workers_terminal",
            )

        # 触发收敛：复用 complete_lease 末尾同款入口（D-007@v1 单锚点）。GLM 配置
        # 由 converge_mission_for_completed_run 内部按 patch/summary 分流处理。
        from app.modules.agent.delegation import GLMConfig

        try:
            result_status = await converge_mission_for_completed_run(
                self._session, main_run.id, GLMConfig.from_env()
            )
        except Exception as exc:
            # 与 complete_lease 容错一致（lease/service.py:609）：converge 失败不抛，
            # 兜底巡检下次再来。derive_status 纯函数计算终态供调用方。
            log.warning(
                "orchestrator_schedule_loop_converge_failed",
                mission_id=str(mission_id),
                main_run_id=str(main_run.id),
                error=str(exc),
            )
            runs_recheck = await ctrl.worker_runs(mission_id)
            result_status = derive_status(runs_recheck, cancelled=False)

        # forced_degraded 时无论 derive 算出什么（done/failed/degraded），都覆盖为
        # degraded——表达「预算触顶强收」语义（design §7 信号 3 标 degraded）。budget
        # 强收是治理兜底，derive 此刻可能因 worker 被 kill 而出 failed，但 mission
        # 已正常收敛合并产物，用 degraded 表达「收尾但不圆满」比 failed 更准确。
        if forced_degraded:
            result_status = "degraded"

        log.info(
            "orchestrator_schedule_loop_converged",
            mission_id=str(mission_id),
            status=result_status,
            forced_degraded=forced_degraded,
            workers_terminal=all_workers_terminal,
        )
        return result_status
