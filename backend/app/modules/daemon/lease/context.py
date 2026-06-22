"""Lease claim payload builder — execution context construction for a claimed lease.

原 DaemonService._build_claim_payload（service.py:369，~123 行），task-06 迁为模块级
函数 ``build_claim_payload(session, lease)``。行为零变更：interactive 分支提前 return；
batch 分支 agent_run_id NULL 校验（DaemonLeaseNoAgentRun）、AgentRun 字段提取、
workspace_id、lease metadata 透传（prompt/provider/model/repo_url/branch/tool_config/
workspace_*/root_path 等）、runtime capabilities（cmd_path/protocol）。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace

log = get_logger(__name__)


def _raise_no_agent_run(lease: DaemonTaskLease) -> None:
    """Raise DaemonLeaseNoAgentRun（task-07 迁入 lease/service.py 定义）。

    函数级 lazy import 避免与 ``lease.service`` 的循环依赖
    （``service.py`` 顶部 import ``build_claim_payload``，本模块需反向引用
    service 定义的异常类）。同款模式见 facade ``__init__`` 与 router.py:624
    （design §7.2 / D-005@v1）。
    """
    from app.modules.daemon.lease.service import DaemonLeaseNoAgentRun

    raise DaemonLeaseNoAgentRun(
        f"Batch lease '{lease.id}' has no agent_run_id (kind={lease.kind}).",
        details={"lease_id": str(lease.id), "kind": lease.kind},
    )


async def build_claim_payload(session: AsyncSession, lease: DaemonTaskLease) -> dict:
    """Build execution context payload for a claimed lease.

    ``session`` 替代原 ``self._session``（task-06 结构迁移），其余逻辑逐字搬入。
    """
    lease_meta = dict(lease.metadata_ or {})
    payload: dict = {
        "lease_id": str(lease.id),
        "agent_run_id": None,
        "workspace_id": None,
        "session_id": None,
        "tool_config": {},
        # gap-5（补丁遗漏）：claim payload 必须带 lease.kind，否则 daemon
        # execPayload.kind 为 undefined → 走 batch task_runner（422）。
        "kind": lease.kind,
    }
    # gap-5：interactive lease agent_run_id=NULL（D-005），不走 agent_run 提取分支，
    # 从 lease metadata 取首 turn 参数（prepare_interactive_dispatch 写入），
    # 供 daemon _startInteractiveSession 构造 SessionManager.create 输入。
    if lease.kind == "interactive":
        payload["agent_session_id"] = lease_meta.get("session_id")
        # daemon execPayload.agentRunId 读 snake_case `agent_run_id`（不是 run_id），
        # 把 metadata.run_id 同时映射到 agent_run_id，否则 daemon has_run_id=false
        payload["agent_run_id"] = lease_meta.get("run_id")
        payload["run_id"] = lease_meta.get("run_id")
        payload["prompt"] = lease_meta.get("prompt")
        payload["provider"] = lease_meta.get("provider")
        payload["model"] = lease_meta.get("model")
        payload["root_path"] = lease_meta.get("cwd") or lease_meta.get("root_path")
        # scan 真阻塞：透传 manual_approval / ask_user_only（prepare_scan_interactive_dispatch
        # 写入 lease metadata）→ daemon execPayload 归一化 → SessionManager.create input：
        #   - manual_approval 决定是否注入 canUseTool（per-session，chat=false 不注入）
        #   - ask_user_only=true 时只 AskUserQuestion 走人审、Bash 等放行让 scan 自动跑。
        # **修复 Bug**：原 interactive 分支漏传这两个字段 → askUserOnly=undefined → gate
        # 不触发 → 所有工具（含 sillyspec 的 Bash）都走人审 → 5min 超时死循环。
        if lease_meta.get("manual_approval") is not None:
            payload["manual_approval"] = lease_meta["manual_approval"]
        if lease_meta.get("ask_user_only") is not None:
            payload["ask_user_only"] = lease_meta["ask_user_only"]
        return payload

    if lease.agent_run_id is None:
        # ql-004：batch lease（interactive 已在上方 return）agent_run_id 不应为
        # NULL。静默返回 agent_run_id=None 的 payload 会让 daemon 发空
        # agent_run_id → backend 422 风暴 → 连接池耗尽。fail-fast 抛错暴露。
        _raise_no_agent_run(lease)

    agent_run = await session.get(AgentRun, lease.agent_run_id)
    if agent_run is None:
        log.warning(
            "daemon_claim_agent_run_missing",
            lease_id=str(lease.id),
            agent_run_id=str(lease.agent_run_id),
        )
        return payload

    # Get workspace_id from M:N association
    ws_stmt = (
        select(AgentRunWorkspace.workspace_id)
        .where(
            col(AgentRunWorkspace.agent_run_id) == agent_run.id,
        )
        .limit(1)
    )
    ws_row = (await session.execute(ws_stmt)).first()
    workspace_id = ws_row[0] if ws_row else None

    payload["agent_run_id"] = str(agent_run.id)
    payload["workspace_id"] = str(workspace_id) if workspace_id else None
    payload["session_id"] = agent_run.session_id
    payload["agent_type"] = agent_run.agent_type
    if agent_run.provider:
        payload["provider"] = agent_run.provider
    if agent_run.model:
        payload["model"] = agent_run.model
    payload["change_id"] = str(agent_run.change_id) if agent_run.change_id else None
    payload["task_id"] = str(agent_run.task_id) if agent_run.task_id else None

    # Propagate prompt from lease metadata (quick-chat scenario)
    lease_meta = lease.metadata_ or {}
    if lease_meta.get("prompt"):
        payload["prompt"] = lease_meta["prompt"]
    # ql-20260618-009：AgentRun 是 source of truth（持久化快照），
    # lease_meta 仅在 AgentRun 字段为空时兜底（如旧测试场景）。
    # 不再用 lease_meta 覆盖 AgentRun 已固化的值——避免重 dispatch 时 transport
    # 与快照不一致导致 daemon 拿到错的 provider/model。
    if not agent_run.provider and lease_meta.get("provider"):
        payload["provider"] = lease_meta["provider"]
    if not agent_run.model and lease_meta.get("model"):
        payload["model"] = lease_meta["model"]
    if lease_meta.get("resume_session_id"):
        payload["resume_session_id"] = lease_meta["resume_session_id"]
    # Propagate bundle context fields from lease metadata (task-03 / Phase 2).
    if lease_meta.get("repo_url"):
        payload["repo_url"] = lease_meta["repo_url"]
    if lease_meta.get("branch"):
        payload["branch"] = lease_meta["branch"]
    if lease_meta.get("allowed_paths"):
        payload["allowed_paths"] = lease_meta["allowed_paths"]
    if lease_meta.get("tool_config"):
        payload["tool_config"] = lease_meta["tool_config"]  # 覆盖默认 {}
    if lease_meta.get("timeout_seconds") is not None:
        payload["timeout_seconds"] = lease_meta["timeout_seconds"]
    # ql-20260617-009：workspace 标识 + root_path 透传给 daemon（camelCase + snake_case 双写，
    # 对齐 daemon.ts:662-665 兜底链；root_path 用于 daemon 直接当 cwd，跳过 mirror）。
    if lease_meta.get("workspace_name"):
        payload["workspaceName"] = lease_meta["workspace_name"]
        payload["workspace_name"] = lease_meta["workspace_name"]
    if lease_meta.get("workspace_slug"):
        payload["workspaceSlug"] = lease_meta["workspace_slug"]
        payload["workspace_slug"] = lease_meta["workspace_slug"]
    if lease_meta.get("root_path"):
        payload["rootPath"] = lease_meta["root_path"]
        payload["root_path"] = lease_meta["root_path"]

    # Include runtime capabilities (cmd_path, bin_path, protocol)
    runtime = await session.get(DaemonRuntime, lease.runtime_id)
    if runtime is not None and runtime.capabilities:
        caps = runtime.capabilities if isinstance(runtime.capabilities, dict) else {}
        payload["cmd_path"] = caps.get("bin_path", "")
        payload["protocol"] = caps.get("protocol", "")

    return payload
