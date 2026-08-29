"""DELETE /api/workspaces/{ws}/changes/{cid} 平台删除入口测试。

Change 2026-08-29-change-delete-closure-and-spec-pull task-06（design §6 / FR-05a/b/c /
D-001@v1 / D-002@v1）：

- 权限矩阵（D-001@v1）：owner 本人 200 / 非 owner 持 change:archive 200 / 非 owner
  无权限 403 / owner_id 为空仅权限持有者可删 / 不存在 404 / 已删幂等 409；
- 服务顺序与副作用（design §6.1 步骤①-④）：镜像软删（文件入备份区 + manifest 三
  标记 + 目录消失）→ progress 行删 → Change 行软删（location='deleted' 不物理删，
  R-09）→ change_events[delete] 审计（detail 四字段）；
- 二次删除 409 且不产生第二个 delete 事件；
- 归档区行（location='archive'）删除走 changes/archive/{name}/ 前缀；
- enrich 前置过滤（design §6.2）：location='deleted' 行不再被 latest_progress 投影
  覆盖（archived 终态回翻 / stage_info / last_pushed_at 均不作用），active 对照锚
  行为不变。

镜像种子走「直写文件 + manifest 行」（不经 apply_ops，规避 reparse 副作用对
ux_changes 行的干扰）；权限测试真实建 Role/RolePermission/UserWorkspaceRole 行跑
真实 SQL（test_permission_scope.py 范式，不 mock service）。

author: qinyi
created_at: 2026-08-29
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.change.model import Change, ChangeEventORM
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.spec_workspace.model import SpecFileManifest, SpecWorkspace
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_user(db_session: AsyncSession) -> tuple[User, str]:
    """非管理员普通用户 + JWT（权限矩阵三态的基座，test_permission_scope.py 范式）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"del-change-{uuid.uuid4().hex[:8]}@example.com",
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
    """在该 workspace 内给 user 授 change:archive 权限（workspace_owner 角色等价形态）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"change_archiver_{uuid.uuid4().hex[:6]}",
        name="Change Archiver",
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
    tmp_path: Path,
    *,
    change_key: str = "del_me_change",
    owner_id: uuid.UUID | None = None,
    location: str = "active",
    with_mirror: bool = True,
) -> dict:
    """建 workspace + spec workspace + 变更行（+ 镜像文件/manifest 行）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"del-ws-{uuid.uuid4().hex[:6]}",
        slug=f"del-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/del-ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    spec_root = tmp_path / f"spec-root-{uuid.uuid4().hex[:6]}"
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=change_key,
        title=change_key,
        status="active",
        location=location,
        path=(
            f"changes/archive/{change_key}" if location == "archive" else f"changes/{change_key}"
        ),
        owner_id=owner_id,
        current_stage="execute",
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(ws)
    await db_session.refresh(change)

    if with_mirror:
        rels = (
            ("proposal.md", "p-content"),
            ("tasks/task-01.md", "t-content"),
        )
        for name, content in rels:
            rel = (
                f"changes/archive/{change_key}/{name}"
                if location == "archive"
                else f"changes/{change_key}/{name}"
            )
            target = spec_root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            db_session.add(
                SpecFileManifest(
                    id=uuid.uuid4(),
                    workspace_id=ws.id,
                    path=rel,
                    content_hash=hashlib.sha256(content.encode()).hexdigest(),
                    version=1,
                    exists=True,
                )
            )
        await db_session.commit()
    return {"ws": ws, "change": change, "spec_root": spec_root}


async def _seed_progress_row(
    db_session: AsyncSession, ws_id: uuid.UUID, change_key: str, *, status: str = "in_progress"
) -> None:
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws_id,
            change_name=change_key,
            latest_progress={
                "project": {"name": "demo"},
                "changes": [{"name": change_key, "current_stage": "verify", "status": status}],
                "stages": [],
                "steps": [],
                "batch_progress": [],
                "approvals": [],
            },
            last_pushed_at="2026-08-29T00:00:00Z",
            last_pusher="cli",
        )
    )
    await db_session.commit()


async def _delete_events(db_session: AsyncSession, change_id: uuid.UUID) -> list[ChangeEventORM]:
    return list(
        (
            await db_session.execute(
                select(ChangeEventORM).where(
                    ChangeEventORM.change_id == change_id,
                    ChangeEventORM.event_type == "delete",
                )
            )
        )
        .scalars()
        .all()
    )


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# ① 权限矩阵（D-001@v1：CHANGE_ARCHIVE 或 owner==当前用户，owner 空仅前者）
# ===========================================================================


class TestDeletePermissionMatrix:
    async def test_owner_can_delete_without_permission(self, client, db_session, tmp_path) -> None:
        """owner 本人（无任何角色/权限）→ 200。"""
        owner, owner_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{env['change'].id}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True

    async def test_non_owner_with_archive_permission_200(
        self, client, db_session, tmp_path
    ) -> None:
        """非 owner 持 change:archive（workspace_owner 角色等价形态）→ 200。"""
        owner, _owner_token = await _make_user(db_session)
        archiver, archiver_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)
        await _grant_archive_role(db_session, user=archiver, ws=env["ws"])

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{env['change'].id}",
            headers=_headers(archiver_token),
        )
        assert resp.status_code == 200, resp.text

    async def test_non_owner_without_permission_403(self, client, db_session, tmp_path) -> None:
        """非 owner 普通成员（无权限）→ 403，且零副作用（行不软删、无事件）。"""
        owner, _owner_token = await _make_user(db_session)
        _plain, plain_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)
        change_id = env["change"].id

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{change_id}",
            headers=_headers(plain_token),
        )
        assert resp.status_code == 403, resp.text
        db_session.expire_all()
        change = await db_session.get(Change, change_id)
        assert change is not None
        assert change.location == "active"
        assert await _delete_events(db_session, env["change"].id) == []

    async def test_null_owner_without_permission_403(self, client, db_session, tmp_path) -> None:
        """owner_id 为空 + 无权限用户 → 403（owner 路径不可用，仅权限持有者可删）。"""
        _plain, plain_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=None)

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{env['change'].id}",
            headers=_headers(plain_token),
        )
        assert resp.status_code == 403, resp.text

    async def test_null_owner_with_permission_200(self, client, db_session, tmp_path) -> None:
        """owner_id 为空 + change:archive 持有者 → 200。"""
        archiver, archiver_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=None)
        await _grant_archive_role(db_session, user=archiver, ws=env["ws"])

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{env['change'].id}",
            headers=_headers(archiver_token),
        )
        assert resp.status_code == 200, resp.text

    async def test_missing_change_404(self, client, db_session, tmp_path) -> None:
        """不存在的 change_id → 404。"""
        owner, owner_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{uuid.uuid4()}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 404, resp.text

    async def test_already_deleted_idempotent_409_no_second_event(
        self, client, db_session, tmp_path
    ) -> None:
        """行已 location='deleted' → 409 code=change_deleted（与 task-04 拒收口径
        一致），且不产生第二个 delete 事件。"""
        owner, owner_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)
        change = env["change"]
        change.location = "deleted"
        db_session.add(change)
        await db_session.commit()

        resp = await client.delete(
            f"/api/workspaces/{env['ws'].id}/changes/{change.id}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["code"] == "change_deleted"
        assert await _delete_events(db_session, change.id) == []


# ===========================================================================
# ② 服务顺序 + 副作用（design §6.1 步骤①-④）
# ===========================================================================


class TestDeleteServiceOrder:
    async def test_delete_success_full_effects(self, client, db_session, tmp_path) -> None:
        """成功删除：镜像软删→progress 删→location=deleted→审计事件，四段全落。"""
        owner, owner_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)
        ws, change, spec_root = env["ws"], env["change"], env["spec_root"]
        # 纯量先取（expire_all 后实例属性访问会触发同步懒加载）
        change_id, change_key, owner_id = change.id, change.change_key, owner.id
        await _seed_progress_row(db_session, ws.id, change_key)

        resp = await client.delete(
            f"/api/workspaces/{ws.id}/changes/{change_id}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["file_count"] == 2
        assert isinstance(body["backup_dir"], str) and body["backup_dir"]

        # ① 镜像软删：文件实际移入备份区（D-008：与 spec_root 兄弟目录）
        backup_root = Path(get_settings().spec_data_root) / "spec-backups" / str(ws.id)
        backup_dir = Path(body["backup_dir"])
        assert backup_dir == backup_root / backup_dir.name
        assert (backup_dir / "changes" / change_key / "proposal.md").read_text(
            encoding="utf-8"
        ) == "p-content"
        assert not (spec_root / "changes" / change_key).exists()
        # manifest 三标记 + version+1
        rows = {
            r.path: r
            for r in (
                (
                    await db_session.execute(
                        select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws.id)
                    )
                )
                .scalars()
                .all()
            )
        }
        for p in (
            f"changes/{change_key}/proposal.md",
            f"changes/{change_key}/tasks/task-01.md",
        ):
            assert rows[p].exists is False
            assert rows[p].platform_deleted is True
            assert rows[p].version == 2

        # ② progress 收件箱行删
        progress = (
            await db_session.execute(
                select(PlatformChangeProgressORM).where(
                    PlatformChangeProgressORM.workspace_id == ws.id,
                    PlatformChangeProgressORM.change_name == change_key,
                )
            )
        ).scalar_one_or_none()
        assert progress is None

        # ③ Change 行保留且软删（不物理删，审计 CASCADE 防丢）
        db_session.expire_all()
        retained = await db_session.get(Change, change_id)
        assert retained is not None
        assert retained.location == "deleted"

        # ④ change_events[delete] 审计：detail 四字段
        events = await _delete_events(db_session, change_id)
        assert len(events) == 1
        detail = events[0].detail
        assert detail["deleted_by"] == str(owner_id)
        assert detail["change_key"] == change_key
        assert detail["file_count"] == 2
        assert detail["backup_dir"] == body["backup_dir"]
        assert events[0].created_by == owner_id

    async def test_second_delete_409_after_success(self, client, db_session, tmp_path) -> None:
        """首次 200 后二次删除 → 409（幂等拒绝），delete 事件仍只有一条。"""
        owner, owner_token = await _make_user(db_session)
        env = await _make_env(db_session, tmp_path, owner_id=owner.id)
        ws, change = env["ws"], env["change"]

        first = await client.delete(
            f"/api/workspaces/{ws.id}/changes/{change.id}",
            headers=_headers(owner_token),
        )
        assert first.status_code == 200, first.text

        second = await client.delete(
            f"/api/workspaces/{ws.id}/changes/{change.id}",
            headers=_headers(owner_token),
        )
        assert second.status_code == 409, second.text
        assert second.json()["code"] == "change_deleted"
        assert len(await _delete_events(db_session, change.id)) == 1

    async def test_archive_location_deletes_archive_prefix(
        self, client, db_session, tmp_path
    ) -> None:
        """location='archive' 行删除走 changes/archive/{name}/ 前缀，同样落三标记
        + 审计；活跃区不受牵连。"""
        owner, owner_token = await _make_user(db_session)
        # 归档目标 + 活跃区对照变更
        env = await _make_env(
            db_session,
            tmp_path,
            change_key="archived_change",
            owner_id=owner.id,
            location="archive",
        )
        ws, change, spec_root = env["ws"], env["change"], env["spec_root"]
        # 活跃区对照：同 workspace 另一变更目录 + manifest 行
        live_rel = "changes/live_change/a.md"
        live_file = spec_root / live_rel
        live_file.parent.mkdir(parents=True, exist_ok=True)
        live_file.write_text("live", encoding="utf-8")
        db_session.add(
            SpecFileManifest(
                id=uuid.uuid4(),
                workspace_id=ws.id,
                path=live_rel,
                content_hash=hashlib.sha256(b"live").hexdigest(),
                version=1,
                exists=True,
            )
        )
        await db_session.commit()

        resp = await client.delete(
            f"/api/workspaces/{ws.id}/changes/{change.id}",
            headers=_headers(owner_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["file_count"] == 2

        assert not (spec_root / "changes" / "archive" / "archived_change").exists()
        assert (spec_root / "changes" / "live_change" / "a.md").exists()
        rows = {
            r.path: r
            for r in (
                (
                    await db_session.execute(
                        select(SpecFileManifest).where(SpecFileManifest.workspace_id == ws.id)
                    )
                )
                .scalars()
                .all()
            )
        }
        for p in (
            "changes/archive/archived_change/proposal.md",
            "changes/archive/archived_change/tasks/task-01.md",
        ):
            assert rows[p].platform_deleted is True
            assert rows[p].exists is False
            assert rows[p].version == 2
        assert rows[live_rel].platform_deleted is False
        assert rows[live_rel].exists is True
        # 审计同样落（归档区删除不豁免审计）
        assert len(await _delete_events(db_session, change.id)) == 1


# ===========================================================================
# ③ enrich 前置过滤（design §6.2：deleted 行不被 latest_progress 投影覆盖）
# ===========================================================================


class TestEnrichDeletedFilter:
    async def _seed_pair(self, db_session: AsyncSession) -> tuple[Workspace, Change, Change]:
        """同 workspace 两条同 key 形态行：active（对照）+ deleted（目标）。

        progress 行按 (workspace_id, change_name) 复合键唯一 → 两个 key 各挂一条
        内容相同的 latest_progress（status='archived'，会触发终态回翻）。
        """
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"enrich-del-{uuid.uuid4().hex[:6]}",
            slug=f"enrich-del-{uuid.uuid4().hex[:6]}",
            root_path=f"/tmp/enrich-del-{uuid.uuid4().hex[:8]}",
            status="active",
        )
        db_session.add(ws)

        def _mk(key: str, location: str) -> Change:
            return Change(
                id=uuid.uuid4(),
                workspace_id=ws.id,
                change_key=key,
                title=key,
                status="active",
                location=location,
                path=f"changes/{key}",
                current_stage="execute",
            )

        active = _mk("enrich_active", "active")
        deleted = _mk("enrich_deleted", "deleted")
        db_session.add_all([active, deleted])
        for key in (active.change_key, deleted.change_key):
            db_session.add(
                PlatformChangeProgressORM(
                    workspace_id=ws.id,
                    change_name=key,
                    latest_progress={
                        "project": {"name": "demo"},
                        "changes": [{"name": key, "current_stage": "verify", "status": "archived"}],
                        "stages": [],
                        "steps": [],
                        "batch_progress": [],
                        "approvals": [],
                    },
                    last_pushed_at="2026-08-29T00:00:00Z",
                    last_pusher="cli",
                )
            )
        await db_session.commit()
        await db_session.refresh(active)
        await db_session.refresh(deleted)
        return ws, active, deleted

    async def test_enrich_summaries_deleted_row_not_projected(self, db_session) -> None:
        """deleted 行：status/current_stage 不被 archived 终态回翻、last_pushed_at /
        step_progress 不投影；active 对照行照旧投影（回归锚）。"""
        _ws, active, deleted = await self._seed_pair(db_session)
        summaries = await ChangeService(db_session).enrich_summaries([active, deleted])
        by_key = {s.change_key: s for s in summaries}

        # 对照锚：active 行被终态投影覆盖（现状行为不变）
        assert by_key["enrich_active"].status == "archived"
        assert by_key["enrich_active"].current_stage == "archived"
        assert by_key["enrich_active"].last_pushed_at == "2026-08-29T00:00:00Z"

        # deleted 行：投影前置过滤——row 现值原样返回
        assert by_key["enrich_deleted"].status == "active"
        assert by_key["enrich_deleted"].current_stage == "execute"
        assert by_key["enrich_deleted"].last_pushed_at is None
        assert by_key["enrich_deleted"].step_progress is None
        assert by_key["enrich_deleted"].pending_review is None

    async def test_enrich_read_deleted_row_not_projected(self, db_session) -> None:
        """enrich_with_workspace_ids 同款前置过滤：deleted 行 ChangeRead 不被覆盖。"""
        _ws, active, deleted = await self._seed_pair(db_session)
        svc = ChangeService(db_session)

        read_deleted = await svc.enrich_with_workspace_ids(deleted)
        assert read_deleted.status == "active"
        assert read_deleted.current_stage == "execute"
        assert read_deleted.step_progress is None

        read_active = await svc.enrich_with_workspace_ids(active)
        assert read_active.status == "archived"
        assert read_active.current_stage == "archived"


# Suppress unused-import warning for pytest (fixture discovery).
pytestmark = pytest.mark.asyncio
