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

    async def schedule_loop(self, mission_id: uuid.UUID) -> None:
        """主 agent 调度循环骨架（D-001@v2 三重收敛）。

        三重收敛信号（design §7）：
        1. worker 全部终态（completed/failed/killed）→ 触发 converge。
        2. 主 agent 自主判断目标达成（通过 MCP tool report_progress 表态）→ converge。
        3. 预算 / 超时兜底（budget_usd 超支或 lease 长期不活跃）→ 强制 converge。

        本任务仅留骨架 + TODO，完整状态机 / 重派 / 收敛触发留 task-11。主 agent
        实际驱动靠 daemon 侧 MCP tool（task-05/06）反向调 backend endpoint，循环
        主体在 daemon 端，backend 这里只做兜底巡检入口（task-11 接 reconcile）。
        """
        # TODO(task-11): 实现三重收敛状态机
        # - 查 mission 所有 worker runs 状态
        # - 信号 1：worker 全终态 → FinalizerService.converge
        # - 信号 2：主 agent run completed 且 mission 未收敛 → converge
        # - 信号 3：预算超支 / 超时 → 强制 converge（标记 degraded）
        log.info("orchestrator_schedule_loop_skeleton", mission_id=str(mission_id))
        return None
