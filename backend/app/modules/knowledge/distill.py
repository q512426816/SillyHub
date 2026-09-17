"""Knowledge distill dispatch service (change 2026-09-17-knowledge-precipitation
task-07 + D-009 续接分流 + D-010 闭环增强）。

蒸馏派发（FR-01/FR-03，D-002@v1：派发 agent 会话、后端不直调 LLM）——从平台
选会话记录 / 已归档变更 / 快速修复日志，按 ``mode`` 分流执行（D-009）：

- **mode=resume（仅 source_type=session）**：原会话续接——已结束会话先
  ``reopen_session``（SDK resume 保留完整对话历史 + prompt cache），再
  ``inject_session(prompt=build_distill_prompt(...))`` 下发提炼指令；进行中
  会话跳过 reopen 直接 inject。一举化解 R-08 洞一（原会话读自己，无需取数
  通道）。降级守卫（自动落 fresh 并在任务条记降级原因）：provider 无 resume
  能力（get_provider_caps()["resume"]=False）/ 会话状态不可 reopen
  （suspended 等）/ 非会话来源请求 resume（change、quick 强制 fresh）。
- **mode=fresh**（默认，零回归）：复用 ``create_session`` 完整链路（D-010③：
  runtime_id 钉机器优先于 provider，agent_profile_id/model 透传，title 由
  prompt 首行「提炼」前缀承担），AgentSession.origin 落档
  DISTILL_SESSION_ORIGIN（D-010④，常规会话列表默认排除）。daemon 离线时
  create_session 自身已把 session/run/lease 三元组收敛 failed 并抛
  DaemonRuntimeOffline / NoOnlineDaemonError——本服务捕获后补建
  failed/no_online_daemon 蒸馏任务条（R-05：任务创建成功且失败态立即可查）。

两种路径成功后都把实际执行的 AgentSession 首 run 落档为 knowledge-distill
任务条（metadata_ 合并 kind/source_*/mode/agent_session_id，缺 run 时补建
跟踪 run；AgentRunWorkspace 关联幂等建立）——list_tasks 口径不变
（AgentRunWorkspace 关联 + metadata_.kind 过滤）。

- 源校验只读复用既有服务：会话源 ``SessionService.get_agent_session``
  （不存在沿 DaemonSessionNotFound 404 语义）且 ``turn_count > 0`` 否则 422；
  变更源 ``ChangeService.get_by_key``（不存在沿 ChangeNotFound 404 语义）且
  ``status == "archived"`` 否则 422；快速修复源（D-010②）校验
  ``<spec_root>/quicklog/<ql-id>.md`` 存在否则 422（ql 为文件树条目，新
  agent 直接读，无 R-08 洞一取数问题）。
- 生命周期契约（design）：蒸馏无独立状态机，任务条 status 以所落档 AgentRun
  为准；续接/新建会话内部的 run/lease/upsync 事件全部复用既有链路。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, SpecWorkspaceNotFound, WorkspaceNotFound
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.auth.model import User
from app.modules.daemon.schema import DISTILL_SESSION_ORIGIN
from app.modules.knowledge.schema import DistillTaskRead
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)

#: metadata_.kind 固定值——list_tasks 按 it 过滤 knowledge-distill 类任务。
DISTILL_RUN_KIND = "knowledge-distill"

#: metadata_.mode 固定值（resume 被降级守卫改写后落 "fresh"）。
MODE_RESUME = "resume"
MODE_FRESH = "fresh"

#: 降级原因码（DistillTaskRead.degraded_reason / metadata_.degraded_reason）。
DEGRADE_NOT_SESSION = "resume_only_for_session_source"
DEGRADE_PROVIDER_NO_RESUME = "provider_no_resume"
DEGRADE_STATUS_NOT_REOPENABLE = "session_status_not_reopenable"


class DistillSourceInvalid(AppError):
    """蒸馏源不满足派发条件（无记录会话 / 未归档变更 / ql 不存在 / 非法引用）。"""

    code = "HTTP_422_DISTILL_SOURCE_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


# ── prompt 模板（R-05 固化，不随请求拼装自由文本之外的逻辑）──────────────────


def build_distill_prompt(
    source_type: Literal["session", "change", "quick"],
    source_ref: str | list[str],
    focus: str | None,
    *,
    for_resume: bool = False,
) -> str:
    """按 source_type 分会话/变更/快速修复三式，内嵌 source_ref 与可选 focus。

    指令固化 ``sillyspec knowledge propose --title --category --body`` 用法
    （R-05：防 agent 产出不合规格的候选文件）；产物经既有上行同步回流，daemon
    侧无需任何改动。``for_resume=True``（D-009）时来源改写为「本会话本身的
    完整对话记录」——续接会话读自己，无需取数通道。
    """
    if source_type == "session":
        if for_resume:
            source_line = "来源即本会话本身的完整对话记录（你是原会话的续接，已持有全部上下文），请回顾本会话全过程进行提炼。"
        else:
            source_line = (
                f"来源是平台会话记录（session_id：{source_ref}），请读取该会话的完整对话记录。"
            )
    elif source_type == "quick":
        refs = source_ref if isinstance(source_ref, list) else [source_ref]
        paths = "\n".join(f"- .sillyspec/quicklog/{ref}.md" for ref in refs)
        source_line = (
            "来源是快速修复日志（quicklog）条目，共 "
            f"{len(refs)} 条，请逐一读取以下文件：\n{paths}\n"
            "聚焦每次修复的问题现象、根因与解法。"
        )
    else:
        source_line = f"来源是已归档的变更（change_key：{source_ref}），请读取该变更目录下的设计文档、任务卡与产出记录。"
    focus_line = f"\n本次提炼关注点（用户指定）：{focus}\n" if focus else "\n"
    return (
        "你是知识沉淀助手，负责把平台的记录资产提炼成可长期复用的知识条目。\n"
        f"\n{source_line}\n"
        "\n提炼要求：\n"
        "1. 只保留值得长期复用的知识：踩坑与解法、可复用模式、平台约定与契约；忽略过程性描述与一次性信息。\n"
        "2. 每条知识独立成条，标题概括问题本身，正文用 Markdown 写清「问题、解法、证据（文件/提交）、适用条件」。\n"
        f"{focus_line}"
        "\n落盘方式（必须逐字遵守，不许改用其它写文件方式）：\n"
        "对每条提炼出的知识，在仓库内执行：\n"
        'sillyspec knowledge propose --title "<条目标题>" '
        "--category <conventions|patterns|known-issues|uncategorized> "
        '--body "<Markdown 正文>"\n'
        "\n完成后简要汇报提炼出的候选知识清单即可，不要修改知识库之外的任何文件。"
    )


# ── Service ───────────────────────────────────────────────────────────────────


class DistillDispatchService:
    """知识蒸馏派发：dispatch（源校验 + mode 分流执行）与 list_tasks。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        source_type: Literal["session", "change", "quick"],
        source_ref: str | list[str],
        focus: str | None = None,
        mode: Literal["resume", "fresh"] = MODE_FRESH,
        runtime_id: str | None = None,
        agent_type: str | None = None,
        agent_profile_id: str | None = None,
        model: str | None = None,
    ) -> DistillTaskRead:
        """源校验后按 mode 分流执行（resume 续接 / fresh 新建蒸馏会话）。

        返回 DistillTaskRead（任务条 status 以落档 AgentRun 为准；daemon 离线
        时 fresh 路径补建 failed/no_online_daemon 任务条，失败态立即可查）。
        """
        refs = source_ref if isinstance(source_ref, list) else [source_ref]

        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise WorkspaceNotFound(
                "工作区不存在，请刷新后重试。",
                details={"workspace_id": str(workspace_id)},
            )
        spec_ws = await self._get_spec_workspace(workspace_id)
        # 提前取原始值：create_session 失败路径会 rollback 请求级 session，
        # ORM 行属性过期后再访问会触发 MissingGreenlet（异步懒加载禁区）。
        spec_strategy = spec_ws.strategy
        spec_profile_version = spec_ws.profile_version
        await self._validate_source(workspace_id, user, source_type, refs, spec_ws)

        # ── mode 分流（D-009）：降级守卫先行，改写 resolved_mode 并记原因 ──
        resolved_mode = mode
        degraded_reason: str | None = None
        resume_session_id: uuid.UUID | None = None
        resume_inject_only = False
        if mode == MODE_RESUME:
            if source_type != "session":
                resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_NOT_SESSION
            else:
                plan = await self._plan_resume(uuid.UUID(refs[0]), user)
                if plan == "degrade_provider":
                    resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_PROVIDER_NO_RESUME
                elif plan == "degrade_status":
                    resolved_mode, degraded_reason = MODE_FRESH, DEGRADE_STATUS_NOT_REOPENABLE
                elif plan == "inject":
                    resume_inject_only = True
                    resume_session_id = uuid.UUID(refs[0])
                else:  # "reopen"
                    resume_session_id = uuid.UUID(refs[0])

        prompt = build_distill_prompt(
            source_type,
            source_ref if source_type == "quick" else refs[0],
            focus,
            for_resume=(resolved_mode == MODE_RESUME),
        )

        log.info(
            "knowledge_distill_dispatch",
            workspace_id=str(workspace_id),
            source_type=source_type,
            source_ref=refs if len(refs) > 1 else refs[0],
            mode=resolved_mode,
            degraded_reason=degraded_reason,
        )

        base_meta: dict = {
            "kind": DISTILL_RUN_KIND,
            "source_type": source_type,
            "source_ref": source_ref if source_type == "quick" else refs[0],
            "focus": focus,
            "mode": resolved_mode,
        }
        if degraded_reason is not None:
            base_meta["degraded_reason"] = degraded_reason

        # ── 执行：resume 续接 / fresh 新建 ────────────────────────────────
        if resolved_mode == MODE_RESUME:
            assert resume_session_id is not None
            svc = self._session_service()
            if not resume_inject_only:
                await svc.reopen_session(resume_session_id, user.id)
            result = await svc.inject_session(resume_session_id, user.id, prompt=prompt)
            run = await self._mark_task_run(
                workspace_id,
                base_meta,
                spec_strategy,
                spec_profile_version,
                agent_run=result.agent_run,
                agent_session=result.agent_session,
            )
            return _to_task_read(run)

        # fresh：prompt 首行带「提炼」前缀（D-010③ title 载体）；provider/model
        # 取请求显式值，缺省回落 workspace.default_agent/default_model（对齐
        # 旧 bootstrap 路径兜底，零回归）。
        fresh_prompt = "【提炼】请执行以下知识沉淀任务。\n\n" + prompt
        svc = self._session_service()
        try:
            result = await _create_session(
                svc,
                user.id,
                provider=agent_type or workspace.default_agent or "claude",
                prompt=fresh_prompt,
                model=model if model is not None else workspace.default_model,
                workspace_id=workspace_id,
                runtime_id=runtime_id,
                agent_profile_id=agent_profile_id,
                origin=DISTILL_SESSION_ORIGIN,
            )
        except (DaemonRuntimeOffline, NoOnlineDaemonError) as exc:
            # R-05：create_session 已把 session/run/lease 收敛 failed；补建
            # 蒸馏任务条（failed/no_online_daemon）使失败态立即可查。
            log.warning(
                "knowledge_distill_no_online_daemon",
                workspace_id=str(workspace_id),
                source_type=source_type,
                error=str(exc),
            )
            run = await self._new_tracking_run(
                workspace_id,
                base_meta,
                spec_strategy=spec_strategy,
                spec_profile_version=spec_profile_version,
                status="failed",
                error_code="no_online_daemon",
            )
            return _to_task_read(run)
        run = await self._mark_task_run(
            workspace_id,
            base_meta,
            spec_strategy,
            spec_profile_version,
            agent_run=result.agent_run,
            agent_session=result.agent_session,
        )
        return _to_task_read(run)

    async def list_tasks(self, workspace_id: uuid.UUID) -> list[DistillTaskRead]:
        """该工作区的 knowledge-distill 类任务，按 created_at 倒序。

        过滤口径 = AgentRunWorkspace 关联 + ``metadata_.kind == knowledge-distill``
        （其它 AgentRun 不混入）；source_type/source_ref/mode/agent_session_id/
        merged_to/degraded_reason 自 metadata_ 投影。
        """
        stmt = (
            select(AgentRun)
            .join(
                AgentRunWorkspace,
                AgentRunWorkspace.agent_run_id == AgentRun.id,
            )
            .where(AgentRunWorkspace.workspace_id == workspace_id)
            .order_by(AgentRun.created_at.desc())
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        return [
            _to_task_read(run)
            for run in runs
            if (run.metadata_ or {}).get("kind") == DISTILL_RUN_KIND
        ]

    # ── 内部 ──────────────────────────────────────────────────────────────

    def _session_service(self):
        """SessionService 实例（lazy import 对齐 _validate_source 先例）。"""
        from app.modules.daemon.session.service import SessionService

        return SessionService(self._session)

    async def _plan_resume(
        self,
        session_id: uuid.UUID,
        user: User,
    ) -> Literal["reopen", "inject", "degrade_provider", "degrade_status"]:
        """续接前置规划（D-009 降级守卫）：返回执行计划或降级决定。

        - provider 无 resume 能力 → degrade_provider（自动降级 fresh）；
        - 进行中会话（pending/active/reconnecting）→ inject（直接发，不 reopen）；
        - 已结束/失败（可 reopen）→ reopen；
        - 其余状态（suspended 等）→ degrade_status（自动降级 fresh）。
        """
        from app.modules.daemon.session.service import ACTIVE_SESSION_STATUSES

        agent_session = await self._session_service().get_agent_session(session_id, user.id)
        if not get_provider_caps(agent_session.provider)["resume"]:
            return "degrade_provider"
        if agent_session.status in ACTIVE_SESSION_STATUSES:
            return "inject"
        if agent_session.status in ("ended", "failed"):
            return "reopen"
        return "degrade_status"

    async def _mark_task_run(
        self,
        workspace_id: uuid.UUID,
        base_meta: dict,
        spec_strategy: str,
        spec_profile_version: str,
        *,
        agent_run: AgentRun | None,
        agent_session,
    ) -> AgentRun:
        """把实际执行的会话首 run 落档为蒸馏任务条（幂等）。

        优先复用会话真实 run（status 随会话执行如实推进）；无 run（排队等
        边缘形态）时补建跟踪 run（status=running）。metadata_ 合并写入
        （保留既有键如 auto_resume_of），AgentRunWorkspace 关联 find-or-create。
        """
        meta = dict(base_meta)
        meta["agent_session_id"] = str(agent_session.id)
        if agent_run is None:
            return await self._new_tracking_run(
                workspace_id,
                meta,
                spec_strategy=spec_strategy,
                spec_profile_version=spec_profile_version,
                status="running",
            )
        merged = dict(agent_run.metadata_ or {})
        merged.update(meta)
        agent_run.metadata_ = merged
        self._session.add(agent_run)
        link = (
            (
                await self._session.execute(
                    select(AgentRunWorkspace).where(
                        AgentRunWorkspace.agent_run_id == agent_run.id,
                        AgentRunWorkspace.workspace_id == workspace_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if link is None:
            self._session.add(
                AgentRunWorkspace(agent_run_id=agent_run.id, workspace_id=workspace_id)
            )
        await self._session.commit()
        await self._session.refresh(agent_run)
        return agent_run

    async def _new_tracking_run(
        self,
        workspace_id: uuid.UUID,
        meta: dict,
        *,
        spec_strategy: str,
        spec_profile_version: str,
        status: str,
        error_code: str | None = None,
    ) -> AgentRun:
        """无会话 run 可用时补建的蒸馏跟踪 AgentRun（离线失败/排队边缘形态）。

        独立 DB session 落库（旧后台派发任务同款）——create_session 失败路径
        可能已 rollback/污染请求级 session，复用有风险；任务条只需 INSERT，
        不自增竞态面。
        """
        from app.core.db import get_session_factory

        factory = get_session_factory()
        async with factory() as session:
            run = AgentRun(
                id=uuid.uuid4(),
                task_id=None,
                lease_id=None,
                agent_type="claude_code",
                provider="claude",
                model=None,
                status=status,
                error_code=error_code,
                spec_strategy=spec_strategy,
                profile_version=spec_profile_version,
                metadata_=meta,
                finished_at=datetime.now(UTC) if status == "failed" else None,
                exit_code=1 if status == "failed" else None,
                output_redacted="no online daemon" if error_code else None,
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
            await session.commit()
        # expire_on_commit=False（app/core/db.py）——出 session 后属性可读。
        return run

    async def _validate_source(
        self,
        workspace_id: uuid.UUID,
        user: User,
        source_type: Literal["session", "change", "quick"],
        refs: list[str],
        spec_ws: SpecWorkspace,
    ) -> None:
        """源校验（只读复用既有服务，不改其签名）。

        不存在的会话/变更沿既有 404 语义（DaemonSessionNotFound /
        ChangeNotFound）；存在但不满足条件（无记录会话 / 未归档变更 / ql 文件
        缺失）→ 422。session/change 仅支持单条来源；quick 支持多条（D-010②）。
        """
        if source_type == "session":
            if len(refs) != 1:
                raise DistillSourceInvalid(
                    "会话来源仅支持单条，请从会话列表选择一个会话。",
                    details={"source_type": source_type, "source_ref": refs},
                )
            try:
                session_id = uuid.UUID(refs[0])
            except ValueError as exc:
                raise DistillSourceInvalid(
                    "会话引用不合法，请从会话列表选择。",
                    details={"source_type": source_type, "source_ref": refs[0]},
                ) from exc
            from app.modules.daemon.session.service import SessionService

            agent_session = await SessionService(self._session).get_agent_session(
                session_id, user.id
            )
            if agent_session.turn_count <= 0:
                raise DistillSourceInvalid(
                    "该会话还没有对话记录，无内容可提炼。",
                    details={"source_type": source_type, "source_ref": refs[0]},
                )
        elif source_type == "change":
            if len(refs) != 1:
                raise DistillSourceInvalid(
                    "变更来源仅支持单条，请选择一个已归档变更。",
                    details={"source_type": source_type, "source_ref": refs},
                )
            from app.modules.change.service import ChangeService

            change = await ChangeService(self._session).get_by_key(workspace_id, refs[0])
            if change.status != "archived":
                raise DistillSourceInvalid(
                    "仅已归档（archived）变更支持提炼，请先完成归档。",
                    details={
                        "source_type": source_type,
                        "source_ref": refs[0],
                        "status": change.status,
                    },
                )
        elif source_type == "quick":
            # D-010②：ql 是 spec 树文件条目（<spec_root>/quicklog/<ql-id>.md），
            # 逐条校验存在性；缺失任一条即 422（与 parser 读取口径同根）。
            quicklog_dir = Path(spec_ws.spec_root) / "quicklog"
            for ref in refs:
                if not (quicklog_dir / f"{ref}.md").is_file():
                    raise DistillSourceInvalid(
                        f"快速修复日志 '{ref}' 不存在，请从快速修复列表选择。",
                        details={"source_type": source_type, "source_ref": ref},
                    )
        else:  # schema Literal 已约束；service 层兜底防直调绕过。
            raise DistillSourceInvalid(
                "来源类型仅支持 session / change / quick。",
                details={"source_type": source_type},
            )

    async def _get_spec_workspace(self, workspace_id: uuid.UUID) -> SpecWorkspace:
        stmt = select(SpecWorkspace).where(
            SpecWorkspace.workspace_id == workspace_id,
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        return result


def _to_task_read(run: AgentRun) -> DistillTaskRead:
    """AgentRun + metadata_ → DistillTaskRead 投影。"""
    meta = run.metadata_ or {}
    raw_ref = meta.get("source_ref", "")
    raw_session = meta.get("agent_session_id")
    return DistillTaskRead(
        agent_run_id=run.id,
        source_type=str(meta.get("source_type", "")),
        source_ref=",".join(raw_ref) if isinstance(raw_ref, list) else str(raw_ref),
        status=run.status,
        created_at=run.created_at,
        mode=str(meta.get("mode", MODE_FRESH)),
        agent_session_id=uuid.UUID(raw_session) if raw_session else None,
        merged_to=meta.get("merged_to"),
        degraded_reason=meta.get("degraded_reason"),
    )


# ── 延迟解析符号（对齐 create.py 的 ``_svc.`` 延迟解析惯例，便测试 patch）──────
# create_session 模块函数与离线异常在模块尾部绑定，monkeypatch 点即本模块属性。
from app.modules.agent.placement import NoOnlineDaemonError  # noqa: E402
from app.modules.daemon.runtime.service import DaemonRuntimeOffline  # noqa: E402
from app.modules.daemon.session.service.create import (  # noqa: E402
    create_session as _create_session,
)
