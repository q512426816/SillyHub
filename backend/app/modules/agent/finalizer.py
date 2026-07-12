"""Mission Finalizer — single-point convergence (Wave 1, 2026-06-28-team-mainline-integration).

Merges Worker Artifacts into a unified product, avoiding multi-Agent concurrent-
write conflicts (proposal §9 / T3.4). Triggered at ``complete_lease`` end
(D-007@v1) when a mission's workers all reach terminal state — ``derive_status``
is a pure function with no watcher, so the only reliable trigger anchor is the
lease-completion path (``lease/service.py::complete_lease``), which is the single
收口 point both batch and interactive leases pass through.

Two scenarios (D-005@v1):
- bootstrap (read-only, deterministic): backend-embedded GLM merges all summary
  Artifacts → writes one merged ``summary`` Artifact. The Finalizer does NOT
  occupy a daemon lease (same rationale as the Coordinator being a direct API
  call, proposal §3 / spike 04).
- execute (write, Wave 4): a special Worker Run merges patches → human-reviewed
  apply-back. Not implemented in Wave 1.

Tool governance (D-004@v2): the Finalizer is backend-embedded (no daemon CLI),
so daemon ``--allowedTools`` / batch ``canUseTool`` limitations do not apply —
safety for execute patch apply-back is enforced by human review, not here.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.delegation import GLMConfig
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun

log = get_logger(__name__)

_MERGE_SYSTEM = (
    "你是多 Agent 团队的 Finalizer（收敛者）。下面是多个 Worker 各自产出的"
    "结构化摘要。请合并为一份连贯、完整、无重复的最终摘要文档：保留每个 "
    "Worker 的关键发现/结论/产出文件路径/风险，消除彼此矛盾，补全缺漏，"
    "按主题（而非按 Worker）重新组织。直接输出合并后的 Markdown 文档，"
    "不要输出任何解释或元信息。"
)

# Finalizer 合并产物的载体：挂到 mission 下第一个 Worker Run（v1 flat，无独立
# Finalizer Run；role 自由字符串，写 "finalizer" 仅作语义标记，无 schema 变更 —
# Grill G2）。content_ref 截断 16K（与 collect_artifact 的 8K 单摘要对齐，合并
# 产物允许更大）。
_MERGED_MAX_BYTES = 16000


class FinalizerService:
    """Single-point convergence for a Mission's Worker Artifacts."""

    def __init__(
        self,
        session: AsyncSession,
        config: GLMConfig | None = None,
        *,
        timeout: float = 120,
    ) -> None:
        self._session = session
        self._config = config
        self._timeout = timeout

    async def _worker_artifacts(self, mission_id: uuid.UUID) -> list[AgentArtifact]:
        """All Artifacts produced by the mission's Worker Runs, oldest first."""
        stmt = (
            select(AgentArtifact)
            .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentArtifact.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _carrier_run(self, mission_id: uuid.UUID) -> AgentRun | None:
        """First Worker Run of the mission — carries the merged Artifact (v1 flat)."""
        stmt = (
            select(AgentRun)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentRun.created_at)
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    def _concat_merge(self, artifacts: list[AgentArtifact]) -> str:
        """Fallback merge (no GLM): concatenate per-Worker sections."""
        parts = [
            f"## Worker {i + 1}\n\n{a.content_ref or '(无产出)'}" for i, a in enumerate(artifacts)
        ]
        return "# 合并摘要（Finalizer 回退拼接）\n\n" + "\n\n".join(parts)

    async def _glm_merge(self, artifacts: list[AgentArtifact]) -> str:
        """Merge Artifacts via backend-embedded GLM (same call pattern as Coordinator)."""
        corpus = "\n\n---\n\n".join(
            f"## Worker {i + 1}\n{a.content_ref or '(无产出)'}" for i, a in enumerate(artifacts)
        )
        payload: dict[str, Any] = {
            "model": self._config.model,
            "max_tokens": 4096,
            "system": _MERGE_SYSTEM,
            "messages": [{"role": "user", "content": corpus}],
        }
        headers = {
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "x-api-key": self._config.token,
            "authorization": f"Bearer {self._config.token}",
        }
        endpoint = self._config.base_url.rstrip("/") + "/v1/messages"
        # trust_env=False — GLM endpoint is domestic, don't inherit SOCKS proxy
        # (same rationale as CoordinatorPlanner.plan, spike 04).
        async with httpx.AsyncClient(trust_env=False, timeout=self._timeout) as client:
            resp = await client.post(endpoint, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
        return "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )

    async def finalize_bootstrap_mission(self, mission_id: uuid.UUID) -> AgentArtifact | None:
        """Merge all Worker summary Artifacts into one (bootstrap / read-only scenario).

        Returns the merged ``summary`` Artifact, or None if there are no Artifacts
        yet / no carrier Run. GLM failure falls back to deterministic concat merge
        (Finalizer must always converge — proposal §9: single-point write).
        """
        artifacts = await self._worker_artifacts(mission_id)
        if not artifacts:
            log.info("finalizer_no_artifacts", mission_id=str(mission_id))
            return None
        if self._config is None:
            merged = self._concat_merge(artifacts)
        else:
            try:
                merged = await self._glm_merge(artifacts)
            except Exception as exc:
                log.warning(
                    "finalizer_glm_failed_fallback_concat",
                    mission_id=str(mission_id),
                    error=str(exc),
                )
                merged = self._concat_merge(artifacts)

        run = await self._carrier_run(mission_id)
        if run is None:
            return None
        artifact = AgentArtifact(
            run_id=run.id,
            kind="summary",
            content_ref=merged[:_MERGED_MAX_BYTES],
        )
        self._session.add(artifact)
        await self._session.commit()
        await self._session.refresh(artifact)
        log.info(
            "finalizer_bootstrap_done",
            mission_id=str(mission_id),
            carrier_run_id=str(run.id),
            bytes=len(merged[:_MERGED_MAX_BYTES]),
            merged_from=len(artifacts),
            used_glm=self._config is not None,
        )
        return artifact

    async def finalize_execute_mission(self, mission_id: uuid.UUID) -> list[AgentArtifact]:
        """Merge execute Worker patches → human-reviewed apply-back (Wave 4, not in Wave 1).

        Returns the list of ``patch`` Artifacts awaiting human review. The actual
        apply-back is a human action (D-006@v1), not automatic.
        """
        # Wave 4 实现；Wave 1 占位返回 patch Artifacts 列表供人审。
        stmt = (
            select(AgentArtifact)
            .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
            .where(AgentRun.mission_id == mission_id, AgentArtifact.kind == "patch")
            .order_by(AgentArtifact.created_at)
        )
        patches = list((await self._session.execute(stmt)).scalars().all())
        log.info(
            "finalizer_execute_patches_ready_for_review",
            mission_id=str(mission_id),
            n=len(patches),
        )
        return patches


async def converge_mission_for_completed_run(
    session: AsyncSession,
    run_id: uuid.UUID,
    glm_config: GLMConfig | None = None,
) -> str | None:
    """Mission 收敛入口（D-007@v1）—— ``complete_lease`` 末尾调用。

    1. run 不属于任何 mission → 跳过（绝大多数 lease，零影响 — 兼容 SC-5）。
    2. ``collect_completed_artifacts`` 回灌（C2：按 run 维度在 complete_lease 触发，
       与 session end 解耦，覆盖 batch + interactive）。
    3. 全 Worker 终态（``derive_status`` 返回 ``done``/``degraded``）→ Finalizer 合并。

    返回收敛后的 mission status（``done``/``degraded``/``running``/...），或 None
    表示 run 不属于 mission。任何异常由调用方（complete_lease）try/except 兜底，
    不阻塞 lease 完成。
    """
    run = await session.get(AgentRun, run_id)
    if run is None or run.mission_id is None:
        return None

    # 延迟 import 避免与 execution/mission/control 的循环 import 风险
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.execution import MissionExecutionService
    from app.modules.agent.mission import derive_status

    mission_id = run.mission_id
    exec_svc = MissionExecutionService(session)
    await exec_svc.collect_completed_artifacts(mission_id)

    ctrl = MissionControlService(session)
    runs = await ctrl.worker_runs(mission_id)
    mission = await session.get(AgentMission, mission_id)
    cancelled = mission is not None and mission.cancelled_at is not None
    status = derive_status(runs, cancelled=cancelled)

    if status in ("done", "degraded"):
        finalizer = FinalizerService(session, glm_config)
        # task-04 D-005@v2：execute mission 有 patch artifact → finalize_execute_mission
        # 采集 patch 列表供人审 apply-back（实际 git merge 留 task-04b per-worker worktree）；
        # bootstrap mission（read-only summary only，无 patch）→ finalize_bootstrap_mission
        # 合并 summary。finalize_execute_mission 返回空 = 无 patch = bootstrap 路径。
        patches = await finalizer.finalize_execute_mission(mission_id)
        if not patches:
            await finalizer.finalize_bootstrap_mission(mission_id)
        log.info(
            "mission_converged",
            mission_id=str(mission_id),
            status=status,
            trigger_run_id=str(run_id),
            patch_count=len(patches),
        )
    return status
