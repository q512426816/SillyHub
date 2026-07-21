"""项目计划 project_manager_name 后端兜底回填单测 (quick-c90ed652)。

背景:前端表单 project_manager_name 是隐藏字段,靠下拉 options 反查回填,
偶发漏传(选了项目经理只带 id 不带 name)导致落库 name 为空,列表只能裸露 UUID。
本文件验证后端在 create/update 时按 project_manager_id 反查 users.display_name
兜底补上 name 的行为。

口径说明:用 ``User.display_name`` (与 2026-07-21 生产数据回填 SQL 同口径),
而非 ``_lookup_user_name`` (查 PpmProjectMember.user_name,项目成员冗余,口径不同)。

使用根 conftest 的 in-memory SQLite ``db_session`` fixture。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.ppm.plan.service import PlanService


def _now() -> datetime:
    return datetime.now(UTC)


async def _seed_user(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    display_name: str | None,
) -> User:
    """建一个 users 行,供 project_manager_name 兜底反查。"""
    user = User(
        id=user_id,
        username=f"u{user_id.hex[:8]}",
        password_hash="x",
        display_name=display_name,
        status="active",
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ---------------------------------------------------------------------------
# create 兜底
# ---------------------------------------------------------------------------


async def test_create_backfills_manager_name_when_empty(db_session: AsyncSession) -> None:
    """create: 有 project_manager_id 但 name 为空 → 反查 display_name 补上。"""
    uid = uuid.uuid4()
    await _seed_user(db_session, user_id=uid, display_name="王鹏")

    plan = await PlanService(db_session).create_ps_project_plan(
        {"project_name": "兜底测试项目", "project_manager_id": uid, "project_manager_name": None}
    )

    assert plan.project_manager_id == uid
    assert plan.project_manager_name == "王鹏"


async def test_create_keeps_explicit_manager_name(db_session: AsyncSession) -> None:
    """create: 前端已显式传 name → 不覆盖,保持传入值。"""
    uid = uuid.uuid4()
    await _seed_user(db_session, user_id=uid, display_name="王鹏")

    plan = await PlanService(db_session).create_ps_project_plan(
        {
            "project_name": "显式名项目",
            "project_manager_id": uid,
            "project_manager_name": "前端传的名",
        }
    )

    assert plan.project_manager_name == "前端传的名"


async def test_create_backfills_when_name_blank_string(db_session: AsyncSession) -> None:
    """create: name 为空白字符串也视为空 → 兜底补上。"""
    uid = uuid.uuid4()
    await _seed_user(db_session, user_id=uid, display_name="孙虓")

    plan = await PlanService(db_session).create_ps_project_plan(
        {"project_name": "空白名项目", "project_manager_id": uid, "project_manager_name": "   "}
    )

    assert plan.project_manager_name == "孙虓"


async def test_create_unknown_manager_id_keeps_none(db_session: AsyncSession) -> None:
    """create: manager_id 在 users 里查不到 → name 保持 None,不抛错。"""
    uid = uuid.uuid4()  # 不 seed users

    plan = await PlanService(db_session).create_ps_project_plan(
        {"project_name": "未知经理项目", "project_manager_id": uid, "project_manager_name": None}
    )

    assert plan.project_manager_id == uid
    assert plan.project_manager_name is None


async def test_create_no_manager_id_no_backfill(db_session: AsyncSession) -> None:
    """create: 无 project_manager_id → 不兜底,name 保持 None。"""
    plan = await PlanService(db_session).create_ps_project_plan(
        {"project_name": "无经理项目", "project_manager_name": None}
    )

    assert plan.project_manager_id is None
    assert plan.project_manager_name is None


# ---------------------------------------------------------------------------
# update 兜底
# ---------------------------------------------------------------------------


async def test_update_backfills_manager_name_on_switch(db_session: AsyncSession) -> None:
    """update: 切换到新经理、name 传 None → 反查新经理 display_name 补上。

    _Crud.update 跳过 None 值,若不在 service 兜底,name 会残留旧值/None。
    """
    old_uid = uuid.uuid4()
    new_uid = uuid.uuid4()
    await _seed_user(db_session, user_id=old_uid, display_name="旧经理")
    await _seed_user(db_session, user_id=new_uid, display_name="新经理")

    plan = await PlanService(db_session).create_ps_project_plan(
        {
            "project_name": "切换经理项目",
            "project_manager_id": old_uid,
            "project_manager_name": "旧经理",
        }
    )

    # 前端切换经理只带 id,name 传 None(漏传)
    updated = await PlanService(db_session).update_ps_project_plan(
        plan.id, {"project_manager_id": new_uid, "project_manager_name": None}
    )

    assert updated.project_manager_id == new_uid
    assert updated.project_manager_name == "新经理"


async def test_update_keeps_explicit_manager_name(db_session: AsyncSession) -> None:
    """update: 显式传 name → 不覆盖。"""
    uid = uuid.uuid4()
    await _seed_user(db_session, user_id=uid, display_name="王鹏")
    plan = await PlanService(db_session).create_ps_project_plan(
        {"project_name": "更新显式名", "project_manager_id": uid, "project_manager_name": "王鹏"}
    )

    updated = await PlanService(db_session).update_ps_project_plan(
        plan.id, {"project_manager_name": "改名了"}
    )

    assert updated.project_manager_name == "改名了"
