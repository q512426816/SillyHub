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

NOTE (task-08, 2026-08-06-public-mcp-server, spike-B 实测修正): the earlier note
here claimed the daemon "does NOT apply" ``tool_config`` and that v1 tool
governance was "不强制". That is **outdated** — spike-B
(``spikes/read_only-allowedtools-spike.md``) traced the full chain and confirmed it
is **live end-to-end**:

``worker_tool_config(read_only)`` (below) → ``dispatch_to_daemon(tool_config=...)``
→ lease ``metadata.tool_config`` (``placement.py:408``) → daemon reads it back
(``daemon.ts:3641`` ``execCtx.tool_config``, fetch-first) → ``stream-json.ts:333``
maps ``allowed_tools`` to ``--allowedTools`` and ``:322`` maps ``mode`` to
``--permission-mode``. A read-only Worker therefore really runs as
``--permission-mode plan --allowedTools Read,Glob,Grep`` and is physically refused
write tools (Edit/Write/Bash are not whitelisted). ``metadata.tool_config`` (tool
governance) is a separate key from ``provider_config`` (credential rendering,
``daemon.ts:3044``) — no ambiguity.

The whitelist below is therefore NOT a forward-compatibility hint; it is the
enforced per-Worker tool policy.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentArtifact, AgentRun
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.daemon.host_fs.delegate import HostFsDelegate
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

log = get_logger(__name__)


async def mark_worker_run_failed(
    session: AsyncSession,
    run: AgentRun,
    *,
    error_code: str,
    message: str,
) -> None:
    """统一收敛 worker dispatch 失败（诊断 36b9b475：worker 1c6b126f failed 但
    error_code / finished_at / output_redacted 全空，无法诊断 + mission 永不收敛）。

    对齐 ``service.py:531 _mark_no_online_daemon`` 语义：status=failed + error_code
    + output_redacted + finished_at。failed 是终态（``derive_status`` 算入收敛），
    前端 / 日志可读 error_code 诊断原因。三处调用方（mcp_tools / router / bootstrap）
    的 except 兜底也复用本函数，杜绝静默 failed。

    error_code 取值：
    - ``worktree_create_failed``：per-worker worktree 建不起来（daemon 离线 / RPC
      失败 / git 错），worker 没拿到独立副本 cwd。
    - ``no_online_daemon``：dispatch_to_daemon 抛 NoOnlineDaemonError 或返回 None
      （runtime 派发瞬间离线的 race）。
    - ``dispatch_exception``：调用方兜底未预期异常（execution 内部已处理上述两类）。
    """
    run.status = "failed"
    run.error_code = error_code
    run.output_redacted = message
    run.finished_at = datetime.now(UTC)
    session.add(run)
    await session.commit()


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
        # task-02（2026-08-08-dispatch-worker-caller-worktree / 路径A，D-001@v1 /
        # D-008@v1 / D-009@v1）：caller（SillySpec execute）提供自己的 worktree 时
        # 三参齐传；默认 None → 走原 team 模式自建 worktree 逻辑（零回归，design §9）。
        worktree_path: str | None = None,
        branch: str | None = None,
        worker_prompt: str | None = None,
    ) -> uuid.UUID | None:
        """Dispatch a pending mission Worker Run to a daemon.

        Returns the daemon lease id (or None if the runtime went offline, or
        if a per-worker worktree could not be created — design §9 兼容策略：
        worktree 创建失败标 run failed + return None，不抛，主 agent 决策补派）。
        Raises if the Run is not pending.

        task-02 路径A optional params（默认 None 零回归，design §7.2）：
        - ``worktree_path``：caller worktree 绝对路径，非空 → 跳过自建、直接作
          daemon root_path / worker cwd。⚠️ 路径A **不写** ``run.worktree_branch``
          （D-008 双保险：该列是 team converge finalize merge 触发字段）。
        - ``branch``：caller worktree 分支（如 ``sillyspec/<change>``），仅作 lease
          metadata（dispatch_to_daemon ``branch=``）记录，**不落 AgentRun 列**。
        - ``worker_prompt``：caller 覆写 worker prompt（含"不 commit / 不越界"指令），
          非 None → 完全替代 ``render_worker_prompt``（D-001 方案A）。
        """
        if run.status != "pending":
            raise ValueError(f"dispatch_worker requires pending Run, got {run.status!r}")

        ws = await self._session.get(Workspace, workspace_id)
        repo_url = ws.repo_url if ws else None
        # task-02（D-009@v1）：caller（路径A）提供 branch 则用其 worktree 分支
        # （作 lease metadata 透传 dispatch_to_daemon，对齐跨仓契约字段名）；
        # None → 回退 workspace.default_branch（原 team 模式逻辑，零回归）。
        # ⚠️ branch 入参只进 lease metadata，**绝不赋给 run.worktree_branch 列**
        # （D-008 红线，下方自建分支才会写该列，路径A 不进入自建）。
        if branch is None:
            branch = ws.default_branch if ws else None
        # 2026-06-29：Worker lease 透传 root_path（resolve_root_path_for_daemon
        # 容器→宿主机改写），让 daemon prepareWorkspace 在项目根执行（非空 mirror）。
        # D-007@2026-07-10：resolve_root_path_for_daemon 单参（path_source 列删除）。
        root_path = resolve_root_path_for_daemon(ws.root_path) if ws and ws.root_path else None
        # task-02（路径A / D-001@v1 / D-008@v1）：caller 提供自己的 worktree → 直接
        # 作 daemon root_path / worker cwd（caller worktree 已是宿主路径，无需容器→
        # 宿主改写），并短路下方 git_worktree_add 自建（condition 追加
        # ``and not worktree_path``）。⚠️ 路径A 绝不写 run.worktree_branch（D-008，保持 None）。
        if worktree_path:
            root_path = worktree_path
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
        if (
            self._host_fs_delegate is not None
            and ws is not None
            and root_path
            and not worktree_path
        ):
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
                # 诊断 36b9b475：补全 error_code/finished_at/output_redacted（原只标
                # failed 致 worker 1c6b126f 无原因不可诊断），统一走 mark_worker_run_failed。
                wt_error = wt_result.get("error") if isinstance(wt_result, dict) else "unknown"
                log.warning(
                    "mission_worker_worktree_add_failed",
                    run_id=str(run.id),
                    workspace_id=str(workspace_id),
                    sibling_path=sibling_path,
                    error=wt_error,
                )
                await mark_worker_run_failed(
                    self._session,
                    run,
                    error_code="worktree_create_failed",
                    message=f"per-worker worktree 创建失败：{wt_error}",
                )
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

        # task-02（D-001@v1 方案A）：caller 全权覆写 worker prompt（含"不 commit /
        # 不越界 allowedPaths"指令）；不传 → 原 render_worker_prompt（含 commit 协作
        # 约束，team 模式不变）。design §7.4 逐字。
        prompt = worker_prompt if worker_prompt is not None else render_worker_prompt(run)
        try:
            lease_id = await self._placement.dispatch_to_daemon(
                run.id,
                user_id,
                workspace_id=workspace_id,
                provider=provider,
                model=model,
                prompt=prompt,
                repo_url=repo_url,
                branch=branch,
                stage=run.role or "mission_worker",
                read_only=read_only,
                tool_config=worker_tool_config(read_only),
                root_path=root_path,
            )
        except NoOnlineDaemonError as exc:
            # 诊断 36b9b475：execution 内部统一收敛，不冒泡调用方（原冒泡致
            # mcp_tools 设 pending / router / bootstrap 吞异常，failed 不可诊断）。
            await mark_worker_run_failed(
                self._session, run, error_code="no_online_daemon", message=exc.message
            )
            return None
        if lease_id is None:
            # race：runtime 在 resolve 后、claim 前离线（service.py:518 同款兜底）。
            await mark_worker_run_failed(
                self._session,
                run,
                error_code="no_online_daemon",
                message="runtime 在派发瞬间离线，dispatch 返回 None",
            )
            return None
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
        runs = (await self._session.execute(stmt)).scalars().all()
        collected = 0
        if not runs:
            return collected
        # 第六批：批量取已存在 artifact 的 run_id 集（原逐 run SELECT limit(1) → N+1）。
        # 语义等价：任一 artifact 存在即跳过该 run（collect_artifact 本身幂等，R5 已
        # 接受并发重复 collect 无害，TOCTOU 窗口未引入新故障类别）。
        run_ids = [run.id for run in runs]
        existing_run_ids = set(
            (
                await self._session.execute(
                    select(AgentArtifact.run_id).where(AgentArtifact.run_id.in_(run_ids))
                )
            )
            .scalars()
            .all()
        )
        for run in runs:
            if run.id in existing_run_ids:
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
