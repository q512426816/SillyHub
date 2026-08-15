"""Incident 状态机转换校验（design §5 A1/A2 / D-001/002/006）。

覆盖：
- 合法转换（放宽版图 INCIDENT_TRANSITIONS 全部边）成功；
- 非法转换抛 InvalidTransition（422），状态不变；
- 同状态幂等（D-006，不抛、不维护字段）；
- 非法 status 值仍先返 400（IncidentError，校验顺序 D-006）；
- resolved 进设 resolved_at/by，离开（重开→investigating）清字段（D-002）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition
from app.modules.incident.schema import IncidentCreate, IncidentUpdate
from app.modules.incident.service import IncidentError, IncidentService

# ── helpers（与 test_service.py 同构，独立定义避免跨测试模块 import）─────────


async def _make_workspace(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="FSM WS",
            slug=f"fsm-ws-{ws_id.hex[:8]}",
            root_path="/tmp/fsm",
            status="active",
        )
    )
    await db_session.commit()
    return ws_id


async def _make_user(db_session: AsyncSession) -> uuid.UUID:
    from app.core.security import password_hasher
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"fsm-{user_id.hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="FSM",
            status="active",
            is_platform_admin=True,
        )
    )
    await db_session.commit()
    return user_id


async def _make_incident(db_session: AsyncSession):
    """新建 open 态 incident，返回 (svc, incident, user_id)。"""
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)
    svc = IncidentService(db_session)
    inc = await svc.create(ws_id, user_id, IncidentCreate(title="Inc", severity="high"))
    return svc, inc, user_id


# 合法路径：把 open 态 incident 推进到指定 status（仅用合法边）。
_LEGAL_DRIVE = {
    "open": [],
    "investigating": ["investigating"],
    "mitigated": ["investigating", "mitigated"],
    "resolved": ["resolved"],  # open→resolved 合法
}


async def _drive_to(svc: IncidentService, inc, target: str):
    for status in _LEGAL_DRIVE[target]:
        inc = await svc.update(inc.id, IncidentUpdate(status=status))
    return inc


# ── 合法转换 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "current,target",
    [
        ("open", "investigating"),
        ("open", "resolved"),
        ("investigating", "mitigated"),
        ("investigating", "open"),
        ("investigating", "resolved"),
        ("mitigated", "resolved"),
        ("mitigated", "investigating"),
        ("resolved", "investigating"),
    ],
)
async def test_legal_transition_succeeds(db_session: AsyncSession, current: str, target: str):
    svc, inc, _ = await _make_incident(db_session)
    inc = await _drive_to(svc, inc, current)
    updated = await svc.update(inc.id, IncidentUpdate(status=target))
    assert updated.status == target


# ── 非法转换 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "current,target",
    [
        ("open", "mitigated"),  # 跳过 investigating
        ("resolved", "open"),  # 终态仅可重开→investigating
        ("resolved", "mitigated"),
        ("resolved", "resolved"),  # 同态走幂等分支（非非法，单独测）
        ("mitigated", "open"),  # 缺边
        ("investigating", "investigating"),  # 同态幂等
    ],
)
async def test_illegal_transition_rejected(db_session: AsyncSession, current: str, target: str):
    if current == target:
        pytest.skip("同态幂等单独测（test_same_status_idempotent）")
    svc, inc, _ = await _make_incident(db_session)
    inc = await _drive_to(svc, inc, current)
    with pytest.raises(InvalidTransition):
        await svc.update(inc.id, IncidentUpdate(status=target))
    # 状态不变
    fresh = await svc.get(inc.id)
    assert fresh.status == current


async def test_same_status_idempotent(db_session: AsyncSession):
    """同状态 update 幂等（D-006）：不抛、状态不变、不维护 resolved 字段。"""
    svc, inc, _ = await _make_incident(db_session)
    inc = await _drive_to(svc, inc, "resolved")  # resolved_at/by 已设
    assert inc.resolved_at is not None
    updated = await svc.update(inc.id, IncidentUpdate(status="resolved"))  # 同态
    assert updated.status == "resolved"
    # 重开清字段未触发；resolved_at 仍在（幂等不维护）
    assert updated.resolved_at is not None


async def test_invalid_status_value_returns_400_not_422(db_session: AsyncSession):
    """非法 status 值先于转换校验（D-006 顺序）：IncidentError(400)，非 InvalidTransition。"""
    svc, inc, _ = await _make_incident(db_session)
    with pytest.raises(IncidentError, match="状态取值非法"):
        await svc.update(inc.id, IncidentUpdate(status="bogus"))


async def test_resolve_sets_resolved_fields(db_session: AsyncSession):
    svc, inc, user_id = await _make_incident(db_session)
    updated = await svc.update(inc.id, IncidentUpdate(status="resolved", resolved_by=str(user_id)))
    assert updated.status == "resolved"
    assert updated.resolved_at is not None
    assert updated.resolved_by == user_id


async def test_reopen_clears_resolved_fields(db_session: AsyncSession):
    """resolved→investigating（重开）清 resolved_at/by（D-002）。"""
    svc, inc, user_id = await _make_incident(db_session)
    inc = await svc.update(inc.id, IncidentUpdate(status="resolved", resolved_by=str(user_id)))
    assert inc.resolved_at is not None and inc.resolved_by is not None

    reopened = await svc.update(inc.id, IncidentUpdate(status="investigating"))
    assert reopened.status == "investigating"
    assert reopened.resolved_at is None
    assert reopened.resolved_by is None
