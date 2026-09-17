"""Knowledge distill dispatch service (change 2026-09-17-knowledge-precipitation task-07).

蒸馏派发（FR-01/FR-03，D-002@v1：派发 agent 会话、后端不直调 LLM）——
从平台选会话记录或已归档变更，创建 ``knowledge-distill`` 类 AgentRun 并
fire-and-forget 派发给用户 daemon：agent 读源记录、提炼后执行
``sillyspec knowledge propose``，产物经既有上行同步回流 knowledge/proposed/
（daemon 零改动）。

- 源校验只读复用既有服务：会话源 ``SessionService.get_agent_session``
  （不存在沿 DaemonSessionNotFound 404 语义）且 ``turn_count > 0`` 否则 422；
  变更源 ``ChangeService.get_by_key``（不存在沿 ChangeNotFound 404 语义）且
  ``status == "archived"`` 否则 422。
- AgentRun 创建照 spec_workspace/bootstrap.py:128-150 先例（status=pending、
  agent_type=claude_code、provider/model 取 workspace.default_agent/default_model
  兜底、AgentRunWorkspace 关联）；``metadata_`` 写
  ``{kind: knowledge-distill, source_type, source_ref, focus}`` 四键。
- 后台执行链照 bootstrap.py:456-476：daemon 离线（decide_backend 抛
  NoOnlineDaemonError / dispatch 返回 None 的竞态兜底）立即置 status=failed、
  error_code=no_online_daemon、finished_at、exit_code=1、output_redacted 后
  commit 并发 done 事件——任务创建本身成功且失败态立即可查（R-05）。
- 生命周期契约（design）：除 dispatch 事件外全部复用既有 lease/session/upsync
  事件，distill 无独立状态机（以 AgentRun 状态为准）。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, SpecWorkspaceNotFound, WorkspaceNotFound
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.knowledge.schema import DistillTaskRead
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# Hold strong refs to fire-and-forget distill tasks so asyncio doesn't GC them
# before they run（_BACKGROUND_BOOTSTRAP_TASKS 同款；根 conftest
# _isolate_background_tasks 覆盖不到本集合，knowledge/tests/conftest.py 按同款
# 模式逐测试清理）。
_BACKGROUND_DISTILL_TASKS: set[asyncio.Task[None]] = set()

log = get_logger(__name__)

#: metadata_.kind 固定值——list_tasks 按 it 过滤 knowledge-distill 类任务。
DISTILL_RUN_KIND = "knowledge-distill"


class DistillSourceInvalid(AppError):
    """蒸馏源不满足派发条件（无记录会话 / 未归档变更 / 非法引用）。"""

    code = "HTTP_422_DISTILL_SOURCE_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


# ── prompt 模板（R-05 固化，不随请求拼装自由文本之外的逻辑）──────────────────


def build_distill_prompt(
    source_type: Literal["session", "change"],
    source_ref: str,
    focus: str | None,
) -> str:
    """按 source_type 分会话/变更两式，内嵌 source_ref 与可选 focus。

    指令固化 ``sillyspec knowledge propose --title --category --body`` 用法
    （R-05：防 agent 产出不合规格的候选文件）；产物经既有上行同步回流，daemon
    侧无需任何改动。
    """
    if source_type == "session":
        source_line = (
            f"来源是平台会话记录（session_id：{source_ref}），请读取该会话的完整对话记录。"
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
    """知识蒸馏派发：dispatch（源校验 + AgentRun 创建 + 后台派发）与 list_tasks。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        source_type: Literal["session", "change"],
        source_ref: str,
        focus: str | None = None,
    ) -> DistillTaskRead:
        """源校验后创建 knowledge-distill 类 AgentRun 并 fire-and-forget 派发。

        返回 DistillTaskRead（创建时刻 status=pending；daemon 离线时后台任务
        立即收敛为 failed/no_online_daemon，前端任务条轮询列表即可见终态）。
        """
        await self._validate_source(workspace_id, user, source_type, source_ref)

        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise WorkspaceNotFound(
                "工作区不存在，请刷新后重试。",
                details={"workspace_id": str(workspace_id)},
            )
        spec_ws = await self._get_spec_workspace(workspace_id)

        # AgentRun 创建照 bootstrap.py:128-150 先例；provider/model 取
        # workspace.default_agent/default_model 兜底。
        resolved_provider = workspace.default_agent or "claude"
        resolved_model = workspace.default_model or None
        run = AgentRun(
            id=uuid.uuid4(),
            task_id=None,
            lease_id=None,
            agent_type="claude_code",
            provider=resolved_provider,
            model=resolved_model,
            status="pending",
            spec_strategy=spec_ws.strategy,
            profile_version=spec_ws.profile_version,
            metadata_={
                "kind": DISTILL_RUN_KIND,
                "source_type": source_type,
                "source_ref": source_ref,
                "focus": focus,
            },
        )
        self._session.add(run)
        await self._session.commit()
        await self._session.refresh(run)

        self._session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=workspace_id))
        await self._session.commit()

        prompt = build_distill_prompt(source_type, source_ref, focus)
        log.info(
            "knowledge_distill_dispatch",
            workspace_id=str(workspace_id),
            agent_run_id=str(run.id),
            source_type=source_type,
            source_ref=source_ref,
        )

        # fire-and-forget 后台派发（强引用防 GC，bootstrap 同款）。
        task = asyncio.create_task(
            _execute_distill_agent_run(
                run_id=run.id,
                workspace_id=workspace_id,
                user_id=user.id,
                prompt=prompt,
            )
        )
        _BACKGROUND_DISTILL_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_DISTILL_TASKS.discard)

        return _to_task_read(run)

    async def list_tasks(self, workspace_id: uuid.UUID) -> list[DistillTaskRead]:
        """该工作区的 knowledge-distill 类任务，按 created_at 倒序。

        过滤口径 = AgentRunWorkspace 关联 + ``metadata_.kind == knowledge-distill``
        （其它 AgentRun 不混入）；source_type/source_ref 自 metadata_ 投影。
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

    async def _validate_source(
        self,
        workspace_id: uuid.UUID,
        user: User,
        source_type: Literal["session", "change"],
        source_ref: str,
    ) -> None:
        """源校验（只读复用既有服务，不改其签名）。

        不存在的会话/变更沿既有 404 语义（DaemonSessionNotFound /
        ChangeNotFound）；存在但不满足条件（无记录会话 / 未归档变更）→ 422。
        """
        if source_type == "session":
            try:
                session_id = uuid.UUID(source_ref)
            except ValueError as exc:
                raise DistillSourceInvalid(
                    "会话引用不合法，请从会话列表选择。",
                    details={"source_type": source_type, "source_ref": source_ref},
                ) from exc
            from app.modules.daemon.session.service import SessionService

            agent_session = await SessionService(self._session).get_agent_session(
                session_id, user.id
            )
            if agent_session.turn_count <= 0:
                raise DistillSourceInvalid(
                    "该会话还没有对话记录，无内容可提炼。",
                    details={"source_type": source_type, "source_ref": source_ref},
                )
        elif source_type == "change":
            from app.modules.change.service import ChangeService

            change = await ChangeService(self._session).get_by_key(workspace_id, source_ref)
            if change.status != "archived":
                raise DistillSourceInvalid(
                    "仅已归档（archived）变更支持提炼，请先完成归档。",
                    details={
                        "source_type": source_type,
                        "source_ref": source_ref,
                        "status": change.status,
                    },
                )
        else:  # schema Literal 已约束；service 层兜底防直调绕过。
            raise DistillSourceInvalid(
                "来源类型仅支持 session / change。",
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
    return DistillTaskRead(
        agent_run_id=run.id,
        source_type=str(meta.get("source_type", "")),
        source_ref=str(meta.get("source_ref", "")),
        status=run.status,
        created_at=run.created_at,
    )


# ---------------------------------------------------------------------------
# Background execution（bootstrap.py:456-476 同款链路）
# ---------------------------------------------------------------------------


async def _execute_distill_agent_run(
    *,
    run_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    prompt: str,
) -> None:
    """把 distill AgentRun 派发给用户 daemon（独立 DB session，fire-and-forget）。

    daemon 离线（decide_backend 抛 NoOnlineDaemonError，或 dispatch 返回 None
    的瞬时离线竞态）时立即置 failed/no_online_daemon 并发 done 事件——任务
    创建本身成功、失败态立即可查；在线时走既有 ``dispatch_to_daemon`` 落
    daemon_task_leases（prompt 持久化在 lease metadata，daemon claim 后执行，
    产物经既有上行同步回流）。
    """
    from app.core.db import get_session_factory
    from app.modules.agent.placement import (
        NoOnlineDaemonError,
        RunPlacementService,
    )

    factory = get_session_factory()
    async with factory() as session:
        try:
            run = await session.get(AgentRun, run_id)
            if run is None:
                log.error(
                    "knowledge_distill_run_missing",
                    run_id=str(run_id),
                    workspace_id=str(workspace_id),
                )
                return

            workspace = await session.get(Workspace, workspace_id)
            if workspace is None:
                await _mark_failed(session, run, "workspace_missing", "Workspace not found.")
                return

            placement = RunPlacementService(session)
            try:
                await placement.decide_backend(
                    workspace_id=workspace_id,
                    user_id=user_id,
                )
            except NoOnlineDaemonError as exc:
                await _mark_failed(session, run, "no_online_daemon", exc.message)
                log.warning(
                    "knowledge_distill_no_online_daemon",
                    run_id=str(run_id),
                    workspace_id=str(workspace_id),
                )
                return

            lease_id = await placement.dispatch_to_daemon(
                run.id,
                user_id,
                workspace_id=workspace_id,
                provider=run.provider,
                model=run.model,
                prompt=prompt,
                root_path=workspace.root_path,
                workspace_name=workspace.name,
                workspace_slug=workspace.slug,
            )
            if lease_id is None:
                # race：runtime 在 resolve 后、claim 前离线（execution.py 同款兜底）。
                await _mark_failed(
                    session,
                    run,
                    "no_online_daemon",
                    "runtime 在派发瞬间离线，dispatch 返回 None",
                )
                return

            log.info(
                "knowledge_distill_dispatched",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                lease_id=str(lease_id),
            )

        except Exception as exc:
            log.exception(
                "knowledge_distill_dispatch_exception",
                run_id=str(run_id),
                workspace_id=str(workspace_id),
                error=str(exc),
            )
            try:
                failed_run = await session.get(AgentRun, run_id)
                if failed_run is not None and failed_run.status not in (
                    "completed",
                    "failed",
                    "killed",
                ):
                    await _mark_failed(session, failed_run, "dispatch_exception", str(exc))
            except Exception:
                log.warning(
                    "knowledge_distill_mark_failed_error",
                    run_id=str(run_id),
                )


async def _mark_failed(
    session: AsyncSession,
    run: AgentRun,
    error_code: str,
    message: str,
) -> None:
    """置 failed 终态 + commit + done 事件（bootstrap 456-476 复刻）。"""
    run.status = "failed"
    run.error_code = error_code
    run.output_redacted = message
    run.finished_at = datetime.now(UTC)
    run.exit_code = 1
    session.add(run)
    await session.commit()
    await _publish_done_event(run.id, "failed", 1)


async def _publish_done_event(
    run_id: uuid.UUID,
    status: str,
    exit_code: int | None,
) -> None:
    """终态 done 事件（SSE 订阅者停止等待；redis 不可用 best-effort 跳过）。"""
    try:
        redis = get_redis()
        payload = json.dumps(
            {
                "event": "done",
                "run_id": str(run_id),
                "status": status,
                "exit_code": exit_code,
            }
        )
        await redis.publish(f"agent_run:{run_id}", payload)
    except Exception:
        log.warning("knowledge_distill_done_publish_failed", run_id=str(run_id))
