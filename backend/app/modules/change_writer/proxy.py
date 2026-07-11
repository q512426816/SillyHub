"""change_writer proxy — 变更代写 (D-004@v1 / FR-08 / FR-09).

经 lease-polling 代写队列把变更包内容下发给绑定 daemon（daemon-client 架构：
workspace 绑定到远程 daemon 宿主，backend 无可达文件系统）：

1. 校验 runtime（per-member binding 解析 + status='online'，task-08 清：
   legacy 单值 runtime 列已删，写回始终现算）。
2. 复用 ``markdown_builder`` + ``ChangeWriterService._ensure_frontmatter`` 构造
   MASTER/proposal/request 文本（**不重复 frontmatter 逻辑**）。
3. 建 ``DaemonChangeWrite`` 行（status='pending'），files 用扁平 ``changes/<key>/``
   相对路径（D-005@v1，无 ``.sillyspec`` 包裹层）。
4. 轮询回执（周期 ≤1s），超时 60s → ``failed`` + 抛 ``ChangeWriteError``。
5. 回执 ``ok`` → 落 ``Change`` + ``ChangeDocument`` 行（path 相对 spec_root）。

设计来源：design §5.3 Phase 3 / §7 ``proxy_create_change`` 签名 / §7.5 生命周期
契约表（write_change 下发/回执）/ §8 错误码 ``DAEMON_CLIENT_NO_SESSION``。
"""

from __future__ import annotations

import asyncio
import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, WorkspaceNotFound
from app.core.logging import get_logger
from app.modules.change.model import Change, ChangeDocument
from app.modules.change_writer.markdown_builder import build_master_md
from app.modules.change_writer.service import ChangeWriteError, ChangeWriterService
from app.modules.daemon.model import DaemonChangeWrite
from app.modules.workspace.model import Workspace

log = get_logger(__name__)

# NFR-03：daemon 回执等待超时（秒）。超时后翻 failed 并抛 ChangeWriteError。
PROXY_CHANGE_WRITE_TIMEOUT_SECONDS = 60
# 轮询周期（秒）—— ≤1s，daemon claim/complete 在该窗口内完成。
PROXY_POLL_INTERVAL_SECONDS = 0.5


def _runtime_heartbeat_is_fresh(runtime: object) -> bool:
    """Return True only when the runtime status and heartbeat are both fresh."""
    from app.modules.daemon.runtime.service import DEFAULT_RUNTIME_STALE_SECONDS

    if getattr(runtime, "status", None) != "online":
        return False
    heartbeat = getattr(runtime, "last_heartbeat_at", None)
    if heartbeat is None:
        return False
    heartbeat_at = heartbeat if heartbeat.tzinfo else heartbeat.replace(tzinfo=UTC)
    return heartbeat_at >= datetime.now(UTC) - timedelta(seconds=DEFAULT_RUNTIME_STALE_SECONDS)


class DaemonClientNoActiveSession(AppError):
    """daemon-client workspace 需在线 daemon 才能创建变更 (design §8)。

    code ``DAEMON_CLIENT_NO_SESSION``、http 400，前端可据结构化 code 渲染 toast。
    """

    code = "DAEMON_CLIENT_NO_SESSION"
    http_status = 400


def _build_change_key(title: str) -> str:
    """复用 ``service.create_change`` 的 change_key 算法（date+slug+hex）。"""
    date_prefix = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "untitled"
    return f"{date_prefix}-{slug}-{uuid.uuid4().hex[:6]}"


def _build_files(
    *,
    change_key: str,
    title: str,
    description: str,
    change_type: str | None,
    author: str,
    now: datetime,
) -> list[dict]:
    """构造 change 包文件清单（path 相对 spec_root，扁平 changes/<key>/）。

    path 相对 spec_root 用扁平 ``changes/<key>/<file>``（无 ``.sillyspec`` 包裹，
    对齐 platform-managed 布局 D-005@v1）。frontmatter 复用
    ``ChangeWriterService._ensure_frontmatter``，不重复逻辑。

    每项额外带 ``doc_type``（与 change 落库的 doc_type 对齐：master/
    proposal/request），落库时直接取用，避免从文件名 stem 反推大小写问题。
    """
    files: list[dict] = []

    master_content = build_master_md(title=title, change_type=change_type)
    master_content = ChangeWriterService._ensure_frontmatter(master_content, author, now)
    files.append(
        {
            "path": f"changes/{change_key}/MASTER.md",
            "content": master_content,
            "doc_type": "master",
        }
    )

    if description:
        proposal_content = f"# {title}\n\n## 需求描述\n\n{description}\n"
        proposal_content = ChangeWriterService._ensure_frontmatter(proposal_content, author, now)
        files.append(
            {
                "path": f"changes/{change_key}/proposal.md",
                "content": proposal_content,
                "doc_type": "proposal",
            }
        )

        request_content = f"# {title}\n\n{description}\n"
        request_content = ChangeWriterService._ensure_frontmatter(request_content, author, now)
        files.append(
            {
                "path": f"changes/{change_key}/request.md",
                "content": request_content,
                "doc_type": "request",
            }
        )

    return files


async def _await_change_write_receipt(
    session: AsyncSession,
    change_write_id: uuid.UUID,
) -> DaemonChangeWrite:
    """轮询 DaemonChangeWrite.status，回执 done/failed 返回，超时抛 ChangeWriteError。

    超时 NFR-03 60s → 翻 ``status='failed'`` + ``error='timeout'`` + 抛
    ``ChangeWriteError``（调用方据 http_status 400 返前端）。
    """
    deadline = datetime.now(UTC).timestamp() + PROXY_CHANGE_WRITE_TIMEOUT_SECONDS
    while True:
        cw = await session.get(DaemonChangeWrite, change_write_id)
        if cw is None:
            # 行不应消失（FK + 无级联删除路径），防御性抛错。
            raise ChangeWriteError(
                "Change write record disappeared.",
                details={"change_write_id": str(change_write_id)},
            )
        # SessionFactory uses expire_on_commit=False. daemon complete runs in a
        # different request/session, so force a DB refresh instead of reading the
        # identity-map copy forever.
        await session.refresh(cw)
        if cw.status in ("done", "failed"):
            return cw
        if datetime.now(UTC).timestamp() >= deadline:
            cw.status = "failed"
            cw.error = "proxy await timeout"
            cw.completed_at = datetime.now(UTC)
            session.add(cw)
            await session.commit()
            raise ChangeWriteError(
                "daemon 未在超时阈值内回执 change-write。",
                details={
                    "change_write_id": str(change_write_id),
                    "timeout_seconds": PROXY_CHANGE_WRITE_TIMEOUT_SECONDS,
                },
            )
        await asyncio.sleep(PROXY_POLL_INTERVAL_SECONDS)


async def proxy_create_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    title: str,
    description: str = "",
    change_type: str | None = None,
) -> Change:
    """daemon-client 变更代写：下发 change-write 任务 → 等回执 → 落库 Change。

    runtime 解析失败（未绑定 / daemon 离线 / default_agent 无匹配 runtime）→
    抛 ``DaemonClientNoActiveSession``（400，code ``DAEMON_CLIENT_NO_SESSION``）。

    D-001@v1（2026-07-05-daemon-client-change-binding-fix）：runtime_id 不再由
    caller 传入，改由 ``resolve_runtime_for_writeback`` 用 binding + default_agent
    现算（与派发链路共用解析）。
    """
    workspace = await session.get(Workspace, workspace_id)
    if workspace is None or workspace.deleted_at is not None:
        raise WorkspaceNotFound(
            "Workspace not found.",
            details={"workspace_id": str(workspace_id)},
        )

    # 校验：从 binding + workspace.default_agent 现算 online runtime（D-001@v1）。
    # 失败抛 DaemonClientNoActiveSession（reason 区分 not_bound / daemon_offline /
    # default_agent_unset / provider_unavailable）。
    from app.modules.workspace.member_runtimes.resolver import (
        resolve_runtime_for_writeback,
    )

    resolved = await resolve_runtime_for_writeback(session, workspace_id, user_id)
    rid_raw = resolved["id"]
    runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw

    # runtime 在线心跳二次校验（防竞态：现算后到下发前 daemon 可能掉线）。
    from app.modules.daemon.model import DaemonRuntime

    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None or not _runtime_heartbeat_is_fresh(runtime):
        if runtime is not None and runtime.status == "online":
            runtime.status = "offline"
            runtime.updated_at = datetime.now(UTC)
            session.add(runtime)
            await session.commit()
        raise DaemonClientNoActiveSession(
            "需要在线 daemon 才能在客户端工作区创建变更。",
            details={
                "workspace_id": str(workspace_id),
                "runtime_id": str(runtime_id),
                "reason": "runtime_offline",
            },
        )

    change_key = _build_change_key(title)
    now = datetime.now(UTC)
    author = str(user_id)
    files = _build_files(
        change_key=change_key,
        title=title,
        description=description,
        change_type=change_type,
        author=author,
        now=now,
    )

    # 下发 change-write 任务（status='pending'）。claim_token=None，daemon claim 时生成。
    change_write = DaemonChangeWrite(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        change_key=change_key,
        files=files,
        status="pending",
    )
    session.add(change_write)
    await session.commit()
    await session.refresh(change_write)

    log.info(
        "proxy_change_write_dispatched",
        change_write_id=str(change_write.id),
        workspace_id=str(workspace_id),
        runtime_id=str(runtime_id),
        change_key=change_key,
    )

    # 等回执（轮询，超时 60s 翻 failed + 抛错）。
    cw = await _await_change_write_receipt(session, change_write.id)
    if cw.status != "done":
        raise ChangeWriteError(
            "daemon 写 change 失败。",
            details={
                "change_write_id": str(cw.id),
                "error": cw.error or "unknown",
            },
        )

    # 回执 ok → 落 Change + ChangeDocument 行（path 相对 spec_root，扁平 changes/<key>/）。
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=title,
        status="active",
        location="active",
        path=f"changes/{change_key}",
        affected_components=[],
        change_type=change_type,
        owner_id=user_id,
        current_stage="draft",
        stages={"draft": {"status": "done", "at": now.isoformat()}},
    )
    session.add(change)

    for f in files:
        # files 项的 path 形如 'changes/<key>/MASTER.md'；doc_type 在 _build_files
        # 内显式标注（与落库的 master/proposal/request 对齐）。
        doc_type = f["doc_type"]
        doc = ChangeDocument(
            id=uuid.uuid4(),
            change_id=change.id,
            doc_type=doc_type,
            path=f["path"],
            exists=True,
            last_modified_at=now,
        )
        session.add(doc)

    await session.commit()
    await session.refresh(change)

    log.info(
        "proxy_change_created",
        change_id=str(change.id),
        change_key=change_key,
        workspace_id=str(workspace_id),
        runtime_id=str(runtime_id),
        current_stage="draft",
    )
    return change
