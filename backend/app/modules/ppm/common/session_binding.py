"""PPM 任务/问题 ↔ 会话绑定基座（change 2026-08-28-session-ppm-task-binding task-01）。

design §5 Phase 1 / §7 / §8 / §9：

- 表 ``ppm_item_session_links``（D-005@v1 单表 kind 绑定）：``kind`` 区分
  ``plan_task``（个人计划任务）/ ``problem``（问题清单），``item_id`` **软关联无
  FK**（对齐 ``QuicklogSessionLink`` 模式——PPM 数据可由同步写入，硬 FK 会拦删除），
  ``session_id`` FK→agent_sessions(id) ON DELETE CASCADE，``workspace_id`` 为 item
  所属项目第一个关联工作区的快照（可空：项目无关联工作区时留空，D-004@v2）。
- ``bind_session_to_ppm_item``：幂等 upsert（savepoint 自吞，对齐
  ``change/binding.py`` best-effort 风格）。本模块不接线任何写入方（create/inject
  通道归 task-02）。
- ``resolve_item_workspace_id``：item.project_id → ``ppm_project_workspace`` 按
  workspace_id 升序取第一个（D-004@v2：表无时间列且现有查询无排序，显式定死
  排序键，前端预选与后端 link 写入同键）。
- ``load_ppm_item`` / ``load_item_files``：item 与 File 元数据读取 helper，供
  task-02 校验 / task-03 上下文前导与附件物化消费。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, UniqueConstraint, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import Field, col

from app.core.logging import get_logger
from app.models.base import BaseModel
from app.modules.file.model import File
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask
from app.modules.workspace.model import PpmProjectWorkspace

log = get_logger(__name__)

#: 绑定条目类型（design §7）：``plan_task``=个人计划任务，``problem``=问题清单。
PpmItemKind = Literal["plan_task", "problem"]


class PpmItemSessionLink(BaseModel, table=True):
    """PPM 任务/问题-会话绑定（2026-08-28-session-ppm-task-binding / D-005@v1）。

    多对多：一条任务/问题可关联多会话、一会话可关联多条目，幂等 upsert 由
    ``unique(kind, item_id, session_id)`` 兜底。

    - ``kind`` + ``item_id`` 软关联 ``ppm_plan_task``/``ppm_problem_list``，**无
      FK**（对齐 ``QuicklogSessionLink`` 模式，change/model.py:291——PPM 数据可由
      同步写入，硬 FK 会拦删除；条目先删后绑/已删条目残留 link 不报错，消费侧
      JOIN 自然过滤）。
    - ``session_id`` FK→agent_sessions(id) ON DELETE CASCADE：会话删除清绑定。
    - ``workspace_id`` 为创建时解析的项目第一个关联工作区快照（D-004@v2 升序
      第一个），**可空**且无 FK——纯快照值，行生命周期由 session_id CASCADE
      兜底，不值得为它引入对 workspaces 的删除联动。
    - 索引 ``ix_ppm_item_session_link_item(kind, item_id)`` 供条目→会话列表查询
      （GET /api/ppm/item-sessions）。
    """

    __tablename__ = "ppm_item_session_links"
    __table_args__ = (
        UniqueConstraint(
            "kind",
            "item_id",
            "session_id",
            name="uq_ppm_item_session_link_pair",
        ),
        Index("ix_ppm_item_session_link_item", "kind", "item_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    kind: str = Field(sa_column=Column(String(20), nullable=False))
    item_id: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), nullable=False),
    )
    session_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


async def bind_session_to_ppm_item(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID | None,
    kind: PpmItemKind,
    item_id: uuid.UUID,
    session_id: uuid.UUID,
) -> None:
    """把会话绑到 PPM 任务/问题（幂等 best-effort，design §5 Phase 1 / §7）。

    - 按 ``(kind, item_id, session_id)`` 自然键查 ``PpmItemSessionLink``，存在即
      返回，否则插行（unique 约束兜底并发）。
    - 整体 savepoint（``begin_nested``）+ flush 落行，**不自行 commit**（跟随
      调用方事务）；失败仅 ``log.warning`` 不抛（对齐
      ``change/binding.py:bind_session_to_quicklog`` 风格——绑定是旁路动作，
      不阻塞会话创建/追问主流程）。
    - ``workspace_id`` 由调用方先经 :func:`resolve_item_workspace_id` 解析传入
      （D-004@v2 同键）。
    """
    try:
        async with db.begin_nested():
            link = (
                await db.execute(
                    select(PpmItemSessionLink).where(
                        PpmItemSessionLink.kind == kind,
                        PpmItemSessionLink.item_id == item_id,
                        PpmItemSessionLink.session_id == session_id,
                    )
                )
            ).scalar_one_or_none()
            if link is not None:
                return
            db.add(
                PpmItemSessionLink(
                    id=uuid.uuid4(),
                    kind=kind,
                    item_id=item_id,
                    session_id=session_id,
                    workspace_id=workspace_id,
                )
            )
            await db.flush()
    except Exception as exc:
        log.warning(
            "ppm.item_session_bind_failed",
            kind=kind,
            item_id=str(item_id),
            session_id=str(session_id),
            error=str(exc),
        )


async def resolve_item_workspace_id(
    db: AsyncSession,
    kind: PpmItemKind,
    item_id: uuid.UUID,
) -> uuid.UUID | None:
    """解析 item 所属项目第一个关联工作区（D-004@v2，design §5 Phase 1）。

    链路：load item → ``item.project_id`` → 查 ``ppm_project_workspace``
    （workspace/model.py:181）按 **workspace_id 升序** 取第一个（表无时间列且
    现有查询无排序，排序键显式定死——前端预选（task-03）与后端 link 写入
    （task-02）同键，保证两侧解析一致）。

    item 不存在、item 无 project_id（PlanTask.project_id 可空）或项目无关联
    工作区 → 返回 ``None``（不抛，调用方留空不阻塞，design §9）。
    """
    item = await load_ppm_item(db, kind, item_id)
    if item is None:
        return None
    project_id = getattr(item, "project_id", None)
    if project_id is None:
        return None
    workspace_id = (
        await db.execute(
            select(PpmProjectWorkspace.workspace_id)
            .where(PpmProjectWorkspace.ppm_project_id == project_id)
            .order_by(PpmProjectWorkspace.workspace_id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return workspace_id


async def load_ppm_item(
    db: AsyncSession,
    kind: PpmItemKind,
    item_id: uuid.UUID,
) -> PlanTask | PpmProblemList | None:
    """按 kind 读 PPM 条目行（design §7；查无返回 None 不抛）。

    ``kind="plan_task"`` 按 id 查 ``ppm/task/model.py:PlanTask``；
    ``kind="problem"`` 按 id 查 ``ppm/problem/model.py:PpmProblemList``。
    item 不存在/已删 → None，调用方降级（design §9：创建会话不报错）。
    """
    # 按 kind 分支各自具体类型查询：联合 `type[PlanTask] | type[PpmProblemList]`
    # 变量进 select() 会被 SQLAlchemy 类型重载归并到公共基类，返回类型不符（mypy return-value）。
    if kind == "plan_task":
        stmt = select(PlanTask).where(PlanTask.id == item_id)
    else:
        stmt = select(PpmProblemList).where(PpmProblemList.id == item_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def load_item_files(
    db: AsyncSession,
    kind: PpmItemKind,
    item_id: uuid.UUID,
) -> list[File]:
    """读 item.file_urls 对应的存活 File 行（design §5 Phase 2 读取 helper）。

    - 逐条 uuid 解析：非 uuid 条目跳过（R-03：file_urls 历史数据混有旧 URL
      字符串），缺号/已软删行由 SQL 过滤自然剔除。
    - 仅返回 ``deleted_at IS NULL`` 的存活行（file/model.py:24 软删语义）；
    item 不存在或无有效 file id → 空列表（不抛）。

    访问控制（D-007 ``_can_access`` 口径）不在本 helper 职责内——归 task-03
    物化层判定，无权条目走文字清单降级。
    """
    item = await load_ppm_item(db, kind, item_id)
    if item is None:
        return []
    file_ids: list[uuid.UUID] = []
    for entry in item.file_urls or []:
        if isinstance(entry, uuid.UUID):
            file_ids.append(entry)
            continue
        if isinstance(entry, str):
            try:
                file_ids.append(uuid.UUID(entry))
            except ValueError:
                # R-03：历史数据混有旧 URL 字符串，非 file_id 直接跳过。
                continue
    if not file_ids:
        return []
    rows = (
        await db.execute(
            select(File).where(
                col(File.id).in_(file_ids),
                col(File.deleted_at).is_(None),
            )
        )
    ).scalars()
    return list(rows)
