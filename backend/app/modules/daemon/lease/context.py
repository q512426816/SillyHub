"""Lease claim payload builder — execution context construction for a claimed lease.

原 DaemonService._build_claim_payload（service.py:369，~123 行），task-06 迁为模块级
函数 ``build_claim_payload(session, lease)``。行为零变更：interactive 分支提前 return；
batch 分支 agent_run_id NULL 校验（DaemonLeaseNoAgentRun）、AgentRun 字段提取、
workspace_id、lease metadata 透传（prompt/provider/model/repo_url/branch/tool_config/
workspace_*/root_path 等）、runtime capabilities（cmd_path/protocol）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.logging import get_logger
from app.modules.agent.context_builder import transport_for_path_source
from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace, Workspace

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
        # ===== task-03（2026-06-23-spec-transport-tar-sync）：transport 分支 =====
        # D-007@v1：scan/stage 走 interactive lease，tar 模式 spec 同步在 interactive 路径
        # （daemon _startInteractiveSession pull + onSessionEnd sync）。backend 侧开关点：
        #   - tar：不透传 spec_root（让 daemon pull 触发，D-003@v1）+ 透传 workspace_id
        #         （pull 需 wsId，design §13 X-004 gap）+ 透传 transport（daemon 读
        #         execPayload.transport === 'tar' 切分支，task-06）。
        #   - shared（默认，D-004@v1）：维持现状透传 spec_root/runtime_root，daemon 走
        #         translateSpecRoot，bind mount 共享，不 pull 不 sync（向后兼容）。
        # ws_id 解析上提（§4.3）：原代码在 spec_root 解析块内部解析 ws_id 仅用于 DB 回填，
        # 本任务上提到 transport 分支之前，让 tar/shared 两路共用同一份 ws_id（行为等价，
        # 同 lease_meta、同 UUID 逻辑；AC-10 现有 test_lease_service.py AC-02 守护）。
        # 来源：lease_meta.workspace_id（prepare_scan_interactive_dispatch 写入，
        # placement.py:494）。普通 prepare_interactive_dispatch（quick-chat）不写 →
        # ws_id=None → tar 模式也不透传 workspaceId（quick-chat 无 spec 同步语义，边界 E4）。
        ws_id_raw = lease_meta.get("workspace_id")
        ws_id: uuid.UUID | None = None
        if ws_id_raw:
            try:
                ws_id = uuid.UUID(ws_id_raw) if isinstance(ws_id_raw, str) else ws_id_raw
            except (ValueError, AttributeError, TypeError):
                ws_id = None

        # 方案 A（path_source per-workspace transport 决策）：transport 不再只看全局
        # settings.spec_transport，而是按 workspace.path_source 锁定。ws_id 非 None 时查
        # Workspace 行取 path_source（daemon-client→tar / 显式 server-local→shared 锁死，
        # 忽略全局）；path_source=None（quick-chat 无 workspace / 查不到行 / 字段空）→ 回退
        # 全局 settings.spec_transport（向后兼容兜底，守护现有 test_lease_claim_transport C1-C5：
        # 它们不创建真实 Workspace 行，全走兜底分支）。
        settings = get_settings()
        path_source: str | None = None
        if ws_id is not None:
            ws_row = await session.get(Workspace, ws_id)
            if ws_row is not None:
                path_source = ws_row.path_source
        transport = (
            settings.spec_transport
            if path_source is None
            else transport_for_path_source(path_source)
        )
        # transport 双写（camelCase + snake_case），对齐 specRoot/spec_root、rootPath/root_path
        # 惯例；daemon execPayload 归一化两端字段名都覆盖（边界 E5）。
        payload["transport"] = transport
        payload["transportMode"] = transport

        if transport == "tar":
            # tar 模式：不透传 specRoot/spec_root/runtimeRoot/runtime_root（daemon pull 分支，
            # D-003@v1）。即便 lease_meta.spec_root 有值（placement.py:485 写入）也不透传——
            # backend 容器路径对 daemon 异机无意义，daemon 必须走 pull 拉本地缓存（边界 E6）。
            if ws_id is not None:
                payload["workspaceId"] = str(ws_id)  # daemon pullSpecBundle 需 wsId（task-06）
                payload["workspace_id"] = str(ws_id)  # snake_case 双写
            # 不 set specRoot/spec_root → daemon execPayload.specRoot 为 undefined
            # → _startInteractiveSession 走 pullSpecBundle（D-003@v1）。
            return payload

        # ===== shared 模式（默认，D-004@v1 现状零改动）=====
        # task-03（2026-06-22-agent-run-pipeline-fix）：interactive 分支透传 spec_root
        # 给 daemon，与 prompt 内 SPEC_ROOT_MAP 翻译双保险——daemon 收到后：
        #   - 若 prompt 仍含容器 /data/ 路径（SPEC_ROOT_MAP 未配 / 翻译漏）→ 记 warn
        #     让用户检查配置（daemon 无宿主路径信息无法独立翻译，真翻译仍靠 SPEC_ROOT_MAP）。
        #   - 字段为可观测 + 未来扩展口（如 daemon RPC 问 backend 宿主路径）。
        # 来源优先级：lease_meta.spec_root > SpecWorkspace.spec_root（用 workspace_id 查 DB）。
        # 注意：普通 prepare_interactive_dispatch（quick-chat）不写 spec_root/workspace_id
        # 到 metadata，spec_root 保持 None → 不透传 → daemon 完全回退 prompt 翻译（向后兼容）。
        spec_root: str | None = lease_meta.get("spec_root")
        if not spec_root and ws_id is not None:
            # ws_id 已在上提块解析（§4.3），此处直接复用，避免重复 UUID 解析。
            from app.modules.spec_workspace.model import SpecWorkspace

            # SpecWorkspace 主键是 id，workspace_id 是 unique index 列，
            # 不能用 session.get(SpecWorkspace, ws_id)（那是按主键查）。
            # 用 select 按 workspace_id 查（对齐 change/dispatch.py:1192 模式）。
            ws_stmt = select(SpecWorkspace).where(col(SpecWorkspace.workspace_id) == ws_id)
            spec_ws = (await session.execute(ws_stmt)).scalars().first()
            if spec_ws is not None:
                # SpecWorkspace.spec_root 是 nullable=False（model.py:59），必有值。
                spec_root = spec_ws.spec_root
        if spec_root:
            payload["specRoot"] = spec_root  # camelCase（daemon execPayload 消费）
            payload["spec_root"] = spec_root  # snake_case 双写（对齐 rootPath/root_path 模式）
            runtime_root = lease_meta.get("runtime_root")
            if runtime_root:
                payload["runtimeRoot"] = runtime_root
                payload["runtime_root"] = runtime_root
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
