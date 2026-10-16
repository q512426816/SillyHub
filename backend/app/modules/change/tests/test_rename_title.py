"""PATCH /api/workspaces/{ws}/changes/{cid}/title 平台改名入口测试。

Change 2026-10-16-change-title-condense-backfill task-06（FR-05，用户口径
2026-10-16：允许管理员/平台责任人/变更责任人重命名 title，10-30 字必须）：

- 权限矩阵：owner 本人 200 / 非 owner 持 change:archive 200 / 非 owner 无权限
  403（delete_change 同款三元组组合）；
- 带宽校验：strip 后 10-30 字之内（<10 或 >30 → 422 change_title_length_invalid，
  错误信息带当前字数与带宽说明）；strip 本身生效（两端空白不占字数）；
- 语义：改名后行 title/updated_at 更新 + change_events[rename] 审计
  （detail 四字段 renamed_by/old_title/new_title/change_key）；
- 不存在 404（resource-hiding）/ 已删行 409（code=change_deleted）。

测试范式照 test_delete_change.py（真实建 Role/RolePermission/UserWorkspaceRole
跑真实 SQL，不 mock service）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.change.model import Change, ChangeEventORM
from app.modules.workspace.model import Workspace

#: 合法带宽内的改名样例（12 字，用户口径：10-30 必须、建议约 20）
_VALID_TITLE = "用户登录态莫名失效的双侧治理"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db_session: AsyncSession) -> tuple[User, str]:
    """普通用户 + JWT（test_delete_change._make_user 同款）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"rename-change-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _grant_archive_role(db_session: AsyncSession, *, user: User, ws: Workspace) -> None:
    """给 user 授 change:archive（workspace_owner 等价形态，test_delete_change 同款）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"title_renamer_{uuid.uuid4().hex[:6]}",
        name="Title Renamer",
        description="test role with change:archive",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission="change:archive"))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _make_env(
    db_session: AsyncSession,
    *,
    owner_id: uuid.UUID | None = None,
    title: str | None = None,
    location: str = "active",
) -> dict:
    """建 workspace + 变更行（改名不触镜像文件，无需 spec workspace/manifest）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"rename-ws-{uuid.uuid4().hex[:6]}",
        slug=f"rename-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/rename-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key="2026-10-16-rename-me",
        title=title or "2026-10-16-rename-me",
        status="active",
        location=location,
        path="changes/2026-10-16-rename-me",
        owner_id=owner_id,
        current_stage="execute",
    )
    db_session.add(ws)
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(ws)
    await db_session.refresh(change)
    return {"ws": ws, "change": change}


async def _rename(client, token: str, ws_id: uuid.UUID, cid: uuid.UUID, title: str):
    return await client.patch(
        f"/api/workspaces/{ws_id}/changes/{cid}/title",
        headers=_headers(token),
        json={"title": title},
    )


async def _get_change(db_session: AsyncSession, cid: uuid.UUID) -> Change:
    row = (await db_session.execute(select(Change).where(Change.id == cid))).scalars().one()
    await db_session.refresh(row)
    return row


class TestRenamePermissionMatrix:
    async def test_owner_can_rename(self, client, db_session) -> None:
        """owner 本人（无任何角色）→ 200，行 title/updated_at 更新 + rename 事件。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id)
        old_updated = env["change"].updated_at

        resp = await _rename(client, token, env["ws"].id, env["change"].id, _VALID_TITLE)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == _VALID_TITLE
        assert body["change_key"] == "2026-10-16-rename-me"

        row = await _get_change(db_session, env["change"].id)
        assert row.title == _VALID_TITLE
        assert row.updated_at > old_updated
        event = (
            (
                await db_session.execute(
                    select(ChangeEventORM).where(
                        ChangeEventORM.change_id == env["change"].id,
                        ChangeEventORM.event_type == "rename",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert event.detail["new_title"] == _VALID_TITLE
        assert event.detail["old_title"] == "2026-10-16-rename-me"
        assert event.detail["renamed_by"] == str(owner.id)
        assert event.detail["change_key"] == "2026-10-16-rename-me"

    async def test_non_owner_with_archive_permission_200(self, client, db_session) -> None:
        """非 owner 持 change:archive（平台责任人等价形态）→ 200。"""
        _owner, _owner_token = await _make_user(db_session)
        manager, manager_token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=_owner.id)
        await _grant_archive_role(db_session, user=manager, ws=env["ws"])

        resp = await _rename(client, manager_token, env["ws"].id, env["change"].id, _VALID_TITLE)
        assert resp.status_code == 200, resp.text
        assert (await _get_change(db_session, env["change"].id)).title == _VALID_TITLE

    async def test_platform_admin_200(self, client, db_session) -> None:
        """平台管理员（is_platform_admin，has_permission 短路）→ 200。"""
        _owner, _owner_token = await _make_user(db_session)
        admin = User(
            id=uuid.uuid4(),
            email=f"rename-admin-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("x"),
            status="active",
            is_platform_admin=True,
        )
        db_session.add(admin)
        await db_session.commit()
        await db_session.refresh(admin)
        token, _ = create_access_token(
            user_id=admin.id,
            email=admin.email,
            is_admin=admin.is_platform_admin,
            settings=get_settings(),
        )
        env = await _make_env(db_session, owner_id=_owner.id)

        resp = await _rename(client, token, env["ws"].id, env["change"].id, _VALID_TITLE)
        assert resp.status_code == 200, resp.text

    async def test_non_owner_without_permission_403(self, client, db_session) -> None:
        """非 owner 无 change:archive → 403，行 title 不变。"""
        _owner, _owner_token = await _make_user(db_session)
        _stranger, stranger_token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=_owner.id)

        resp = await _rename(client, stranger_token, env["ws"].id, env["change"].id, _VALID_TITLE)
        assert resp.status_code == 403
        assert (await _get_change(db_session, env["change"].id)).title == ("2026-10-16-rename-me")

    async def test_missing_change_404(self, client, db_session) -> None:
        """行不存在 → 404（resource-hiding）。"""
        user, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=user.id)

        resp = await _rename(client, token, env["ws"].id, uuid.uuid4(), _VALID_TITLE)
        assert resp.status_code == 404


class TestRenameValidation:
    async def test_strip_then_validate(self, client, db_session) -> None:
        """strip 先行：两端空白不占字数，strip 后落带内 → 200 且落库为 strip 值。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id)

        resp = await _rename(client, token, env["ws"].id, env["change"].id, f"  {_VALID_TITLE}  ")
        assert resp.status_code == 200, resp.text
        assert (await _get_change(db_session, env["change"].id)).title == _VALID_TITLE

    async def test_too_short_422(self, client, db_session) -> None:
        """strip 后 <10 字 → 422 change_title_length_invalid，提示带宽。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id)

        resp = await _rename(client, token, env["ws"].id, env["change"].id, "标题太短了")
        assert resp.status_code == 422
        body = resp.json()
        assert body.get("code") == "change_title_length_invalid" or "10-30" in str(body)
        assert (await _get_change(db_session, env["change"].id)).title == ("2026-10-16-rename-me")

    async def test_too_long_422(self, client, db_session) -> None:
        """strip 后 >30 字 → 422。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id)

        resp = await _rename(
            client,
            token,
            env["ws"].id,
            env["change"].id,
            "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超",
        )
        assert resp.status_code == 422

    async def test_boundary_lengths_ok(self, client, db_session) -> None:
        """边界 10 字与 30 字 → 200（带宽含端点）。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id)

        resp = await _rename(client, token, env["ws"].id, env["change"].id, "十个字整的标题啊呀吧")
        assert resp.status_code == 200, resp.text
        resp = await _rename(
            client,
            token,
            env["ws"].id,
            env["change"].id,
            "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十",
        )
        assert resp.status_code == 200, resp.text

    async def test_deleted_change_409(self, client, db_session) -> None:
        """已删行（location='deleted'）→ 409 code=change_deleted。"""
        owner, token = await _make_user(db_session)
        env = await _make_env(db_session, owner_id=owner.id, location="deleted")

        resp = await _rename(client, token, env["ws"].id, env["change"].id, _VALID_TITLE)
        assert resp.status_code == 409
        assert resp.json().get("code") == "change_deleted"
