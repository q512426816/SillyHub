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
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.delegation import GLMConfig
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentArtifact,
    AgentMission,
    AgentRun,
    AgentSession,
    mission_worker_sessions_tree,
)
from app.modules.daemon.host_fs import HostFsDelegate, new_host_fs_delegate
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
        """合并产物载体 run（task-06 锚点统一，design §5 核心机制 D-009/D-010）。

        优先取该 mission 最新 ``role='orchestrator'`` 主控轮 run——会话 mission 的
        主控轮是逐 turn 回填双标记的多条 run（task-04/05），取最新一条与
        ``mcp_tools._get_main_run`` / converge 锚点同规则；存量 team mission 单主控
        run 且先于 worker 创建（首条即唯一），同规则命中零回归。

        无主控轮回填（存量 worker-only mission / single mode）→ 回落最早一条 run
        （v1 flat 语义不变，兼容 test_finalizer 存量链路）。
        """
        stmt = (
            select(AgentRun)
            .where(AgentRun.mission_id == mission_id, AgentRun.role == "orchestrator")
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
        run = (await self._session.execute(stmt)).scalars().first()
        if run is not None:
            return run
        fallback_stmt = (
            select(AgentRun)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentRun.created_at)
            .limit(1)
        )
        return (await self._session.execute(fallback_stmt)).scalars().first()

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
        """Merge execute Worker worktree branches 按 target_workspace_id 分组（task-11）.

        design §4.3 收敛分组公式：
        1. 取 mission 各 completed worker 的 ``(target_workspace_id, worktree_branch)`` 二元组
           （target 为 NULL 时回退 mission.workspace_id 即 anchor）。
        2. 按 target_workspace_id 分组（defaultdict(list)）。
        3. 每组：resolve Workspace → 逐个 ``git_merge(ws, worker_branch)``；冲突按组独立
           收集（A 组冲突不挡 B 组合并，pending_conflicts 携带 target_workspace_id）。
        4. resolve 失败的组 log 跳过不崩其它组（best-effort）。

        未注入 delegate 或 worker 无 ``worktree_branch``（老路径 / single mode）→
        返回空结果（``merged_branches=[]`` / ``pending_conflicts=[]``）。caller
        （converge）据 ``has_execute_patches`` 决定是否回退 ``finalize_bootstrap_mission``
        （design §9 兼容策略；task-04 既有 patch artifact 采集由
        ``collect_completed_artifacts`` 在 converge 前已产出，非本方法职责）。

        返回 ``FinalizerMergeResult``（task-06 / task-07 消费契约）。
        """
        from collections import defaultdict

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

        # 取 mission 各 completed worker 的 (target_workspace_id, worktree_branch) 二元组
        # （task-03 dispatch 时填 worktree_branch，task-01/04 填 target_workspace_id）。
        # target_workspace_id 为 NULL 时回退到 mission.workspace_id（anchor，零回归）。
        mission = await self._session.get(AgentMission, mission_id)
        if mission is None:
            log.warning(
                "finalizer_execute_mission_unresolved_skip_merge",
                mission_id=str(mission_id),
            )
            return FinalizerMergeResult(
                merged_branches=merged_branches,
                pending_conflicts=pending_conflicts,
            )
        anchor_workspace_id = mission.workspace_id

        branch_stmt = select(
            AgentRun.target_workspace_id,
            AgentRun.worktree_branch,
        ).where(
            AgentRun.mission_id == mission_id,
            AgentRun.status == "completed",
            AgentRun.worktree_branch.is_not(None),
        )
        rows = (await self._session.execute(branch_stmt)).all()

        if not rows:
            log.info(
                "finalizer_execute_no_worktree_branches",
                mission_id=str(mission_id),
                has_patch=has_patch,
            )
            return FinalizerMergeResult(
                merged_branches=merged_branches,
                pending_conflicts=pending_conflicts,
            )

        # 按 target_workspace_id 分组：NULL 回退 anchor，各组的 (target_ws, branch) 列表
        grouped: dict[uuid.UUID, list[tuple[uuid.UUID, str]]] = defaultdict(list)
        for target_ws, branch in rows:
            effective_target = target_ws or anchor_workspace_id
            grouped[effective_target].append((effective_target, branch))

        # 每组独立合并：resolve Workspace → 逐个 git_merge
        for target_ws_id, branches_tuple in grouped.items():
            # resolve 该组的 Workspace（失败跳过该组不崩其它组）
            ws: Workspace | None = await self._session.get(Workspace, target_ws_id)
            if ws is None or not ws.root_path:
                log.warning(
                    "finalizer_execute_workspace_unresolved_skip_group",
                    mission_id=str(mission_id),
                    target_workspace_id=str(target_ws_id),
                    branch_count=len(branches_tuple),
                )
                # 该组所有 branch 标记冲突（error 字段说明原因）
                for _, branch in branches_tuple:
                    pending_conflicts.append(
                        {
                            "file": None,
                            "marker_lines": [],
                            "branch": branch,
                            "error": f"workspace {target_ws_id} unresolved",
                            "target_workspace_id": str(target_ws_id),
                        }
                    )
                continue

            # 逐个合并该组的 branch：ok=True 收 merged；ok=False 收 conflicts（携带 target）
            for _, branch in branches_tuple:
                try:
                    result = await self._host_fs_delegate.git_merge(ws, worker_branch=branch)
                except Exception as exc:  # delegate 异常（非 degraded dict）兜底
                    log.warning(
                        "finalizer_execute_git_merge_exception",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
                        worker_branch=branch,
                        error=str(exc),
                    )
                    pending_conflicts.append(
                        {
                            "file": None,
                            "marker_lines": [],
                            "branch": branch,
                            "error": str(exc),
                            "target_workspace_id": str(target_ws_id),
                        }
                    )
                    continue
                if not isinstance(result, dict):
                    log.warning(
                        "finalizer_execute_git_merge_bad_result",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
                        worker_branch=branch,
                        result_type=type(result).__name__,
                    )
                    continue
                if result.get("ok") is True:
                    merged_branches.append(branch)
                    log.info(
                        "finalizer_execute_branch_merged",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
                        worker_branch=branch,
                        merged_files=result.get("merged_files", []),
                    )
                else:
                    conflicts = result.get("conflicts") or []
                    # 每条冲突携带 target_workspace_id（前端分组展示）
                    for cf in conflicts:
                        cf["target_workspace_id"] = str(target_ws_id)
                    pending_conflicts.extend(conflicts)
                    log.info(
                        "finalizer_execute_branch_conflict",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
                        worker_branch=branch,
                        conflict_count=len(conflicts),
                        error=result.get("error"),
                    )

        log.info(
            "finalizer_execute_merge_done",
            mission_id=str(mission_id),
            merged=len(merged_branches),
            conflicts=len(pending_conflicts),
            group_count=len(grouped),
            has_patch=has_patch,
        )
        return FinalizerMergeResult(
            merged_branches=merged_branches,
            pending_conflicts=pending_conflicts,
        )

    async def cleanup_mission(self, mission_id: uuid.UUID) -> dict[str, Any]:
        """全合并成功后按 target_workspace_id 分组清 worktree 副本（task-12）.

        仅在 task-06 ``converge_mission`` 判定「全成功」（无 pending_conflicts /
        无 needs_manual）时被调用——失败路径副本保留供人工排查（design §9 / X-003，
        caller 控制不调本方法）。合并后立即清理，无 GC 机制（D-005）.

        逻辑（design §4.3 / D-011）：
        1. 未注入 delegate（既有调用方）→ 返回空结果，零回归（design §9）。
        2. 采 patch artifact：**复用 task-04 既有采集**（``collect_completed_artifacts``
           在 converge 前已把各 worker ``diff_summary`` 采成 ``kind=patch`` artifact），
           取首个 patch artifact id（避免新读 diff 方法，task-07 授权）；无则 None。
        3. 取 mission 各终态 worker 的 ``(run_id, target_workspace_id)`` 二元组
           （target 为 NULL 时回退 mission.workspace_id 即 anchor）；task-09 起
           run 归属分身子会话时按 ``is_worker_complete`` 会话判定过滤——只清
           **已完成分身**的副本，未完成分身（idle 未 done / 追问重开工中）cwd
           不动（design §5.C.5）。
        4. 按 target_workspace_id 分组（defaultdict(list)）——每组共享一个 Workspace。
        5. 每组：resolve Workspace → 逐个 ``git_worktree_remove(ws, sibling_path)``；
           sibling_path 按 D-001@v2 公式算（``resolve_root_path_for_daemon(ws.root_path)
           + /.worktrees/ + run.id[:8]``，与 task-03 ``execution.dispatch_worker``
           一致——否则清不掉副本）。
        6. resolve 失败的组 log 跳过不崩其它组（best-effort，对齐 task-11）。
        7. 全 NULL target 退化单组（单 ws 零回归）。

        返回 ``{cleaned: [sibling_path...], patch_artifact_id: UUID | None}``
        （task-06 ``converge_mission`` 消费契约）。
        """
        from collections import defaultdict

        # 未注入 delegate → 零回归（既有调用方 / converge_mission_for_completed_run）。
        if self._host_fs_delegate is None:
            log.info(
                "finalizer_cleanup_no_delegate_skip",
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

        # 取 mission 各终态 worker 的 (run_id, target_workspace_id) 二元组
        # （task-03 dispatch 时填 target_workspace_id，task-01 增加列）。
        # target_workspace_id 为 NULL 时回退到 mission.workspace_id（anchor）。
        # BE-P1-4a（2026-08-21 审查）：过滤从 completed 扩到全部终态（failed/killed）。
        # dispatch 失败 / worker 运行失败的 run 只要建了 worktree（worktree_branch
        # 非空），副本与分支同样占磁盘；cleanup 被"无冲突全 merged"路径调用时该
        # worker 的半成品无保留价值（排查副本仅 conflict 场景保留，X-003）。
        mission = await self._session.get(AgentMission, mission_id)
        if mission is None:
            log.warning(
                "finalizer_cleanup_mission_unresolved_skip",
                mission_id=str(mission_id),
            )
            return {"cleaned": [], "patch_artifact_id": patch_artifact_id}
        anchor_workspace_id = mission.workspace_id

        worker_stmt = select(
            AgentRun.id,
            AgentRun.target_workspace_id,
            AgentRun.agent_session_id,
        ).where(
            AgentRun.mission_id == mission_id,
            AgentRun.status.in_(("completed", "failed", "killed")),
            AgentRun.worktree_branch.is_not(None),
        )
        raw_rows = (await self._session.execute(worker_stmt)).all()
        if not raw_rows:
            log.info(
                "finalizer_cleanup_no_worktree_branches",
                mission_id=str(mission_id),
                patch_artifact_id=str(patch_artifact_id) if patch_artifact_id else None,
            )
            return {"cleaned": [], "patch_artifact_id": patch_artifact_id}

        # task-09（FR-05，design §5.C.5）：清理名单判据换 is_worker_complete——
        # run 属于分身子会话（agent_session_id ∈ mission_worker_sessions_tree
        # 全树，task-08 起含孙层）时按 **会话**判定完成：首 run 终态 ≠ 分身完成，
        # idle 未 done / 追问重开工中的分身 cwd 不动（副本保留供后续轮次）；
        # 已完成孙分身的 worktree 副本同样清理，未完成孙不动（design §5.E）。
        # 存量 batch run（无子会话归属）的 is_worker_complete 即 run 终态，与
        # SQL 过滤等价，名单零回归（FR-09）。
        from app.modules.agent.mission import is_worker_complete

        worker_sessions = await mission_worker_sessions_tree(self._session, mission_id)
        worker_sessions_by_id = {s.id: s for s in worker_sessions}
        rows: list[tuple[uuid.UUID, uuid.UUID | None]] = []
        for run_id, target_ws, agent_session_id in raw_rows:
            owner_session = (
                worker_sessions_by_id.get(agent_session_id)
                if agent_session_id is not None
                else None
            )
            if owner_session is not None and not await is_worker_complete(
                self._session, owner_session
            ):
                log.info(
                    "finalizer_cleanup_worker_incomplete_skip",
                    mission_id=str(mission_id),
                    run_id=str(run_id),
                    agent_session_id=str(agent_session_id),
                )
                continue
            rows.append((run_id, target_ws))
        if not rows:
            log.info(
                "finalizer_cleanup_all_workers_incomplete",
                mission_id=str(mission_id),
                raw_candidates=len(raw_rows),
                patch_artifact_id=str(patch_artifact_id) if patch_artifact_id else None,
            )
            return {"cleaned": [], "patch_artifact_id": patch_artifact_id}

        # 按 target_workspace_id 分组：NULL 回退 anchor，各组的 [(run_id, target_ws)] 列表
        grouped: dict[uuid.UUID, list[tuple[uuid.UUID, uuid.UUID | None]]] = defaultdict(list)
        for run_id, target_ws in rows:
            effective_target = target_ws or anchor_workspace_id
            grouped[effective_target].append((run_id, target_ws))

        # 每组独立清理：resolve Workspace → 逐个 git_worktree_remove
        cleaned: list[str] = []
        for target_ws_id, run_tuples in grouped.items():
            # resolve 该组的 Workspace（失败跳过该组不崩其它组）
            ws: Workspace | None = await self._session.get(Workspace, target_ws_id)
            if ws is None or not ws.root_path:
                log.warning(
                    "finalizer_cleanup_workspace_unresolved_skip_group",
                    mission_id=str(mission_id),
                    target_workspace_id=str(target_ws_id),
                    run_count=len(run_tuples),
                )
                # 该组所有 run 的 worktree 跳过（best-effort，对齐 task-11）
                continue

            # 宿主机原生 base（与 task-03 dispatch_worker 同款容器→宿主改写）。
            base_root = resolve_root_path_for_daemon(ws.root_path)

            # 逐个清理该组的 worktree
            for run_id, _ in run_tuples:
                sibling_path = f"{base_root}/.worktrees/{str(run_id)[:8]}"
                try:
                    result = await self._host_fs_delegate.git_worktree_remove(
                        ws, sibling_path=sibling_path
                    )
                except Exception as exc:
                    # delegate 异常兜底：不崩，该副本不计 cleaned，继续清其他
                    # （design §9 兼容 — cleanup 不阻塞 mission 收尾）。
                    log.warning(
                        "finalizer_cleanup_git_worktree_remove_exception",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
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
                        target_workspace_id=str(target_ws_id),
                        run_id=str(run_id),
                        sibling_path=sibling_path,
                    )
                else:
                    # ok=False（RPC degraded / git 错）→ 记失败，继续清其他（best-effort）。
                    err = result.get("error") if isinstance(result, dict) else "bad_result"
                    log.warning(
                        "finalizer_cleanup_worktree_remove_failed",
                        mission_id=str(mission_id),
                        target_workspace_id=str(target_ws_id),
                        run_id=str(run_id),
                        sibling_path=sibling_path,
                        error=err,
                    )

        log.info(
            "finalizer_cleanup_done",
            mission_id=str(mission_id),
            cleaned=len(cleaned),
            attempted=sum(len(runs) for runs in grouped.values()),
            patch_artifact_id=str(patch_artifact_id) if patch_artifact_id else None,
            group_count=len(grouped),
        )
        return {"cleaned": cleaned, "patch_artifact_id": patch_artifact_id}


async def _session_has_active_turn(db: AsyncSession, session_id: uuid.UUID) -> bool:
    """会话当前是否有活跃 turn（ACTIVE_RUN_STATUSES 词表单源）。

    状态集合与 daemon/router._session_has_active_turn 同口径（task-02 契约的
    ``session_active_turn`` 入参来源）；finalizer 不能 import daemon.router
    （循环依赖），2026-08-25 二审 #3 起改为共享 ``agent.model.ACTIVE_RUN_STATUSES``
    常量（pending/running/pending_approval——修复审批中漏判；interrupting 为
    前端展示态，backend 不落库，已剔除）。
    """
    stmt = (
        select(AgentRun.id)
        .where(
            AgentRun.agent_session_id == session_id,
            AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).first() is not None


async def _end_mission_worker_subsessions(
    db: AsyncSession,
    mission_id: uuid.UUID,
    *,
    trigger_run_id: uuid.UUID | None = None,
) -> int:
    """converge 成功后沿会话树批量收口分身子会话（task-10 / FR-06 / design §5.D）。

    ``mission_worker_sessions_tree(mission_id)`` **全树**枚举分身子会话
    （2026-08-26-team-subsession-recursion task-08 起，design §5.E——converge
    后孙层分身同样 end_session，best-effort 语义不变；无孙树与一层枚举等价，
    FR-08 零回归），逐个复用 ``SessionService.end_session`` 既有链收口——子会话
    ended + interactive lease completed + P0-2 修好的 SESSION_END WS
    best-effort 下发。end_session 自带幂等（已 ended/failed 早退），重复调用
    零副作用；本 helper 不重造 kill 逻辑、不直接翻 DB 会话状态（TaskCard 约束）。

    - 属主校验：``user_id=mission.created_by``（分身子会话 user_id = mission
      创建者，design §5.E / D-004@v1，owner-only 校验自然通过）；reason 固定
      ``mission_converged``。mission 不存在 / created_by 缺失（脏数据）整体
      跳过，孤儿交 task-12 patrol 兜底。
    - best-effort：单个收口失败 ``log.warning`` 继续下一个，整体不抛出——
      时序契约（TaskCard）：end_session 在 converged_at 与 merge 结果已落库
      **之后**执行，收口失败不影响置位与 converge 返回值；残留孤儿子会话由
      task-12 patrol 扫描兜底。
    - 仅由 converge 成功路径（R5 抢占命中 + finalize 无 pending_conflicts）
      调用；冲突回滚 / needs_manual / finalize 异常回滚三分支零调用（design
      §5.D 铁律——子会话保持活跃供解冲突参考）。

    返回成功收口条数（观测用）；无分身（存量 mission）枚举空集 no-op 返 0。
    """
    # 延迟 import 对齐 converge_mission_for_completed_run 既有防循环模式
    # （daemon.session.service 依赖链宽，agent.finalizer 被 daemon.lease 消费）。
    from app.modules.daemon.session.service import SessionService

    mission = await db.get(AgentMission, mission_id)
    if mission is None or mission.created_by is None:
        log.warning(
            "converge_close_workers_owner_unresolved",
            mission_id=str(mission_id),
            trigger_run_id=str(trigger_run_id) if trigger_run_id else None,
        )
        return 0
    owner_id = mission.created_by
    workers = await mission_worker_sessions_tree(db, mission_id)
    if not workers:
        return 0
    # 预取 id/属主标量：end_session 失败分支会 rollback（SQLAlchemy 随之 expire
    # 会话内全部实例），循环内再访问 ORM 属性会触发隐式同步 refresh（asyncio
    # 下 MissingGreenlet）——best-effort 循环只消费标量。
    worker_ids = [w.id for w in workers]

    svc = SessionService(db)
    ended = 0
    for worker_id in worker_ids:
        try:
            await svc.end_session(worker_id, owner_id, reason="mission_converged")
            ended += 1
        except Exception as exc:
            # best-effort：单个失败（owner 不匹配 / lease 绑定异常 / daemon 离线
            # 抛出）只记 warning 继续下一个，不阻断 converge 返回（TaskCard）。
            log.warning(
                "converge_close_worker_failed",
                mission_id=str(mission_id),
                worker_session_id=str(worker_id),
                trigger_run_id=str(trigger_run_id) if trigger_run_id else None,
                error=str(exc),
            )
    log.info(
        "converge_close_workers_done",
        mission_id=str(mission_id),
        workers=len(workers),
        ended=ended,
        trigger_run_id=str(trigger_run_id) if trigger_run_id else None,
    )
    return ended


async def converge_mission_for_completed_run(
    session: AsyncSession,
    run_id: uuid.UUID,
    glm_config: GLMConfig | None = None,
    *,
    converge_explicit: bool = False,
) -> str | None:
    """Mission 收敛入口（D-007@v1）—— ``complete_lease`` 末尾调用。

    1. run 不属于任何 mission → 跳过（绝大多数 lease，零影响 — 兼容 SC-5）。
    2. ``collect_completed_artifacts`` 回灌（C2：按 run 维度在 complete_lease 触发，
       与 session end 解耦，覆盖 batch + interactive）。
    3. 全 Worker 终态（``derive_status`` 返回 ``done``/``degraded``）→ Finalizer 合并。

    task-06（2026-08-22-team-session-unify / D-010，design §5 Phase 1 / §7.5）新增
    ``converge_explicit``（显式收敛入口——mcp_tools._converge_core MCP converge /
    task-08 patrol awaiting_input 超时收敛复用）：

    - 显式路径（task-09 判据换 task-08 单一真相源）：``mission_derive_status(
      workers_only=True)``——输入收窄为**分身维度**（存量 batch run 原样 +
      分身子会话虚拟 run 映射；主控轮剔除、NULL role 守卫同
      ``non_orchestrator_runs`` 口径），置位/合并**不依赖主控 run 状态**（会话
      mission 主控轮当轮 running 也要能收敛）；判据含 ``failed``（分身全完成但
      无一 completed 仍属「全完成」→ 置位 converged_at，design §7.5 converge
      行）与 ``awaiting_input``（分身全完成 + 会话空档，patrol 超时路径），置位
      后重派生落到终态档。
    - 非显式路径（complete_lease / schedule_loop）对会话 mission（``session_id``
      指向真实存在的 ``AgentSession``，查表判别）**不自动收敛**：contract 表
      （design §7.5）会话
      mission 的收敛入口只有 MCP converge 与 patrol 超时——complete_lease 提前
      置位会让 awaiting_input 窗口失效，且 converged_at 一置位会话活跃 mission
      即查不到，mid-turn 自动收敛会把主控后续 dispatch_worker 挤去懒建新
      mission（破坏动态加派）。仅做 artifact 回灌，返回会话维度派生状态供日志。
    - 存量 mission（随机 session_id 查无会话行）：非显式路径 derive 输入/判据/
      触发逐字节不变（complete_lease 自动收敛零回归，Grill NEW-4）。
    - 显式路径冲突守卫：``finalize_execute_mission`` 存在 pending conflicts 且
      converged_at 是本次抢占置位 → 回滚为 NULL——冲突未解决不算收敛，保持会话
      活跃 mission 可解析，主 agent 解决后重入 converge 不 404（重入语义不回退）。

    返回收敛后的 mission status（``done``/``degraded``/``running``/...），或 None
    表示 run 不属于 mission。任何异常由调用方（complete_lease）try/except 兜底，
    不阻塞 lease 完成。

    task-10（2026-08-25-team-subsession-governance / FR-06 / design §5.D）：收敛
    成功（置位已落库 + merge 无 pending_conflicts，bootstrap 分支与 execute 全
    merged 分支均算）后沿会话树逐个 ``end_session`` 收口分身子会话（
    ``_end_mission_worker_subsessions``，best-effort 不抛出）；冲突回滚 /
    needs_manual / finalize 异常回滚三分支零收口——子会话保持活跃供解冲突参考。
    """
    run = await session.get(AgentRun, run_id)
    if run is None or run.mission_id is None:
        return None

    # 延迟 import 避免与 execution/mission/control 的循环 import 风险
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.execution import MissionExecutionService
    from app.modules.agent.mission import derive_status, mission_derive_status

    mission_id = run.mission_id
    exec_svc = MissionExecutionService(session, host_fs_delegate=new_host_fs_delegate(session))
    await exec_svc.collect_completed_artifacts(mission_id)

    ctrl = MissionControlService(session)
    mission = await session.get(AgentMission, mission_id)
    cancelled = mission is not None and mission.cancelled_at is not None
    if converge_explicit:
        # task-09（FR-05）：判据换 task-08 单一真相源 mission_derive_status
        # (workers_only=True)——分身子会话经虚拟 run 映射（idle 未 done →
        # running，不被首 run 终态遮蔽）、主控轮剔除（D-010 置位不依赖主控 run
        # 状态，NULL role 守卫同 non_orchestrator_runs 口径）。should_converge 的
        # done/degraded/failed 语义不变；awaiting_input（分身全完成 + 会话空档）
        # 同属「分身全完成」档——patrol 超时收敛路径会话必 idle，不收该档会永久
        # 卡 awaiting_input；置位成功后 converged=True 重派生自然落到终态档。
        status = await mission_derive_status(session, mission_id, workers_only=True)
        should_converge = status in ("done", "degraded", "failed", "awaiting_input")
    else:
        runs = await ctrl.worker_runs(mission_id)
        # 会话 mission 判别：session_id 列对存量构造路径 default_factory 兜底随机
        # uuid（model.py task-01 注释），不能仅凭非 NULL 判定——按「该 id 的
        # AgentSession 真实存在」判别（task-03 预建 / task-05 懒建必传真实会话；
        # 存量 team/external mission 随机 uuid 查无此行 → 走原自动收敛路径）。
        bound_session = (
            await session.get(AgentSession, mission.session_id)
            if mission is not None and mission.session_id is not None
            else None
        )
        if bound_session is not None:
            # 会话 mission 的 complete_lease/schedule_loop 不自动收敛（见
            # docstring）；返回会话维度派生状态（awaiting_input 窗口保留）。
            session_active_turn = await _session_has_active_turn(session, mission.session_id)
            return derive_status(
                runs,
                cancelled=cancelled,
                converged=mission.converged_at is not None,
                has_session=True,
                session_active_turn=session_active_turn,
            )
        status = derive_status(runs, cancelled=cancelled)
        should_converge = status in ("done", "degraded")

    # 路径A external mode 短路（task-03 / D-003@v2 / R-01 根解层①）：external mission
    # 由 caller（SillySpec）自己 apply 回主干，SillyHub 绝不 merge / 清 caller
    # worktree。命中 → 跳过 finalize_execute_mission / finalize_bootstrap_mission
    # （及连带 cleanup_mission），不触发任何 git merge / worktree remove。team mission
    # （constraints 无 orchestration_mode 或 ="team"）默认不命中 → 下方 finalize 块走
    # 原 merge 逻辑，字节不变（design §9 零回归）。collect_completed_artifacts 已在上
    # 文执行（只读回灌 worker artifact，幂等无害）。双保险：即使本检测失效，路径A
    # dispatch 不写 run.worktree_branch（task-02）→ finalize_execute_mission 查空也
    # 跳过 merge（本文件 :266）。
    if mission is not None and (mission.constraints or {}).get("orchestration_mode") == "external":
        log.info(
            "converge_external_mode_skip_finalize",
            mission_id=str(mission_id),
            status=status,
            trigger_run_id=str(run_id),
        )
        return status

    if should_converge:
        # R5 守卫（2026-07-25）：原子抢占 converged_at（UPDATE...WHERE IS NULL）。
        # 两个 worker 同时 complete → 两个 converge 都 derive 出 done/degraded，但只有
        # 抢占到（rowcount=1）的执行 finalize；另一个 rowcount=0 直接返回，不重复
        # finalize（重复 GLM 合并 / merge artifact）。用原子 UPDATE 而非 with_for_update
        # 行锁：finalize_* 内部 commit 会释放行锁，挡不住"finalize commit 后置位前"的并发。
        # collect_completed_artifacts 幂等（已有 artifact 的 run 跳过，execution.py:305），
        # 重复 collect 无害，故守卫只需挡 finalize。
        claim = await session.execute(
            update(AgentMission)
            .where(AgentMission.id == mission_id, AgentMission.converged_at.is_(None))
            .values(converged_at=datetime.now(UTC))
        )
        if claim.rowcount == 0:
            log.info(
                "mission_already_converged",
                mission_id=str(mission_id),
                trigger_run_id=str(run_id),
            )
            return status
        await session.commit()
        if status == "awaiting_input":
            # task-09：置位已落库（converged_at 非空）→ 重派生落到终态档
            # （done/degraded/failed），消费方（mcp busy 前置透传 / patrol 收敛
            # 计数）拿到的仍是收敛终态值，不泄漏 awaiting_input 中间档。
            status = await mission_derive_status(session, mission_id, workers_only=True)

        finalizer = FinalizerService(
            session, glm_config, host_fs_delegate=new_host_fs_delegate(session)
        )
        # task-05（D-003@v1 / D-005@v2）：finalize_execute_mission 实际逐个 git_merge
        # 各 worker worktree_branch 到 workspace root，返回 FinalizerMergeResult
        # （merged_branches / pending_conflicts）。注意：本调用方未注入 host_fs_delegate
        # → finalize_execute_mission 跳过实际 merge 返回空结果（保留 task-04 既有行为，
        # design §9 零回归）；生产接线（注入 delegate）留 task-08 集成。
        #
        # BE-P1-3（2026-08-21 审查）：finalize 抛异常时回滚 converged_at=NULL。原先
        # claim 先 commit、finalize 失败无回滚 → 后续重进因 rowcount=0 直接返回，
        # merge/GLM 合并永久丢失（complete_lease 侧只 log.warning 吞异常）。回滚后
        # 下一次 worker complete / schedule_loop 能重新 claim 重跑（merge 幂等，同
        # mcp converge 端点无条件重跑 _finalize_merge_for_mission 的既有语义）。
        try:
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
            elif not merge_result.pending_conflicts:
                # BE-P1-4b（2026-08-21 审查）：execute 路径全 merged（无 pending_conflicts）
                # → cleanup worktree 副本。原先本入口（complete_lease 自动收敛 /
                # schedule_loop 兜底收敛）从不调 cleanup，仅 MCP converge 端点的 merged
                # 分支调——主 agent 未调 converge tool 的 mission 全部 worker 副本永久
                # 残留磁盘。对齐端点语义：conflict 保留副本供排查（X-003）。
                cleanup_result = await finalizer.cleanup_mission(mission_id)
                log.info(
                    "mission_converged_cleanup_done",
                    mission_id=str(mission_id),
                    cleaned=len(cleanup_result.get("cleaned", [])),
                )
        except Exception:
            await session.rollback()
            await session.execute(
                update(AgentMission).where(AgentMission.id == mission_id).values(converged_at=None)
            )
            await session.commit()
            log.warning(
                "mission_finalize_failed_converge_requeued",
                mission_id=str(mission_id),
                trigger_run_id=str(run_id),
            )
            raise
        if converge_explicit and merge_result.pending_conflicts:
            # D-010 冲突重入守卫：pending conflicts 未解决不算收敛——本次抢占已
            # 置位（rowcount=1 才走到这），回滚 converged_at 保持会话活跃
            # mission 可解析（session 路由重入 converge 不 404），主 agent 用 SDK
            # 解决 + git add 后重入。副本保留供排查（X-003）。
            await session.execute(
                update(AgentMission).where(AgentMission.id == mission_id).values(converged_at=None)
            )
            await session.commit()
            log.info(
                "converge_explicit_conflict_unclaimed",
                mission_id=str(mission_id),
                trigger_run_id=str(run_id),
                pending_conflicts=len(merge_result.pending_conflicts),
            )
            return status
        # task-10（FR-06 / design §5.D 生命周期契约表 converge 行）：merge 成功
        # （置位已 commit + 无 pending_conflicts）→ 沿树逐个 end_session 收口
        # 分身子会话。execute 无冲突分支（含 BE-P1-4b cleanup 后）与 bootstrap
        # 分支（finalize_bootstrap_mission 后）在此汇合；helper 整体 best-effort
        # 不抛出——收口失败不影响已落库的 converged_at 与 converge 返回值（孤儿
        # 由 task-12 patrol 兜底）。冲突回滚（上文 early return）/ needs_manual
        # （mcp_tools 冲突状态机，置位已被上文回滚）/ finalize 异常回滚（上文
        # raise）三分支均到不了这里，零收口调用——子会话保持活跃供解冲突参考。
        if not merge_result.pending_conflicts:
            await _end_mission_worker_subsessions(session, mission_id, trigger_run_id=run_id)
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
