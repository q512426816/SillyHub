"""HostFsDelegate implementation — see ``__init__.py`` for module overview.

Nine methods, all forwards over the daemon WS RPC
(:meth:`HostFsDelegate._via_rpc_or_degrade` / :meth:`HostFsDelegate._via_rpc`).
Change ``2026-07-10-remove-server-local-workspace-mode`` dropped the legacy
column the old server-local branch keyed on, so the delegate is now a pure
daemon-client RPC dispatcher.

Method names / parameters / return types are locked to design §5.1 — DO NOT
rename, add, or drop parameters (W2 task-06~08 + W3 task-09~13 consumers +
the cross-task contract table depend on them verbatim). **Exception**:
:meth:`HostFsDelegate.run_command` (9th method) is explicitly authorised by
change 2026-07-10-p3-driver-gate-pilot design §5.3 to break the §5.1 lock —
the P3 driver-gate pilot needs the backend to run ``sillyspec gate verify``
on the daemon side (where the source code / agent artefacts live, design §1
gate-constraint-①). ``run_command`` carries its own command whitelist safety
layer (R3) and goes fail-loud via :meth:`_via_rpc` (NOT
:meth:`_via_rpc_or_degrade`) — gate failure must surface, not degrade.

Cross-task contract:
    expects_from task-02:
        - contract: HostFsWsRpc
          needs: [send_rpc]
    Only ``send_rpc`` is consumed here; the real transport (request/response
    matching, timeout, reconnect) is task-02's responsibility. ``send_rpc``
    carries an optional ``timeout`` kwarg (M5, run_command forwards the gate
    12-min budget); existing 8 methods leave ``timeout=None`` to keep the
    default 30s transport budget and stay compatible with mocks whose
    ``send_rpc`` signature has no ``timeout`` parameter.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from hashlib import sha256
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.service import (
    DaemonRpcConflict,
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.workspace.member_runtimes.queries import (
    resolve_daemon_instance_for_workspace,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.modules.workspace.model import Workspace

log = get_logger(__name__)


# daemon_id resolver signature — workspace-scoped（无 user_id，host-fs 委托路径是
# daemon 上报回调无天然 actor）。返回 daemon_instances.id（WS 路由键）或 None。
# 可注入以便单测绕过 DB（session=None）；默认绑定 queries.resolve_daemon_instance_for_workspace。
_DaemonIdResolver = Callable[["AsyncSession", uuid.UUID], Awaitable["uuid.UUID | None"]]


# RPC failure exceptions that trigger D-006 warn-and-degrade for daemon-client
# workspaces. Tuple so every ``_via_rpc`` call site can ``except _RPC_DEGRADED_EXC``
# in one go. ``HostFsDelegateUnavailable`` (ws_rpc not wired / no bound daemon) is
# intentionally NOT in this tuple — that's a wiring bug, not a transient transport
# failure, and the existing tests assert it raises (task-01 contract).
_RPC_DEGRADED_EXC = (
    DaemonRuntimeOffline,
    DaemonRpcTimeout,
    DaemonRpcRemoteError,
    DaemonRpcConflict,
)


# ── Domain errors (N818 — event-style, mirrors DaemonOffline / PatchConflictError) ──


class HostFsDelegateError(AppError):
    """Generic HostFsDelegate failure.

    Raised when a host-filesystem RPC dispatch fails for reasons other than
    git-apply conflicts (which surface via the ``ok=False`` return of
    :meth:`HostFsDelegate.git_apply`) — e.g. a command-whitelist violation in
    :meth:`HostFsDelegate.run_command`.
    """

    code = "HOST_FS_DELEGATE_ERROR"
    http_status = 500


class HostFsDelegateUnavailable(AppError):
    """The delegate cannot serve a daemon-client request right now.

    Raised when ``ws_rpc`` has not been wired (task-02 pending) or the bound
    daemon has no active WS connection. Callers should degrade gracefully
    (warn + failure-log fallback, D-006).
    """

    code = "HOST_FS_DELEGATE_UNAVAILABLE"
    http_status = 503


# ── ws_rpc protocol (task-02 contract — only send_rpc consumed) ─────────────────────


@runtime_checkable
class _WsRpcLike(Protocol):
    """Structural contract task-02's HostFsWsRpc must satisfy.

    Only ``send_rpc`` is consumed here; ``rpc_id`` is task-02.provides for
    correlation and is not invoked from this module.

    ``timeout`` (M5, P3-driver-gate-pilot design §5.3) is an optional per-call
    transport budget. ``run_command`` forwards the gate 12-min ceiling; the
    other 8 methods leave it ``None`` so the default 30s transport budget
    applies. To stay backwards-compatible with existing mocks (whose
    ``send_rpc`` signature predates this kwarg), :meth:`_via_rpc` only forwards
    ``timeout`` when it is not ``None`` — so a ``send_rpc`` without the
    ``timeout`` parameter still satisfies the 8-method call path. task-02's
    real :class:`HostFsWsRpc` MUST accept ``timeout`` to serve ``run_command``.
    """

    async def send_rpc(
        self,
        *,
        method: str,
        workspace_id: str,
        daemon_id: str,
        args: dict[str, Any],
        timeout: float | None = None,
    ) -> dict[str, Any]:  # pragma: no cover — protocol body
        ...


# ── HostFsDelegate ──────────────────────────────────────────────────────────────────


class HostFsDelegate:
    """Single entry point for backend to touch host filesystem paths.

    Construct with the active DB session and (optionally) a wired WS RPC
    client. Every public method forwards the operation over the daemon WS RPC
    (daemon-client only — the legacy server-local branch was removed in change
    ``2026-07-10-remove-server-local-workspace-mode`` task-01).

    The nine public methods are the cross-task contract surface — see design
    §5.1 (8 read/write methods) + design §5.3 (``run_command``, the 9th,
    authorised P3-driver-gate-pilot break of the §5.1 lock). Renaming or
    re-parameterising them breaks W2/W3 consumers.
    """

    # D-006 degraded return for git_apply when the RPC channel is unavailable
    # (timeout / offline / remote error / conflict). Mirrors the daemon handler
    # success shape so consumers (lease complete_lease, task-06) keep the same
    # field contract; ``ok:False`` lets the caller decide whether to escalate.
    _DEGRADED_GIT_APPLY: dict[str, Any] = {
        "ok": False,
        "conflict_detail": "rpc unavailable",
        "skipped": False,
    }

    def __init__(
        self,
        session: AsyncSession,
        ws_hub: Any = None,
        ws_rpc: _WsRpcLike | None = None,
        daemon_id_resolver: _DaemonIdResolver | None = None,
    ) -> None:
        """Hold references needed by the daemon-client RPC dispatch.

        Args:
            session: Active async DB session. Consumers that already hold a
                ``Workspace`` object pass it directly to the methods; the
                session is retained for stage_callback / post-scan scenarios
                that need to re-query workspace state, and for the
                daemon-instance resolution in ``_via_rpc``.
            ws_hub: Process-wide :class:`DaemonWsHub` singleton (kept for
                future direct use; task-02's HostFsWsRpc wraps it). Accept
                ``None`` for unit tests that inject a mock ``ws_rpc``.
            ws_rpc: Optional :class:`HostFsWsRpc` instance (task-02). When
                ``None``, daemon-client requests raise
                :class:`HostFsDelegateUnavailable`. Inject a mock in tests to
                verify call structure without a real transport.
            daemon_id_resolver: Optional callable mapping
                ``(session, workspace_id) → daemon_instances.id | None``.
                Defaults to
                :func:`resolve_daemon_instance_for_workspace` (queries.py) —
                the WS routing key is the daemon **instance** id. Inject a
                fake in unit tests (``session=None``) to avoid DB access; the
                integration test exercises the real resolver against a real
                ``DaemonWsHub``.
        """
        self._session = session
        self._ws_hub = ws_hub
        self._ws_rpc = ws_rpc
        self._daemon_id_resolver: _DaemonIdResolver = (
            daemon_id_resolver or resolve_daemon_instance_for_workspace
        )
        # D-008 first line of defence: in-process patch_id (sha256 of patch
        # bytes) dedupe keyed by agent_run_id. complete_lease retries land in
        # the same process within a single run, so this cache short-circuits a
        # replayed patch without round-tripping the daemon. Cross-process /
        # cross-restart dedupe is the daemon handler's ``git apply --check``
        # (task-03 D-008 second line of defence). Kept instance-level so a
        # fresh HostFsDelegate per complete_lease doesn't accumulate state
        # across unrelated runs (process-wide dict would also be fine for the
        # short-circuit goal, but instance-level is easier to reason about).
        self._applied_patch_ids: dict[str, set[str]] = {}

    # ------------------------------------------------------------------
    # stat
    # ------------------------------------------------------------------
    async def stat(self, workspace: Workspace, path: str) -> dict:
        """Return ``{exists, is_dir, size}`` for *path* under workspace root.

        daemon-client: forward ``host_fs.stat`` over WS RPC (D-006 degrade on
        transport failure).
        """
        return await self._via_rpc_or_degrade(
            method="stat",
            workspace=workspace,
            args={"path": path},
            degraded={"exists": False, "is_dir": False, "size": 0},
        )

    # ------------------------------------------------------------------
    # read_file
    # ------------------------------------------------------------------
    async def read_file(self, workspace: Workspace, path: str) -> str:
        """Read *path* under workspace root as UTF-8 text.

        daemon-client: forward ``host_fs.read_file`` over WS RPC (D-006 degrade
        to empty string on transport failure).
        """
        result = await self._via_rpc_or_degrade(
            method="read_file",
            workspace=workspace,
            args={"path": path},
            degraded={"content": ""},
        )
        return str(result.get("content", "")) if isinstance(result, dict) else ""

    # ------------------------------------------------------------------
    # list_dir
    # ------------------------------------------------------------------
    async def list_dir(self, workspace: Workspace, path: str) -> list[str]:
        """List immediate children of *path* (names, not full paths).

        daemon-client: forward ``host_fs.list_dir`` over WS RPC (D-006 degrade
        to empty list on transport failure).
        """
        result = await self._via_rpc_or_degrade(
            method="list_dir",
            workspace=workspace,
            args={"path": path},
            degraded={"entries": []},
        )
        entries = result.get("entries", []) if isinstance(result, dict) else []
        return list(entries) if isinstance(entries, list) else []

    # ------------------------------------------------------------------
    # git_apply
    # ------------------------------------------------------------------
    async def git_apply(
        self,
        workspace: Workspace,
        patch_data: str,
        use_3way: bool,
        agent_run_id: str | None = None,
    ) -> dict:
        """Apply a unified diff to the workspace, returning ``{ok, conflict_detail, skipped, patch_id?}``.

        daemon-client: forward ``host_fs.git_apply`` over WS RPC (the daemon
        owns the worktree and applies locally; D-002). The daemon handler
        runs ``git apply --check`` preflight and ``--3way`` fallback when
        *use_3way* is True. ``ok=False`` (degrade or daemon-side conflict)
        carries the reason in ``conflict_detail``.

        D-008 idempotence (first line of defence, backend side): when
        *agent_run_id* is provided, a sha256 content-hash of *patch_data* is
        memoised per agent_run_id. A replayed patch returns
        ``{ok: True, skipped: True, patch_id: ...}`` WITHOUT a round trip to
        the daemon. *agent_run_id* defaults to ``None`` (task-01 back-compat)
        which disables dedupe and falls through to the daemon handler's
        ``git apply --check`` second line of defence.
        """
        patch_id = sha256(patch_data.encode("utf-8")).hexdigest()

        # D-008 backend dedupe (only when an agent_run_id scope is supplied —
        # None preserves task-01 behaviour and lets the daemon --check guard
        # own idempotency).
        if agent_run_id is not None:
            applied = self._applied_patch_ids.setdefault(agent_run_id, set())
            if patch_id in applied:
                log.info(
                    "host_fs_git_apply_skipped_dedupe",
                    agent_run_id=agent_run_id,
                    patch_id=patch_id,
                )
                return {
                    "ok": True,
                    "conflict_detail": None,
                    "skipped": True,
                    "patch_id": patch_id,
                }

        result = await self._via_rpc_or_degrade(
            method="git_apply",
            workspace=workspace,
            args={
                "workdir": workspace.root_path,
                "patch_data": patch_data,
                "use_3way": use_3way,
            },
            degraded=self._DEGRADED_GIT_APPLY,
        )
        # Memoise only on a successful apply so a transient RPC failure
        # (degraded return) does not poison the cache against a legitimate
        # later retry.
        if (
            agent_run_id is not None
            and isinstance(result, dict)
            and result.get("ok") is True
            and not result.get("skipped")
        ):
            self._applied_patch_ids.setdefault(agent_run_id, set()).add(patch_id)
        return result

    # ------------------------------------------------------------------
    # git_rev_parse
    # ------------------------------------------------------------------
    async def git_rev_parse(self, workspace: Workspace, ref: str) -> str | None:
        """Resolve *ref* to a commit hash under workspace root, or ``None``.

        daemon-client: forward ``host_fs.git_rev_parse`` over WS RPC. Returns
        ``None`` when not a git repo / git missing / timeout (downgraded from
        warning to silent ``None`` at this layer; consumers decide whether to
        warn).
        """
        result = await self._via_rpc_or_degrade(
            method="git_rev_parse",
            workspace=workspace,
            args={"root": workspace.root_path, "ref": ref},
            degraded={"commit": None},
        )
        commit = result.get("commit") if isinstance(result, dict) else None
        return str(commit) if commit else None

    # ------------------------------------------------------------------
    # git_worktree_add（change 2026-07-12-worker-worktree-isolation task-01）
    # ------------------------------------------------------------------
    async def git_worktree_add(
        self,
        workspace: Workspace,
        *,
        sibling_path: str,
        branch: str,
        base_ref: str,
    ) -> dict:
        """Add a git worktree at *sibling_path* on *branch* (based off *base_ref*).

        daemon 侧跑 ``git -C <root> worktree add <sibling_path> -b <branch> <base_ref>``
        （D-001@v1 per-worker sibling worktree；D-008@v1 daemon 给副本配默认 git
        identity）。``dispatch_worker`` 用此为每个 worker 创建独立副本路径作
        ``root_path`` 传 ``dispatch_to_daemon``。

        daemon-client: forward ``host_fs.git_worktree_add`` over WS RPC（仿
        :meth:`git_apply` 走 :meth:`_via_rpc_or_degrade`，D-006 warn-and-degrade
        on transport failure）。返回 ``{ok, worktree_path, error}``；degraded
        时 ``{ok: False, worktree_path: None, error: "rpc unavailable"}``。
        """
        return await self._via_rpc_or_degrade(
            method="git_worktree_add",
            workspace=workspace,
            args={
                "workdir": workspace.root_path,
                "sibling_path": sibling_path,
                "branch": branch,
                "base_ref": base_ref,
            },
            degraded={"ok": False, "worktree_path": None, "error": "rpc unavailable"},
        )

    # ------------------------------------------------------------------
    # git_merge（change 2026-07-12-worker-worktree-isolation task-01）
    # ------------------------------------------------------------------
    async def git_merge(
        self,
        workspace: Workspace,
        *,
        worker_branch: str,
    ) -> dict:
        """Merge *worker_branch* into workspace root 当前 HEAD.

        daemon 侧跑 ``git -C <root> merge --no-ff <worker_branch>``（D-003@v1
        方案A：worker commit + git merge）。``finalize_execute_mission`` 在
        ``converge_mission`` 重入循环里逐个合并 worker 分支。``ok=False`` +
        ``conflicts`` 非空 → 有冲突标记，finalizer 喂主 agent LLM 解冲突
        （D-004@v1）后重入继续。

        daemon-client: forward ``host_fs.git_merge`` over WS RPC（仿
        :meth:`git_apply` 走 :meth:`_via_rpc_or_degrade`）。返回
        ``{ok, conflicts, merged_files, error}``；degraded 时三字段均为空容器
        （caller 视作失败但结构完整，不崩）。
        """
        return await self._via_rpc_or_degrade(
            method="git_merge",
            workspace=workspace,
            args={
                "workdir": workspace.root_path,
                "worker_branch": worker_branch,
            },
            degraded={
                "ok": False,
                "conflicts": [],
                "merged_files": [],
                "error": "rpc unavailable",
            },
        )

    # ------------------------------------------------------------------
    # git_worktree_remove（change 2026-07-12-worker-worktree-isolation task-01）
    # ------------------------------------------------------------------
    async def git_worktree_remove(
        self,
        workspace: Workspace,
        *,
        sibling_path: str,
    ) -> dict:
        """Remove the worktree at *sibling_path*.

        daemon 侧跑 ``git -C <root> worktree remove --force <sibling_path>``
        （D-006@v1 轻量路径，合并成功后清理 worker 副本；merge 失败回退时副本
        保留供人工排查，见 design §9）。caller 负责仅在成功路径调用。

        daemon-client: forward ``host_fs.git_worktree_remove`` over WS RPC（仿
        :meth:`git_apply` 走 :meth:`_via_rpc_or_degrade`）。返回
        ``{ok, error}``；degraded 时 ``{ok: False, error: "rpc unavailable"}``。
        """
        return await self._via_rpc_or_degrade(
            method="git_worktree_remove",
            workspace=workspace,
            args={
                "workdir": workspace.root_path,
                "sibling_path": sibling_path,
            },
            degraded={"ok": False, "error": "rpc unavailable"},
        )

    # ------------------------------------------------------------------
    # pollution_archive
    # ------------------------------------------------------------------
    async def pollution_archive(
        self,
        workspace: Workspace,
        source_root: str,
    ) -> dict:
        """Archive ``source_root/.sillyspec/`` pollution, returning ``{archived, detail}``.

        daemon-client: forward ``host_fs.pollution_archive`` over WS RPC.
        Design §5.1 collapses the auxiliary archive_path / file_count into
        ``detail`` so the abstract surface is stable (task-09 consumer
        unpacks ``detail`` if it needs archive_path for the warning).
        """
        return await self._via_rpc_or_degrade(
            method="pollution_archive",
            workspace=workspace,
            args={"source_root": source_root},
            degraded={"archived": False, "detail": "rpc unavailable"},
        )

    # ------------------------------------------------------------------
    # read_package_json
    # ------------------------------------------------------------------
    async def read_package_json(self, workspace: Workspace) -> dict | None:
        """Read ``workspace_root/package.json`` as a dict, or ``None`` if absent.

        daemon-client: forward ``host_fs.read_package_json`` over WS RPC.
        """
        result = await self._via_rpc_or_degrade(
            method="read_package_json",
            workspace=workspace,
            args={"root": workspace.root_path},
            degraded={"data": None},
        )
        if not isinstance(result, dict):
            return None
        data = result.get("data")
        return data if isinstance(data, dict) or data is None else None

    # ------------------------------------------------------------------
    # read_local_yaml
    # ------------------------------------------------------------------
    async def read_local_yaml(self, workspace: Workspace) -> dict | None:
        """Read ``workspace_root/.sillyspec/local.yaml`` as a dict, or ``None``.

        daemon-client: forward ``host_fs.read_local_yaml`` over WS RPC.
        """
        result = await self._via_rpc_or_degrade(
            method="read_local_yaml",
            workspace=workspace,
            args={"root": workspace.root_path},
            degraded={"data": None},
        )
        if not isinstance(result, dict):
            return None
        data = result.get("data")
        return data if isinstance(data, dict) or data is None else None

    # ------------------------------------------------------------------
    # run_command（第 9 方法 — design §5.3 授权破 §5.1 锁死契约）
    # ------------------------------------------------------------------

    #: 允许在 ``args`` 头部之后追加的 flag 集合（design §5.3：stage 枚举 +
    #: changeName 之外的已知 flag）。新增 gate 模板参数需在此白名单登记，
    #: 否则 run_command 拒绝执行——防任意命令注入（R3）。
    #: ``--spec-dir``（task-03 gate-cwd-specdir-fix）：值校验防路径遍历（见 while 循环）。
    _GATE_VERIFY_TAIL_FLAG_WHITELIST: frozenset[str] = frozenset({"--stage", "--spec-dir"})

    #: gate verify 模板头部（command 之后）的固定长度前缀：
    #: ``["gate", "verify", "--change", <changeName>, "--json"]``。changeName
    #: 占位允许任意非空字符串（gate 任务已对 change_id 做来源校验），但
    #: 模板结构必须精确匹配——少 flag / 换子命令 / 缺 --json 都拒。
    _GATE_VERIFY_PREFIX_LEN = 5

    async def run_command(
        self,
        workspace: Workspace,
        *,
        command: str,
        args: list[str],
        cwd: str,
        timeout: float,
        env: dict[str, str] | None = None,
    ) -> dict:
        """Run a whitelisted command on the daemon side, returning
        ``{exit_code, stdout, stderr, duration_ms}``.

        仅供 P3 driver-gate pilot（design §5.3）——gate 决策任务在 daemon
        侧跑 ``sillyspec gate verify --change <name> --json`` 客观核验 stage
        能否标记完成（exit 0 推进 / 1 打回 / 2 卡住报警）。破 §5.1 锁死契约，
        但带命令白名单安全层（R3）拒任意命令注入。

        **命令白名单（入口第一步校验）**：``command`` 必须为 ``"sillyspec"``，
        ``args`` 头部必须匹配
        ``["gate", "verify", "--change", <changeName>, "--json"]``，且尾部追加
        的 flag 必须在 :attr:`_GATE_VERIFY_TAIL_FLAG_WHITELIST` 内（当前仅
        ``--stage``）。违例 raise :class:`HostFsDelegateError`。

        daemon-client: 走 :meth:`_via_rpc`（**非** :meth:`_via_rpc_or_degrade`
        ——gate fail-loud，RPC 异常直接抛给 gate 任务，task-07 catch 后置
        ``gate_status=failed + exit 2``），``timeout`` 透传给
        ``rpc.send_rpc(timeout=timeout)``（M5，gate 12-min 预算）。

        Args:
            workspace: 目标工作区（取 ``id`` 路由 RPC）。
            command: 可执行名，当前白名单仅 ``"sillyspec"``。
            args: 命令参数序列，头部须匹配 gate verify 模板。
            cwd: 工作目录（daemon 侧执行路径，= workspace root）。
            timeout: 单次命令超时秒数（gate 传 720=12min）。
            env: 可选环境变量注入（如 SILLYSPEC_DEBUG）。

        Returns:
            ``{exit_code, stdout, stderr, duration_ms}`` —— daemon handler
            （task-02 / host-fs-handler.ts:run_command）原样产出，本方法透传。
        """
        self._enforce_command_whitelist(command=command, args=args)

        return await self._via_rpc(
            method="run_command",
            workspace=workspace,
            args={
                "command": command,
                "args": list(args),
                "cwd": cwd,
                "timeout": timeout,
                "env": env,
            },
            timeout=timeout,
        )

    def _enforce_command_whitelist(self, *, command: str, args: list[str]) -> None:
        """Gate-verify command whitelist（R3 安全层）。

        只允许 ``sillyspec gate verify --change <changeName> --json``（尾部
        可追加 :attr:`_GATE_VERIFY_TAIL_FLAG_WHITELIST` 内的 flag）。任何其他
        command / 子命令 / flag 组合 raise :class:`HostFsDelegateError`——这是
        run_command 拒任意命令注入的唯一防线（execFile 在 daemon handler，
        本层先于 RPC 拦截）。
        """
        if command != "sillyspec":
            raise HostFsDelegateError(
                "command not whitelisted (only 'sillyspec' gate verify allowed)",
                details={"command": command, "args": args},
            )

        if len(args) < self._GATE_VERIFY_PREFIX_LEN:
            raise HostFsDelegateError(
                "args too short for gate verify template "
                "(expected prefix [gate, verify, --change, <name>, --json])",
                details={"command": command, "args": args},
            )

        # 头部结构精确匹配：args[0..2] + args[4] 必须为固定 token，args[3] 为
        # 任意非空 changeName（gate 任务负责来源校验，白名单只守结构）。
        head = args[: self._GATE_VERIFY_PREFIX_LEN]
        if (
            head[0] != "gate"
            or head[1] != "verify"
            or head[2] != "--change"
            or head[4] != "--json"
            or not head[3]
        ):
            raise HostFsDelegateError(
                "args do not match gate verify template [gate, verify, --change, <name>, --json]",
                details={"command": command, "args": args},
            )

        # 尾部 flag 必须在白名单内（当前仅 --stage，且需带值，故成对消费）。
        tail = args[self._GATE_VERIFY_PREFIX_LEN :]
        i = 0
        while i < len(tail):
            flag = tail[i]
            if flag not in self._GATE_VERIFY_TAIL_FLAG_WHITELIST:
                raise HostFsDelegateError(
                    f"args tail flag not whitelisted: {flag}",
                    details={"command": command, "args": args, "flag": flag},
                )
            # 白名单 flag 需带值（--stage/--spec-dir <value>）——成对消费，无值则拒。
            if i + 1 >= len(tail):
                raise HostFsDelegateError(
                    f"args tail flag missing value: {flag}",
                    details={"command": command, "args": args, "flag": flag},
                )
            # --spec-dir 值校验（task-03 R3 防注入）：路径遍历防护——非空 + 不含 ".."。
            # backend 构造 args 时 spec_dir 受控（_resolve_gate_spec_root 返回的
            # SpecWorkspace.spec_root），本层兜底防恶意路径（../../etc/passwd）；
            # daemon handler assertWithinAllowedRoots 不覆盖 spec_dir（spec_dir 是
            # sillyspec 的 specBase 读 local.yaml，独立于 workspace 代码根）。
            if flag == "--spec-dir":
                value = tail[i + 1]
                if not value or ".." in value:
                    raise HostFsDelegateError(
                        f"--spec-dir value invalid (empty or path traversal): {value!r}",
                        details={"command": command, "args": args, "flag": flag, "value": value},
                    )
            i += 2

    # ------------------------------------------------------------------
    # RPC dispatch (daemon-client)
    # ------------------------------------------------------------------
    async def _via_rpc(
        self,
        *,
        method: str,
        workspace: Workspace,
        args: dict[str, Any],
        timeout: float | None = None,
    ) -> dict:
        """Forward a host_fs.* call over the daemon WS RPC.

        Uses task-02's :class:`HostFsWsRpc.send_rpc` — only ``send_rpc`` is
        consumed (contract-field-injection locked). When ``ws_rpc`` is ``None``
        (task-02 not wired), raise :class:`HostFsDelegateUnavailable`.

        The daemon_id (WS routing key) is resolved via
        :func:`resolve_daemon_instance_for_workspace` — the per-daemon WS
        ``_connections`` map is keyed by ``daemon_instances.id`` (router.py WS
        handshake). resolver 只查 member binding 的 ``daemon_id``（queries.py
        唯一来源）；无 binding 行即 genuinely unbound，raise 让 caller surface。

        ``timeout`` (M5, P3-driver-gate-pilot design §5.3)：可选的 per-call 传输
        预算。``run_command`` 转发 gate 12-min 上限；其他 8 方法保持 ``None``
        走默认 30s。关键：``timeout`` 为 ``None`` 时**不**透传给
        ``rpc.send_rpc``——这保证现有 8 方法 + 早期 mock（``send_rpc`` 签名无
        ``timeout`` 参数）零回归；非 ``None`` 时才 ``rpc.send_rpc(..., timeout=)``。
        """
        rpc = self._ws_rpc
        if rpc is None:
            raise HostFsDelegateUnavailable(
                "ws_rpc not wired (task-02 pending)",
                details={
                    "method": method,
                    "workspace_id": str(getattr(workspace, "id", "")),
                },
            )
        daemon_id = await self._daemon_id_resolver(self._session, workspace.id)
        if daemon_id is None:
            raise HostFsDelegateUnavailable(
                "workspace has no bound daemon instance (member binding resolves "
                "no daemon_instances.id)",
                details={
                    "method": method,
                    "workspace_id": str(getattr(workspace, "id", "")),
                },
            )
        # M5 向下兼容：timeout=None 时**不**传给 send_rpc——现有 8 方法 +
        # 早期 mock（send_rpc 无 timeout 参数）零回归；非 None 才透传。
        if timeout is None:
            return await rpc.send_rpc(
                method=method,
                workspace_id=str(workspace.id),
                daemon_id=str(daemon_id),
                args=args,
            )
        return await rpc.send_rpc(
            method=method,
            workspace_id=str(workspace.id),
            daemon_id=str(daemon_id),
            args=args,
            timeout=timeout,
        )

    async def _via_rpc_or_degrade(
        self,
        *,
        method: str,
        workspace: Workspace,
        args: dict[str, Any],
        degraded: dict[str, Any],
    ) -> dict[str, Any]:
        """Forward a host_fs.* RPC and degrade to *degraded* on transport failure.

        Wraps :meth:`_via_rpc` with the D-006 warn-and-degrade policy: any of
        ``DaemonRuntimeOffline`` / ``DaemonRpcTimeout`` / ``DaemonRpcRemoteError``
        / ``DaemonRpcConflict`` is logged at warning level and the caller
        receives *degraded* verbatim. The HostFsDelegate NEVER re-raises RPC
        transport failures, so :meth:`complete_lease` 's five cross-domain
        callbacks (lease/service.py:470-604) never trip over a host_fs call.

        Wiring errors (``HostFsDelegateUnavailable`` — ws_rpc None / no bound
        daemon) are NOT caught here: they signal a misconfiguration, not a
        transient transport fault, and task-01's tests assert they raise.

        The warn message reuses the ql-009 failure-log channel: no new log sink,
        and ``agent_run.status=="failed"`` (set by complete_lease when the run
        itself fails) still drives the AgentRunLog stderr + Redis SSE fallback.
        """
        try:
            return await self._via_rpc(method=method, workspace=workspace, args=args)
        except _RPC_DEGRADED_EXC as exc:
            log.warning(
                "host_fs_rpc_failed",
                method=method,
                workspace_id=str(getattr(workspace, "id", "")),
                error=type(exc).__name__,
            )
            return degraded
