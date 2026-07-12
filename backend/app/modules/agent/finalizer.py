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
from dataclasses import dataclass, field
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.delegation import GLMConfig
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun
from app.modules.daemon.host_fs.delegate import HostFsDelegate
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)


@dataclass
class FinalizerMergeResult:
    """``finalize_execute_mission`` 产物契约（task-05，供 task-06 converge 决策）。

    - ``merged_branches``：本次成功合并到 workspace root 的 worker 分支列表
      （delegate ``git_merge`` 返回 ``ok=True`` 的分支）。
    - ``pending_conflicts``：合并冲突累积（``ok=False`` 的分支返回的 conflicts
      列表展开合并）。冲突只收集不解决——主 agent LLM 在 task-06 用 SDK 工具
      解决后重入 ``converge_mission`` 继续（design §5.2）。

    两者皆空 = 无可合并的 worktree_branch（worker 老路径未隔离 / 无 patch）→
    caller 回退 ``finalize_bootstrap_mission``（design §9 兼容策略）。
    """

    merged_branches: list[str] = field(default_factory=list)
    pending_conflicts: list[dict[str, Any]] = field(default_factory=list)


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
        host_fs_delegate: HostFsDelegate | None = None,
    ) -> None:
        self._session = session
        self._config = config
        self._timeout = timeout
        # task-05（2026-07-12-worker-worktree-isolation / D-003@v1 / D-005@v2）：
        # per-worker worktree 分支合并。注入时 ``finalize_execute_mission`` 逐个
        # 调 ``git_merge`` 合并各 worker ``worktree_branch`` 到 workspace root，
        # 冲突只收集不解决（解决在 task-06 主 agent SDK）。None（默认）→ 保留
        # task-04 既有行为（仅采 patch artifact 列表供人审，不实际 merge），
        # single mode / 既有调用方零回归（design §9）。生产接线由调用方注入
        # （converge_mission_for_completed_run，task-08 集成）；本构造函数不 lazy
        # 构造，因 HostFsDelegate 依赖进程级 ws_hub + ws_rpc，与 session 构造不对称
        # （execution.py task-03 注入同款理由）。
        self._host_fs_delegate = host_fs_delegate

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

    async def has_execute_patches(self, mission_id: uuid.UUID) -> bool:
        """Mission 是否有 write worker 产出的 ``kind=patch`` artifact（task-05）。

        路由分流依据（converge_mission_for_completed_run）：execute mission（有
        patch = worker 写了代码，diff_summary 由 collect_completed_artifacts 采）
        走 ``finalize_execute_mission``；无 patch 的 bootstrap read-only mission
        走 ``finalize_bootstrap_mission``（task-04 既有语义，task-05 保留）。
        """
        stmt = (
            select(AgentArtifact.id)
            .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
            .where(AgentRun.mission_id == mission_id, AgentArtifact.kind == "patch")
            .limit(1)
        )
        found = (await self._session.execute(stmt)).scalars().first()
        return found is not None

    async def finalize_execute_mission(self, mission_id: uuid.UUID) -> FinalizerMergeResult:
        """Merge execute Worker worktree branches into workspace root (task-05).

        逐个取 mission 各 worker run 的 ``worktree_branch``（task-03 dispatch 时
        填值），调 ``HostFsDelegate.git_merge`` 合并到 workspace root（design §5.1
        步骤5-6）。``ok=True`` → 收 ``merged_branches``；``ok=False`` → 收
        ``pending_conflicts``（不中断，继续合能合的——design §5.1 步骤6 注释「继续
        下一个」）。冲突只收集不解决（解决在 task-06 主 agent SDK，design §5.2）。

        未注入 delegate 或 worker 无 ``worktree_branch``（老路径 / single mode）→
        返回空结果（``merged_branches=[]`` / ``pending_conflicts=[]``）。caller
        （converge）据 ``has_execute_patches`` 决定是否回退 ``finalize_bootstrap_mission``
        （design §9 兼容策略；task-04 既有 patch artifact 采集由
        ``collect_completed_artifacts`` 在 converge 前已产出，非本方法职责）。

        返回 ``FinalizerMergeResult``（task-06 / task-07 消费契约）。
        """
        merged_branches: list[str] = []
        pending_conflicts: list[dict[str, Any]] = []

        has_patch = await self.has_execute_patches(mission_id)

        # 无 delegate（既有调用方）→ 跳过实际 merge，返回空结果（design §9 零回归）。
        if self._host_fs_delegate is None:
            log.info(
                "finalizer_execute_no_delegate_skip_merge",
                mission_id=str(mission_id),
                has_patch=has_patch,
            )
            return FinalizerMergeResult(
                merged_branches=merged_branches,
                pending_conflicts=pending_conflicts,
            )

        # 取 mission 各 completed worker 的 worktree_branch（task-03 填值）。
        # None（未用 worktree 隔离，老路径）跳过 merge（design §9）。
        branch_stmt = select(AgentRun.worktree_branch).where(
            AgentRun.mission_id == mission_id,
            AgentRun.status == "completed",
            AgentRun.worktree_branch.is_not(None),
        )
        branches = [
            b
            for b in (await self._session.execute(branch_stmt)).scalars().all()
            if b  # 防御：DB 非空约束外的空字符串
        ]

        if not branches:
            log.info(
                "finalizer_execute_no_worktree_branches",
                mission_id=str(mission_id),
                has_patch=has_patch,
            )
            return FinalizerMergeResult(
                merged_branches=merged_branches,
                pending_conflicts=pending_conflicts,
            )

        # resolve workspace（git_merge 需要 Workspace 入参走 RPC）。
        mission = await self._session.get(AgentMission, mission_id)
        workspace: Workspace | None = None
        if mission is not None:
            workspace = await self._session.get(Workspace, mission.workspace_id)
        if workspace is None:
            log.warning(
                "finalizer_execute_workspace_unresolved_skip_merge",
                mission_id=str(mission_id),
                branch_count=len(branches),
            )
            return FinalizerMergeResult(
                merged_branches=merged_branches,
                pending_conflicts=pending_conflicts,
            )

        # 逐个合并：ok=True 收 merged；ok=False（conflict 或 error）收 conflicts，
        # 不中断继续下一个（design §5.1 步骤6「继续合能合的」）。
        for branch in branches:
            try:
                result = await self._host_fs_delegate.git_merge(workspace, worker_branch=branch)
            except Exception as exc:  # delegate 异常（非 degraded dict）兜底
                log.warning(
                    "finalizer_execute_git_merge_exception",
                    mission_id=str(mission_id),
                    worker_branch=branch,
                    error=str(exc),
                )
                pending_conflicts.append(
                    {"file": None, "marker_lines": [], "branch": branch, "error": str(exc)}
                )
                continue
            if not isinstance(result, dict):
                log.warning(
                    "finalizer_execute_git_merge_bad_result",
                    mission_id=str(mission_id),
                    worker_branch=branch,
                    result_type=type(result).__name__,
                )
                continue
            if result.get("ok") is True:
                merged_branches.append(branch)
                log.info(
                    "finalizer_execute_branch_merged",
                    mission_id=str(mission_id),
                    worker_branch=branch,
                    merged_files=result.get("merged_files", []),
                )
            else:
                conflicts = result.get("conflicts") or []
                pending_conflicts.extend(conflicts)
                log.info(
                    "finalizer_execute_branch_conflict",
                    mission_id=str(mission_id),
                    worker_branch=branch,
                    conflict_count=len(conflicts),
                    error=result.get("error"),
                )

        log.info(
            "finalizer_execute_merge_done",
            mission_id=str(mission_id),
            merged=len(merged_branches),
            conflicts=len(pending_conflicts),
            has_patch=has_patch,
        )
        return FinalizerMergeResult(
            merged_branches=merged_branches,
            pending_conflicts=pending_conflicts,
        )

    async def cleanup_mission(self, mission_id: uuid.UUID) -> dict[str, Any]:
        """全合并成功后逐个清各 worker worktree 副本 + 复用既有 patch artifact（task-07）。

        仅在 task-06 ``converge_mission`` 判定「全成功」（无 pending_conflicts /
        无 needs_manual）时被调用——失败路径副本保留供人工排查（design §9 / X-003，
        caller 控制不调本方法）。合并后立即清理，无 GC 机制（D-005）。

        逻辑（design §5.1 步骤7-8）：
        1. 未注入 delegate（既有调用方）→ 返回空结果，零回归（design §9）。
        2. resolve mission / workspace；workspace 缺 → 不崩，返回空。
        3. 采 patch artifact：**复用 task-04 既有采集**（``collect_completed_artifacts``
           在 converge 前已把各 worker ``diff_summary`` 采成 ``kind=patch`` artifact），
           取首个 patch artifact id（避免新读 diff 方法，task-07 授权）；无则 None。
        4. 取 mission 各 completed worker 的 ``worktree_branch``，按 D-001@v2 公式
           算 ``sibling_path = resolve_root_path_for_daemon(ws.root_path)
           + /.worktrees/ + run.id[:8]``（与 task-03 ``execution.dispatch_worker``
           一致——否则清不掉副本）。
        5. 逐个 ``delegate.git_worktree_remove(ws, sibling_path=...)``；``ok=True`` 收
           ``cleaned``；``ok=False`` / 异常记日志不中断（best-effort，design §5.1
           步骤8 全清意图；副本残留不阻塞 mission 收尾）。

        返回 ``{cleaned: [sibling_path...], patch_artifact_id: UUID | None}``
        （task-06 ``converge_mission`` 消费契约）。
        """
        # 未注入 delegate → 零回归（既有调用方 / converge_mission_for_completed_run）。
        if self._host_fs_delegate is None:
            log.info(
                "finalizer_cleanup_no_delegate_skip",
                mission_id=str(mission_id),
            )
            return {"cleaned": [], "patch_artifact_id": None}

        # resolve workspace（git_worktree_remove 需要 Workspace 入参走 RPC）。
        mission = await self._session.get(AgentMission, mission_id)
        workspace: Workspace | None = None
        if mission is not None:
            workspace = await self._session.get(Workspace, mission.workspace_id)
        if mission is None or workspace is None or not workspace.root_path:
            log.warning(
                "finalizer_cleanup_workspace_unresolved_skip",
                mission_id=str(mission_id),
            )
            return {"cleaned": [], "patch_artifact_id": None}

        # 采 patch artifact（复用 task-04 既有采集，取首个）。
        patch_stmt = (
            select(AgentArtifact.id)
            .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
            .where(AgentRun.mission_id == mission_id, AgentArtifact.kind == "patch")
            .order_by(AgentArtifact.created_at)
            .limit(1)
        )
        patch_artifact_id = (await self._session.execute(patch_stmt)).scalars().first()

        # 取 mission 各 completed worker 的 worktree_branch + run.id（算 sibling_path）。
        # task-03 dispatch_worker 填 worktree_branch = "workers/<run.id[:8]>"，sibling_path
        # 独立按 run.id 算（不依赖 branch 字符串解析，更鲁棒）。
        worker_stmt = select(AgentRun.id).where(
            AgentRun.mission_id == mission_id,
            AgentRun.status == "completed",
            AgentRun.worktree_branch.is_not(None),
        )
        worker_run_ids = list((await self._session.execute(worker_stmt)).scalars().all())

        if not worker_run_ids:
            log.info(
                "finalizer_cleanup_no_worktree_branches",
                mission_id=str(mission_id),
                patch_artifact_id=str(patch_artifact_id) if patch_artifact_id else None,
            )
            return {"cleaned": [], "patch_artifact_id": patch_artifact_id}

        # 宿主机原生 base（与 task-03 dispatch_worker 同款容器→宿主改写）。
        base_root = resolve_root_path_for_daemon(workspace.root_path)

        cleaned: list[str] = []
        for run_id in worker_run_ids:
            sibling_path = f"{base_root}/.worktrees/{str(run_id)[:8]}"
            try:
                result = await self._host_fs_delegate.git_worktree_remove(
                    workspace, sibling_path=sibling_path
                )
            except Exception as exc:
                # delegate 异常兜底：不崩，该副本不计 cleaned，继续清其他
                # （design §9 兼容 — cleanup 不阻塞 mission 收尾）。
                log.warning(
                    "finalizer_cleanup_git_worktree_remove_exception",
                    mission_id=str(mission_id),
                    run_id=str(run_id),
                    sibling_path=sibling_path,
                    error=str(exc),
                )
                continue
            if isinstance(result, dict) and result.get("ok") is True:
                cleaned.append(sibling_path)
                log.info(
                    "finalizer_cleanup_worktree_removed",
                    mission_id=str(mission_id),
                    run_id=str(run_id),
                    sibling_path=sibling_path,
                )
            else:
                # ok=False（RPC degraded / git 错）→ 记失败，继续清其他（best-effort）。
                err = result.get("error") if isinstance(result, dict) else "bad_result"
                log.warning(
                    "finalizer_cleanup_worktree_remove_failed",
                    mission_id=str(mission_id),
                    run_id=str(run_id),
                    sibling_path=sibling_path,
                    error=err,
                )

        log.info(
            "finalizer_cleanup_done",
            mission_id=str(mission_id),
            cleaned=len(cleaned),
            attempted=len(worker_run_ids),
            patch_artifact_id=str(patch_artifact_id) if patch_artifact_id else None,
        )
        return {"cleaned": cleaned, "patch_artifact_id": patch_artifact_id}


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
        # task-05（D-003@v1 / D-005@v2）：finalize_execute_mission 实际逐个 git_merge
        # 各 worker worktree_branch 到 workspace root，返回 FinalizerMergeResult
        # （merged_branches / pending_conflicts）。注意：本调用方未注入 host_fs_delegate
        # → finalize_execute_mission 跳过实际 merge 返回空结果（保留 task-04 既有行为，
        # design §9 零回归）；生产接线（注入 delegate）留 task-08 集成。
        merge_result = await finalizer.finalize_execute_mission(mission_id)
        # 路由分流契约（task-04 既有语义，task-05 保留）：execute mission = 有 patch
        # artifact（write worker 的 diff_summary）或有 worktree_branch；bootstrap
        # mission（read-only summary only，无 patch 无 branch）→ finalize_bootstrap_mission
        # 合并 summary。merge_result 空 + 无 patch artifact = bootstrap 路径。
        has_patch = await finalizer.has_execute_patches(mission_id)
        is_execute_mission = bool(
            merge_result.merged_branches or merge_result.pending_conflicts or has_patch
        )
        if not is_execute_mission:
            await finalizer.finalize_bootstrap_mission(mission_id)
        log.info(
            "mission_converged",
            mission_id=str(mission_id),
            status=status,
            trigger_run_id=str(run_id),
            merged_branches=len(merge_result.merged_branches),
            pending_conflicts=len(merge_result.pending_conflicts),
            is_execute_mission=is_execute_mission,
        )
    return status
