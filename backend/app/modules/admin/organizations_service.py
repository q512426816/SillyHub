"""Organization management service.

Backend of ``/api/admin/organizations`` (change
``2026-06-16-admin-org-role-center`` task-05). Encapsulates the tree
shape, code uniqueness, and the delete-with-preconditions guard.

Tree semantics:

* ``list(parent_id=None)`` → flat list of every node (frontend builds
  the tree from ``parent_id`` pointers).
* ``list(parent_id=X)`` → direct children of X only (no grandchildren).
* ``get(X)`` → detail payload with ``children`` (direct) + aggregate
  counts in a single GROUP BY pass.

Delete is gated on:

* ``children_count == 0`` → otherwise :class:`OrganizationHasChildren`
* ``member_count == 0`` → otherwise :class:`OrganizationInUse`

Self-loop and descendant-cycle checks run on ``update`` so a parent
pointer cannot form a cycle by repointing at itself or its offspring.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import (
    OrganizationCodeDuplicate,
    OrganizationHasChildren,
    OrganizationInUse,
    OrganizationNotFound,
    OrganizationParentNotFound,
)
from app.modules.admin.model import Organization, UserOrganization
from app.modules.admin.schema import (
    OrganizationCreateRequest,
    OrganizationDetail,
    OrganizationRead,
    OrganizationUpdateRequest,
)


async def _descendant_ids(session: AsyncSession, root_id: uuid.UUID) -> set[uuid.UUID]:
    """Return IDs of every descendant of ``root_id`` (BFS via SQL).

    The org tree is shallow (single-digit depth in practice) so we
    expand iteratively rather than relying on a recursive CTE — that
    keeps the query plan portable across SQLite (tests) and Postgres.
    """
    discovered: set[uuid.UUID] = set()
    frontier: set[uuid.UUID] = {root_id}
    while frontier:
        rows = (
            (
                await session.execute(
                    select(col(Organization.id)).where(col(Organization.parent_id).in_(frontier))
                )
            )
            .scalars()
            .all()
        )
        new = {row for row in rows if row not in discovered}
        discovered |= frontier
        frontier = new - discovered
        if not new:
            break
    discovered.discard(root_id)
    return discovered


async def _counts(session: AsyncSession, org_id: uuid.UUID) -> tuple[int, int]:
    """Return ``(member_count, children_count)`` for ``org_id``."""
    member_count = (
        await session.execute(
            select(func.count())
            .select_from(UserOrganization.__table__)
            .where(UserOrganization.__table__.c.organization_id == org_id)
        )
    ).scalar_one()

    children_count = (
        await session.execute(
            select(func.count())
            .select_from(Organization.__table__)
            .where(Organization.__table__.c.parent_id == org_id)
        )
    ).scalar_one()

    return int(member_count), int(children_count)


async def _to_read(session: AsyncSession, org: Organization) -> OrganizationRead:
    members, children = await _counts(session, org.id)
    return OrganizationRead(
        id=org.id,
        name=org.name,
        code=org.code,
        description=org.description,
        parent_id=org.parent_id,
        status=org.status,  # type: ignore[arg-type]
        sort_order=org.sort_order,
        member_count=members,
        children_count=children,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


class OrganizationService:
    def __init__(self, session: AsyncSession, actor_id: uuid.UUID) -> None:
        self._session = session
        self._actor_id = actor_id

    async def list_organizations(
        self,
        *,
        parent_id: uuid.UUID | None = None,
        is_active: bool | None = None,
    ) -> list[OrganizationRead]:
        stmt = select(Organization)
        if parent_id is not None:
            stmt = stmt.where(col(Organization.parent_id) == parent_id)
        if is_active is not None:
            if is_active:
                stmt = stmt.where(col(Organization.status) == "active")
            else:
                stmt = stmt.where(col(Organization.status) == "disabled")

        rows = (
            (
                await self._session.execute(
                    stmt.order_by(
                        col(Organization.sort_order).asc(),
                        col(Organization.created_at).asc(),
                    )
                )
            )
            .scalars()
            .all()
        )

        return [await _to_read(self._session, org) for org in rows]

    async def get_organization(self, org_id: uuid.UUID) -> OrganizationDetail:
        org = await self._session.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound(f"Organization {org_id} not found.")

        base = await _to_read(self._session, org)

        children_rows = (
            (
                await self._session.execute(
                    select(Organization)
                    .where(col(Organization.parent_id) == org_id)
                    .order_by(
                        col(Organization.sort_order).asc(),
                        col(Organization.created_at).asc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        children = [await _to_read(self._session, child) for child in children_rows]
        return OrganizationDetail(**base.model_dump(), children=children)

    async def create_organization(self, payload: OrganizationCreateRequest) -> OrganizationRead:
        if payload.parent_id is not None:
            parent = await self._session.get(Organization, payload.parent_id)
            if parent is None:
                raise OrganizationParentNotFound(
                    f"Parent organization {payload.parent_id} not found."
                )

        existing = (
            (
                await self._session.execute(
                    select(Organization).where(col(Organization.code) == payload.code).limit(1)
                )
            )
            .scalars()
            .first()
        )
        if existing is not None:
            raise OrganizationCodeDuplicate(f"Organization code '{payload.code}' already exists.")

        org = Organization(
            name=payload.name,
            code=payload.code,
            description=payload.description,
            parent_id=payload.parent_id,
            status="active",
            sort_order=payload.sort_order,
        )
        self._session.add(org)
        await self._session.commit()
        await self._session.refresh(org)
        return await _to_read(self._session, org)

    async def update_organization(
        self, org_id: uuid.UUID, payload: OrganizationUpdateRequest
    ) -> OrganizationRead:
        org = await self._session.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound(f"Organization {org_id} not found.")

        if payload.parent_id is not None:
            if payload.parent_id == org_id:
                # Self-loop → treat as validation error (422).
                from app.core.errors import InvalidTransition

                raise InvalidTransition(
                    "Organization cannot be its own parent.",
                    details={"org_id": str(org_id)},
                )
            descendants = await _descendant_ids(self._session, org_id)
            if payload.parent_id in descendants:
                from app.core.errors import InvalidTransition

                raise InvalidTransition(
                    "Organization cannot be reparented under its own descendant.",
                    details={"org_id": str(org_id), "parent_id": str(payload.parent_id)},
                )
            parent = await self._session.get(Organization, payload.parent_id)
            if parent is None:
                raise OrganizationParentNotFound(
                    f"Parent organization {payload.parent_id} not found."
                )
            org.parent_id = payload.parent_id

        if payload.code is not None and payload.code != org.code:
            clash = (
                (
                    await self._session.execute(
                        select(Organization)
                        .where(col(Organization.code) == payload.code)
                        .where(col(Organization.id) != org_id)
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if clash is not None:
                raise OrganizationCodeDuplicate(
                    f"Organization code '{payload.code}' already exists."
                )
            org.code = payload.code

        if payload.name is not None:
            org.name = payload.name
        if payload.description is not None:
            org.description = payload.description
        if payload.sort_order is not None:
            org.sort_order = payload.sort_order

        self._session.add(org)
        await self._session.commit()
        await self._session.refresh(org)
        return await _to_read(self._session, org)

    async def disable_organization(self, org_id: uuid.UUID) -> OrganizationRead:
        org = await self._session.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound(f"Organization {org_id} not found.")
        org.status = "disabled"
        self._session.add(org)
        await self._session.commit()
        await self._session.refresh(org)
        return await _to_read(self._session, org)

    async def enable_organization(self, org_id: uuid.UUID) -> OrganizationRead:
        org = await self._session.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound(f"Organization {org_id} not found.")
        org.status = "active"
        self._session.add(org)
        await self._session.commit()
        await self._session.refresh(org)
        return await _to_read(self._session, org)

    async def delete_organization(self, org_id: uuid.UUID) -> None:
        org = await self._session.get(Organization, org_id)
        if org is None:
            raise OrganizationNotFound(f"Organization {org_id} not found.")

        members, children = await _counts(self._session, org_id)
        if children > 0:
            raise OrganizationHasChildren(children_count=children)
        if members > 0:
            raise OrganizationInUse(member_count=members)

        await self._session.delete(org)
        await self._session.commit()
