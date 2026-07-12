"""Mission Worker execution + Artifact collection (Wave 3, 2026-06-19-multi-agent-orchestration).

Dispatches pending mission Worker Runs to a daemon via ``RunPlacementService``
(same lease mechanism as stage dispatch — daemon needs no change to run them),
with per-Worker tool governance (brainstorm 坑 1 / D5): read-only Workers get a
read-only tool whitelist, write Workers get an edit whitelist. This does NOT
touch the existing batch stage path's ``bypassPermissions`` (avoids the ❓1
regression) — only mission Workers get the explicit whitelist.

Artifact collection is intentionally simple in v1: a Worker's structured output
becomes one ``summary`` Artifact. Richer parsing (patch / test_result) lands
with the Finalizer in Wave 4/6.

NOTE (D-004@v2, 2026-06-28-team-mainline-integration): ``tool_config`` is passed
through to the lease but the daemon does NOT apply it — ``--allowedTools`` is a
daemon-side change not done in v1. Design Grill F1 further confirmed
``canUseTool`` human-approval is only injected for interactive sessions
(``permission_service.py``), not batch Worker leases, so write-Worker tool-level
approval is also unavailable in v1. **v1 工具治理 = 不强制**: read-only and write
Workers both run under the daemon's default policy + prompt constraints; safety
for execute write-Workers converges at the Finalizer's human-reviewed patch
apply-back (D-006@v1), not at the tool layer. The whitelist below is retained as
a forward-compatibility hint for when daemon ``--allowedTools`` support lands.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentArtifact, AgentRun
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.host_fs.delegate import HostFsDelegate
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)


def worker_tool_config(read_only: bool) -> dict[str, object]:
    """Per-Worker tool governance (brainstorm 坑 1 / D5).

    Replaces the blanket ``bypassPermissions`` for mission Workers with an
    explicit whitelist scoped to the Worker's role. Read-only Workers never get
    write tools; write Workers get edit tools under ``acceptEdits``. ``max_turns``
    bounds execution so a Worker can't run unbounded (without it read-only
    analysis Workers ran 6min+).
    """
    if read_only:
        return {
            "mode": "plan",
            "allowed_tools": ["Read", "Glob", "Grep"],
            "max_turns": 25,
        }
    return {
        "mode": "acceptEdits",
        "allowed_tools": ["Read", "Glob", "Grep", "Edit", "Write", "Bash"],
        "max_turns": 30,
    }


def render_worker_prompt(run: AgentRun) -> str:
    """Render a Worker's execution prompt from its delegation objective.

    task-04（2026-07-12-worker-worktree-isolation）：末尾追加 per-worker
    worktree 协作约束（design §5.1 步骤4 + D-002@v1 + D-003@v1）——每个
    worker 在自己的 git worktree 副本里产出可合并的 commit，验证与合并
    留 converge 阶段主 agent 统一处理。
    """
    role = run.role or "worker"
    objective = run.objective or "(未指定目标)"
    return (
        f"你是多 Agent 团队中的一个 Worker（角色：{role}）。\n"
        f"你的目标：{objective}\n\n"
        "完成目标后，输出一份结构化摘要（发现/结论/产出文件路径/风险），"
        "供 Coordinator 收敛。不要输出与目标无关的内容。\n\n"
        "【worktree 协作约束（必须遵守）】\n"
        "1. 只写代码，不跑测试、不跑构建：你当前在自己的 git worktree 副本中，"
        "副本没有 node_modules / .venv 等依赖，跑测试或构建必然失败；所有验证"
        "（测试、lint、build）留给主 agent 合并（converge）后在工作区统一执行。\n"
        '2. 完成后必须提交：写完代码务必执行 `git add -A && git commit -m "<简述>"`，'
        "你的产出以 commit 形式存在，主 agent 会把你的分支 merge 回工作区——"
        "没有 commit 就没有可合并的产物。\n"
        "3. 按文件分工，不要越界：主 agent 派发任务时已指示你负责的文件/模块范围，"
        "严格在该范围内修改，不要动其他 worker 负责的文件，以减少 converge 合并时的冲突。"
    )


class MissionExecutionService:
    """Dispatches mission Worker Runs to a daemon + collects their Artifacts."""

    def __init__(
        self,
        session: AsyncSession,
        placement: RunPlacementService | None = None,
        host_fs_delegate: HostFsDelegate | None = None,
    ) -> None:
        self._session = session
        self._placement = placement or RunPlacementService(session)
        # task-03（2026-07-12-worker-worktree-isolation / D-001@v2 / D-005@v2）：
        # per-worker worktree 隔离。注入时 dispatch_worker 为每个 worker 在
        # ``ws.root_path/.worktrees/<run.id 短8>/`` 创建 git worktree 副本，把副本
        # 作 root_path 传 dispatch_to_daemon（worker cwd=副本，并发写不互相覆盖）。
        # None（默认）→ 保留原行为（root_path=ws.root_path，不建副本），single
        # mode / 既有调用方零回归（design §9）。生产接线由调用方注入
        # （router/mcp_tools，task-05）；本构造函数不 lazy 构造，因 HostFsDelegate
        # 依赖进程级 ws_hub + ws_rpc（task-02），与 placement 的纯 session 构造不对称。
        self._host_fs_delegate = host_fs_delegate

    async def dispatch_worker(
        self,
        run: AgentRun,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        read_only: bool,
    ) -> uuid.UUID | None:
        """Dispatch a pending mission Worker Run to a daemon.

        Returns the daemon lease id (or None if the runtime went offline, or
        if a per-worker worktree could not be created — design §9 兼容策略：
        worktree 创建失败标 run failed + return None，不抛，主 agent 决策补派）。
        Raises if the Run is not pending.
        """
        if run.status != "pending":
            raise ValueError(f"dispatch_worker requires pending Run, got {run.status!r}")

        ws = await self._session.get(Workspace, workspace_id)
        repo_url = ws.repo_url if ws else None
        branch = ws.default_branch if ws else None
        # 2026-06-29：Worker lease 透传 root_path（resolve_root_path_for_daemon
        # 容器→宿主机改写），让 daemon prepareWorkspace 在项目根执行（非空 mirror）。
        # D-007@2026-07-10：resolve_root_path_for_daemon 单参（path_source 列删除）。
        root_path = resolve_root_path_for_daemon(ws.root_path) if ws and ws.root_path else None
        # provider must be a daemon-known name ("claude"); fall back when the
        # workspace hasn't configured default_agent — otherwise daemon rejects
        # with "unsupported provider: claude_code" (it falls back to agent_type).
        provider = (ws.default_agent if ws else None) or "claude"
        model = ws.default_model if ws else None

        # task-03（D-001@v2 / D-005@v2）：per-worker worktree 隔离。
        # worktree 放 workspace 内 ``.worktrees/<run.id 短8>/``（非父目录 sibling
        # ——daemon ``allowed_roots`` 只含 ``ws.root_path``，父目录会被
        # ``assertWithinAllowedRoots`` 拒绝，design §7 路径策略）。
        # workspace 需在 ``.gitignore`` 排除 ``.worktrees/`` 防污染（运行时产物，
        # 非 backend 代码，本变更不动 backend/.gitignore）。
        if self._host_fs_delegate is not None and ws is not None and root_path:
            run_id_short = str(run.id)[:8]
            sibling_path = f"{root_path}/.worktrees/{run_id_short}"
            worktree_branch = f"workers/{run_id_short}"
            # X-001 空值兜底：ws.default_branch 可空（execution.py:122 同款语义），
            # 空 → "HEAD"（工作区未提交改动不带入副本，design §7）。
            base_ref = ws.default_branch or "HEAD"
            wt_result = await self._host_fs_delegate.git_worktree_add(
                ws,
                sibling_path=sibling_path,
                branch=worktree_branch,
                base_ref=base_ref,
            )
            if not (isinstance(wt_result, dict) and wt_result.get("ok") is True):
                # design §9：worktree 创建失败（daemon 离线 / RPC 失败 / git 错）
                # → worker run 标 failed，主 agent 决策补派（worker_preset 内重
                # dispatch 或收敛），不崩 mission。不抛，不调 dispatch_to_daemon
                # （worker 没拿到独立副本 cwd 就不该派 lease）。
                wt_error = wt_result.get("error") if isinstance(wt_result, dict) else "unknown"
                log.warning(
                    "mission_worker_worktree_add_failed",
                    run_id=str(run.id),
                    workspace_id=str(workspace_id),
                    sibling_path=sibling_path,
                    error=wt_error,
                )
                run.status = "failed"
                self._session.add(run)
                await self._session.commit()
                return None
            # 成功：副本路径作 root_path（worker cwd=副本）+ 填 worktree_branch
            # （converge 时 finalizer 读取合并，design §5.1 步骤3）。
            root_path = sibling_path
            run.worktree_branch = worktree_branch
            self._session.add(run)
            await self._session.commit()
            log.info(
                "mission_worker_worktree_created",
                run_id=str(run.id),
                sibling_path=sibling_path,
                branch=worktree_branch,
            )

        lease_id = await self._placement.dispatch_to_daemon(
            run.id,
            user_id,
            workspace_id=workspace_id,
            provider=provider,
            model=model,
            prompt=render_worker_prompt(run),
            repo_url=repo_url,
            branch=branch,
            stage=run.role or "mission_worker",
            read_only=read_only,
            tool_config=worker_tool_config(read_only),
            root_path=root_path,
        )
        if lease_id is not None:
            log.info(
                "mission_worker_dispatched",
                run_id=str(run.id),
                role=run.role,
                lease_id=str(lease_id),
                read_only=read_only,
            )
        return lease_id

    async def collect_artifact(
        self,
        run: AgentRun,
        output_text: str,
        *,
        kind: str = "summary",
    ) -> AgentArtifact:
        """Persist a Worker's structured output as an AgentArtifact.

        v1 stores the whole (truncated) output as one ``summary`` artifact.
        """
        artifact = AgentArtifact(
            run_id=run.id,
            kind=kind,
            content_ref=output_text[:8000],
        )
        self._session.add(artifact)
        await self._session.commit()
        await self._session.refresh(artifact)
        log.info(
            "mission_artifact_collected",
            run_id=str(run.id),
            kind=kind,
            bytes=len(output_text[:8000]),
        )
        return artifact

    async def collect_completed_artifacts(self, mission_id: uuid.UUID) -> int:
        """Lazily collect each completed Worker's output as Artifacts.

        v1: summary only（``output_redacted`` → ``kind=summary``）。
        task-04（D-005@v2）：write worker 有 ``diff_summary`` 时额外采
        ``kind=patch`` artifact，供 Finalizer 合并 / 人审 apply-back。
        per-worker worktree 隔离 + git merge 留 task-04b。

        Idempotent — Workers already having any Artifact are skipped. This is the
        Artifact 回灌 hook (Wave 3 gap #1): workers produce structured output on
        the daemon; their final summary lands in ``AgentRun.output_redacted`` via
        the lease-complete callback, and this method persists it as an
        ``AgentArtifact`` so the Coordinator / UI can consume it without touching
        raw logs.
        """
        stmt = select(AgentRun).where(
            col(AgentRun.mission_id) == mission_id,
            AgentRun.status == "completed",
        )
        collected = 0
        for run in (await self._session.execute(stmt)).scalars().all():
            has = (
                (
                    await self._session.execute(
                        select(AgentArtifact).where(AgentArtifact.run_id == run.id).limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if has:
                continue
            await self.collect_artifact(run, run.output_redacted or "(无产出)", kind="summary")
            collected += 1
            # task-04 D-005@v2：write worker diff 采集为 patch artifact（供人审 apply-back）
            if run.diff_summary:
                await self.collect_artifact(run, run.diff_summary, kind="patch")
                collected += 1
        if collected:
            log.info("mission_artifacts_reaped", mission_id=str(mission_id), n=collected)
        return collected
