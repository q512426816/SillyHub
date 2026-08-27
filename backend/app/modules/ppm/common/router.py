"""ppm common 子域 API 端点 —— 平台级,统一前缀 ``/api/ppm``（main.py 挂载）。

权限:统一 ``Depends(get_current_principal)`` 仅认证不授权（登录用户或合法
API key 的 daemon 即可调用,平台级）,对齐 ppm/task/router.py 口径。

2026-08-28-session-ppm-task-binding task-01（design §5 Phase 1 / §7）：
``GET /api/ppm/item-sessions?kind=&item_id=`` —— 列出某 PPM 任务/问题关联的
会话,响应结构与 ``GET /changes/{id}/sessions``（change/router.py
``list_change_sessions``）同构,复用 daemon/schema.py 的 ``AgentSessionListItem``
（author 展示名 + 首条 user_input 标题摘要 + last_active_at desc）。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import get_current_principal
from app.core.db import get_session
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.schema import AgentSessionListItem, ChangeSessionAuthor
from app.modules.ppm.common.session_binding import PpmItemSessionLink

# 前缀由 ``app.main`` 统一以 ``prefix="/api/ppm"`` 挂载,本 router 不自带 prefix
# (对齐 ppm/task/router.py 挂载形态)。
router = APIRouter(tags=["ppm-common"])

# 依赖类型别名 (Annotated 风格,避免 Annotated + default 混用冲突)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
AuthUser = Annotated[User, Depends(get_current_principal)]

# 条目→会话列表固定取最新 N 条（对齐 change/router.py _CHANGE_SESSIONS_MAX 的
# ql-20260826-012 口径：任务/问题挂的会话随使用无限增长,200 覆盖卡片可视列表）。
_PPM_ITEM_SESSIONS_MAX = 200

# kind 校验 Literal（design §7）：非法值 FastAPI 422,与 ppm 既有查询参数口径一致。
PpmItemKindQuery = Literal["plan_task", "problem"]


async def _fetch_session_titles(
    db: AsyncSession, session_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """批量取会话标题：每会话最早一条 channel=user_input 摘要（前 30 字）。

    口径同源 change/router.py ``_fetch_session_titles``（2026-08-25-session-spec-
    binding X-13 共享 helper）：本模块不 import 私有 helper（change router 是
    workspace-scoped 前缀,ppm 平台级跨包耦合私有符号不合适）,按同款实现仿写,
    行为一致——窗口函数 ROW_NUMBER 分区取首条,值按前 30 字截断,空文本归一
    None;未命中会话不出现在映射,调用方 ``get`` 默认 None。
    """
    if not session_ids:
        return {}
    rn = (
        func.row_number()
        .over(
            partition_by=AgentRun.agent_session_id,
            order_by=(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()),
        )
        .label("rn")
    )
    title_subq = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.content_redacted.label("content"),
            rn,
        )
        .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
        .where(
            col(AgentRun.agent_session_id).in_(session_ids),
            col(AgentRunLog.channel) == "user_input",
        )
        .subquery()
    )
    title_rows = (
        await db.execute(
            select(title_subq.c.session_id, title_subq.c.content).where(title_subq.c.rn == 1)
        )
    ).all()
    return {row.session_id: (row.content or "")[:30] or None for row in title_rows}


@router.get("/item-sessions", response_model=list[AgentSessionListItem])
async def list_ppm_item_sessions(
    session: SessionDep,
    _user: AuthUser,
    kind: PpmItemKindQuery = Query(..., description="PPM 条目类型：plan_task/problem"),
    item_id: uuid.UUID = Query(
        ..., description="PPM 条目 id（ppm_plan_task/ppm_problem_list 主键）"
    ),
) -> list[AgentSessionListItem]:
    """列出某 PPM 任务/问题关联的全部会话（design §5 Phase 1 / §7 / FR-01）。

    数据源 ``ppm_item_session_links`` JOIN ``agent_sessions``（软删过滤）,响应
    同构 ``list_change_sessions``：id/provider/status/turn_count/mode/author/
    last_active_at/title。无关联返回空列表（不 404——任务刚建、尚无会话是常态,
    design §9）。``kind`` 非法值由 Literal 校验 422。
    """
    # 1. links JOIN agent_sessions（跨成员,平台级无 workspace 过滤）。unique
    #    (kind, item_id, session_id) 使同一 (条目, 会话) 至多一行 link,JOIN 不会
    #    产生重复会话行,无需 distinct。
    sessions = (
        (
            await session.execute(
                select(AgentSession)
                .join(PpmItemSessionLink, PpmItemSessionLink.session_id == AgentSession.id)
                .where(
                    PpmItemSessionLink.kind == kind,
                    PpmItemSessionLink.item_id == item_id,
                    col(AgentSession.deleted_at).is_(None),  # 软删过滤（同 change 侧）
                )
                .order_by(col(AgentSession.last_active_at).desc().nulls_last())
                .limit(_PPM_ITEM_SESSIONS_MAX)
            )
        )
        .scalars()
        .all()
    )
    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    user_ids = {s.user_id for s in sessions}

    # 2. 批量取作者展示名（避免 N+1）。
    users = (await session.execute(select(User).where(col(User.id).in_(user_ids)))).scalars().all()
    user_name_map: dict[uuid.UUID, str | None] = {u.id: u.display_name for u in users}

    # 3. 批量取标题（口径同源 change 侧 _fetch_session_titles,见上方 helper）。
    titles = await _fetch_session_titles(session, session_ids)

    # 4. 组装 + 按 last_active_at desc 排序（Python 排序规避 PG/SQLite 方言差异）。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=titles.get(s.id),
        )
        for s in sessions
    ]
    items.sort(
        key=lambda x: x.last_active_at or datetime.min,
        reverse=True,
    )
    return items
