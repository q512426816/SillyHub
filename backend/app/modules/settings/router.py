"""``/api/settings`` and ``/api/users`` — platform configuration & user management."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.core.logging import get_logger
from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.settings.model import PlatformSetting
from app.modules.settings.schema import (
    SettingRead,
    SettingsBulkRead,
    SettingsUpdateRequest,
    SettingsUpdateResponse,
    UserCreateRequest,
    UserListResponse,
    UserRead,
    UserUpdateRequest,
)

log = get_logger(__name__)
router = APIRouter(tags=["settings"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


# ── Platform settings ──────────────────────────────────────────────────


@router.get("/settings", response_model=SettingsBulkRead)
async def list_settings(
    session: SessionDep,
    _user: CurrentUser,
) -> SettingsBulkRead:
    rows = (await session.execute(select(PlatformSetting))).scalars().all()
    return SettingsBulkRead(
        settings=[SettingRead(key=r.key, value=r.value, updated_at=r.updated_at) for r in rows],
    )


@router.put("/settings", response_model=SettingsUpdateResponse)
async def update_settings(
    payload: SettingsUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> SettingsUpdateResponse:
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    updated: list[str] = []
    for key, value in payload.settings.items():
        existing = await session.get(PlatformSetting, key)
        if existing is not None:
            existing.value = value
            existing.updated_by = user.id
            existing.updated_at = now
            session.add(existing)
        else:
            session.add(
                PlatformSetting(
                    key=key,
                    value=value,
                    updated_by=user.id,
                    updated_at=now,
                )
            )
        updated.append(key)
    await session.commit()
    return SettingsUpdateResponse(updated=updated)


# ── User management ────────────────────────────────────────────────────


@router.get("/users", response_model=UserListResponse)
async def list_users(
    session: SessionDep,
    _user: CurrentUser,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> UserListResponse:
    base = select(User).where(col(User.deleted_at).is_(None))
    if status_filter:
        base = base.where(col(User.status) == status_filter)

    total_q = select(func.count()).select_from(base.subquery())
    total = (await session.execute(total_q)).scalar() or 0

    rows = (
        (
            await session.execute(
                base.order_by(col(User.created_at).desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )

    return UserListResponse(
        items=[UserRead.model_validate(u) for u in rows],
        total=total,
    )


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreateRequest,
    session: SessionDep,
    _user: CurrentUser,
) -> User:
    import uuid as _uuid
    from datetime import UTC, datetime

    pw_hash = password_hasher.hash(payload.password)
    new_user = User(
        id=_uuid.uuid4(),
        email=payload.email.lower().strip(),
        password_hash=pw_hash,
        display_name=payload.display_name or payload.email.split("@", 1)[0],
        status="active",
        is_platform_admin=payload.is_platform_admin,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(new_user)
    await session.commit()
    await session.refresh(new_user)
    log.info("settings.user_created", email=new_user.email, user_id=str(new_user.id))
    return new_user


@router.patch("/users/{user_id}", response_model=UserRead)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    session: SessionDep,
    _user: CurrentUser,
) -> User:
    from datetime import UTC, datetime

    target = await session.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.display_name is not None:
        target.display_name = payload.display_name
    if payload.is_platform_admin is not None:
        target.is_platform_admin = payload.is_platform_admin
    if payload.status is not None:
        target.status = payload.status
    target.updated_at = datetime.now(UTC)
    session.add(target)
    await session.commit()
    await session.refresh(target)
    return target


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    session: SessionDep,
    _user: CurrentUser,
) -> None:
    from datetime import UTC, datetime

    target = await session.get(User, user_id)
    if target is None:
        return
    target.deleted_at = datetime.now(UTC)
    target.status = "deleted"
    session.add(target)
    await session.commit()
