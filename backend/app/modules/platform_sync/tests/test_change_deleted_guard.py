"""已删 key 双层拒收 + CLI 墓碑写路径测试（task-04 / FR-04 复活通道 4）。

覆盖 design §5.4 持久锚点兜底（B-1 加固）与 §5.5 CLI 墓碑：

1. 主判据：现存 Change 行 ``location='deleted'`` → progress 上行 409
   ``code='change_deleted'``，收件箱行不重建、owner 不漂移；
2. 兜底判据：行缺失 + manifest ``changes/{name}/`` 前缀 ``platform_deleted=True``
   锚点 → 同样 409（service 直调 ``_ensure_change_row`` 亦被守卫）；
3. 前缀精确性（LIKE 转义等价）：变更名含 ``_``（my_change）不误配相似名
   （myXchange——LIKE 未转义时 ``_`` 通配恰会匹配 X）；
4. CLI 墓碑：``changes[].status='deleted'`` 上行 → 200 + location 置 deleted；
   行已 deleted 时拒收优先（墓碑只对未删行生效，天然幂等）；
5. 未删 key 回归：占位行照建、owner 对齐；
6. base_ts 冲突 409 与 change_deleted 409 错误体按 code 字段可区分。
"""

from __future__ import annotations

import uuid as _uuid

from sqlalchemy import select

# ISO 8601 UTC 串（契约 §7：字典序 == 时间序）
T1 = "2026-08-29T09:00:00.000Z"
T2 = "2026-08-29T09:30:00.000Z"


def _progress(name: str, *, status: str = "in_progress") -> dict:
    """serializeForSync 六表 body（changes[0] 同名条目，供占位行/墓碑检测取值）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": name, "current_stage": "execute", "status": status, "title": name}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _make_ws_and_users_with_tokens(db_session, *, n_users: int = 1):
    """建 workspace + N 个 User 各签 shpsync_ token（test_owner_sync.py 同款范式）。"""
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    tag = _uuid.uuid4().hex[:8]
    ws = Workspace(
        id=_uuid.uuid4(),
        name=f"ws-delguard-{tag}",
        slug=f"ws-delguard-{tag}",
        root_path=f"/tmp/ws-delguard-{tag}",
        status="active",
    )
    db_session.add(ws)
    users: list[User] = []
    for i in range(n_users):
        user = User(
            id=_uuid.uuid4(),
            email=f"delguard-{tag}-{i}@example.com",
            password_hash=password_hasher.hash("x"),
            status="active",
        )
        db_session.add(user)
        users.append(user)
    await db_session.commit()
    await db_session.refresh(ws)

    headers: list[dict[str, str]] = []
    for i, user in enumerate(users):
        _row, plaintext = await PlatformSyncTokenService(
            db_session, settings=get_settings()
        ).create(
            workspace_id=ws.id,
            name=f"delguard-{tag}-{i}",
            created_by=user.id,
        )
        headers.append({"Authorization": f"Bearer {plaintext}"})
    return ws.id, users, headers


async def _get_change(db_session, ws_id, name):
    """取 (workspace, change_key) 唯一的 ux_changes 行。"""
    from app.modules.change.model import Change

    return (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == name,
                )
            )
        )
        .scalars()
        .one_or_none()
    )


async def _get_progress_row(db_session, ws_id, name):
    """取 (workspace, change_name) 复合键的收件箱行。"""
    from app.modules.platform_sync.model import PlatformChangeProgressORM

    return (
        (
            await db_session.execute(
                select(PlatformChangeProgressORM).where(
                    PlatformChangeProgressORM.workspace_id == ws_id,
                    PlatformChangeProgressORM.change_name == name,
                )
            )
        )
        .scalars()
        .one_or_none()
    )


async def _add_deleted_change_row(db_session, ws_id, name, *, owner_id=None):
    """预插 location='deleted' 的 Change 行（主判据锚点）。"""
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    row = Change(
        id=_uuid.uuid4(),
        workspace_id=ws_id,
        change_key=name,
        title=name,
        status="active",
        location="deleted",
        path=f"changes/{name}",
        owner_id=owner_id,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(row)
    await db_session.commit()
    return row


async def _add_manifest_anchor(
    db_session, ws_id, name, *, filename: str = "proposal.md", archive: bool = False
):
    """造 manifest ``changes/{name}/{filename}``（或归档区 ``changes/archive/{name}/
    {filename}``）行并置 ``platform_deleted=True``（兜底判据锚点；task-06 平台删除
    动作的落点形态）。"""
    from app.modules.spec_workspace.model import SpecFileManifest

    prefix = "changes/archive/" if archive else "changes/"
    db_session.add(
        SpecFileManifest(
            id=_uuid.uuid4(),
            workspace_id=ws_id,
            path=f"{prefix}{name}/{filename}",
            content_hash="0" * 64,
            version=2,
            exists=False,
            platform_deleted=True,
        )
    )
    await db_session.commit()


async def _push(
    client, headers, name, *, body=None, base_ts: str | None = None, pushed_at: str = T1
):
    """push progress（无 base_ts=首推无条件接受）。"""
    return await client.post(
        f"/api/changes/{name}/progress",
        json=body or _progress(name),
        headers={
            **headers,
            **({"X-SillySpec-Base-Ts": base_ts} if base_ts else {}),
            "X-SillySpec-Pushed-At": pushed_at,
        },
    )


# ── ① 主判据：现存 Change 行 location='deleted' → 409 + 无副作用 ──────────────


async def test_deleted_change_row_rejected_409_no_side_writes(client, db_session):
    """行已删 → 409 code=change_deleted；收件箱行不建、owner 不漂移、行不重建。"""
    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session, n_users=2)
    owner_a, _user_b = users
    await _add_deleted_change_row(db_session, ws_id, "del-c", owner_id=owner_a.id)

    resp = await _push(client, headers[1], "del-c")
    assert resp.status_code == 409
    body = resp.json()
    assert body["code"] == "change_deleted"

    # 收件箱行不重建（拒收分支不写 platform_change_progress）
    assert await _get_progress_row(db_session, ws_id, "del-c") is None
    # owner 不漂移（被拒上行不得改责任人，模块卡注意事项）
    change = await _get_change(db_session, ws_id, "del-c")
    assert change is not None
    assert change.owner_id == owner_a.id
    assert change.location == "deleted"


# ── ② 兜底判据：行缺失 + manifest platform_deleted 前缀锚点 → 409 ──────────────


async def test_missing_row_manifest_anchor_rejected_409(client, db_session):
    """行缺失 + manifest changes/{name}/ 前缀 platform_deleted=True → 同样 409；
    占位行不建（B-1 持久锚点兜底——Change 行被旧环物理删后的第二道防线）。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    await _add_manifest_anchor(db_session, ws_id, "anchor-c")

    resp = await _push(client, headers[0], "anchor-c")
    assert resp.status_code == 409
    assert resp.json()["code"] == "change_deleted"

    # 占位行不建、收件箱行不写
    assert await _get_change(db_session, ws_id, "anchor-c") is None
    assert await _get_progress_row(db_session, ws_id, "anchor-c") is None


async def test_ensure_change_row_direct_guard_manifest_anchor(db_session):
    """service 直调路径防绕过：manifest 锚点命中时 ``_ensure_change_row`` 不建占位行
    （router 之外的调用方也吃同一 helper 守卫）。"""
    from app.modules.platform_sync.service import PlatformSyncService

    ws_id, _users, _headers = await _make_ws_and_users_with_tokens(db_session)
    await _add_manifest_anchor(db_session, ws_id, "direct-c")

    await PlatformSyncService(db_session)._ensure_change_row(
        ws_id, "direct-c", _progress("direct-c")
    )
    assert await _get_change(db_session, ws_id, "direct-c") is None


# ── ②b 审计 A3：归档区墓碑兜底命中（原实现只探活跃区两段前缀） ────────────────


async def test_missing_row_archive_manifest_anchor_rejected_409(client, db_session):
    """审计 A3：行缺失 + manifest ``changes/archive/{name}/`` 前缀
    platform_deleted=True 锚点 → 409（软删归档变更后 Change 行被物理删，上行
    仍拒收）；兄弟名不受范围上界外溢牵连。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    await _add_manifest_anchor(db_session, ws_id, "arch-c", archive=True)

    rejected = await _push(client, headers[0], "arch-c")
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "change_deleted"
    assert await _get_change(db_session, ws_id, "arch-c") is None
    assert await _get_progress_row(db_session, ws_id, "arch-c") is None

    # 范围上界 {name}0 不外溢：兄弟名（arch-cx / arch-c0x）不受归档锚点牵连
    ok = await _push(client, headers[0], "arch-cx")
    assert ok.status_code == 200


# ── ③ 前缀精确性（LIKE 转义等价）：含 _ 变更名不误配相似名 ─────────────────────


async def test_manifest_prefix_no_false_match_underscore_names(client, db_session):
    """``my_change`` 有锚点、``myXchange`` 无 → 推 myXchange 应 200（未转义 LIKE
    ``changes/my_change/%`` 的 ``_`` 通配恰会匹配 X 造成误拒）；推 my_change → 409。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    await _add_manifest_anchor(db_session, ws_id, "my_change")

    # 相似名不受锚点牵连（前缀过滤逐字符精确，_ 不当通配符）
    ok = await _push(client, headers[0], "myXchange")
    assert ok.status_code == 200
    assert (await _get_change(db_session, ws_id, "myXchange")) is not None

    # 本尊命中锚点 → 拒收
    rejected = await _push(client, headers[0], "my_change")
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "change_deleted"


async def test_active_row_wins_over_stale_manifest_anchor(client, db_session):
    """行存在且未删 → 主判据优先，manifest 残留锚点不拒收（兜底只在行缺失时启用）。"""
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    db_session.add(
        Change(
            id=_uuid.uuid4(),
            workspace_id=ws_id,
            change_key="active-c",
            title="active-c",
            status="active",
            location="active",
            path="changes/active-c",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    await _add_manifest_anchor(db_session, ws_id, "active-c")

    resp = await _push(client, headers[0], "active-c")
    assert resp.status_code == 200
    change = await _get_change(db_session, ws_id, "active-c")
    assert change is not None and change.location == "active"


# ── ④ CLI 墓碑写路径：status='deleted' → 200 + location 置 deleted ────────────


async def test_cli_tombstone_sets_location_deleted(client, db_session):
    """墓碑上行（行未删）→ 200 且 Change 行 location 置 deleted（写路径副作用，
    区别于 archived 读时投影）；镜像软删接线归 task-06，此处只置位。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)

    resp = await _push(
        client,
        headers[0],
        "tomb-c",
        body=_progress("tomb-c", status="deleted"),
    )
    assert resp.status_code == 200
    change = await _get_change(db_session, ws_id, "tomb-c")
    assert change is not None, "墓碑上行仍建占位行（锚点落 DB）"
    assert change.location == "deleted"
    # 接受分支语义不缩水：收件箱行照写
    assert await _get_progress_row(db_session, ws_id, "tomb-c") is not None


async def test_tombstone_rejected_when_row_already_deleted(client, db_session):
    """已删拒收 409 优先于墓碑处理：行已 deleted 时墓碑上行也走拒收分支
    （墓碑只对未删行生效，天然幂等）。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    await _add_deleted_change_row(db_session, ws_id, "tomb2-c")

    resp = await _push(
        client,
        headers[0],
        "tomb2-c",
        body=_progress("tomb2-c", status="deleted"),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "change_deleted"


async def test_tombstone_flips_existing_active_row(client, db_session):
    """占位/扫描行已存在（active）→ 墓碑上行后翻为 deleted（未删行生效路径）。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    # 首推建 active 占位行
    assert (await _push(client, headers[0], "tomb3-c")).status_code == 200
    assert (await _get_change(db_session, ws_id, "tomb3-c")).location == "active"
    # 墓碑上行 → 翻 deleted
    resp = await _push(
        client,
        headers[0],
        "tomb3-c",
        body=_progress("tomb3-c", status="deleted"),
        pushed_at=T2,
    )
    assert resp.status_code == 200
    assert (await _get_change(db_session, ws_id, "tomb3-c")).location == "deleted"


# ── ⑤ 未删 key 回归：占位行照建、owner 对齐 ───────────────────────────────────


async def test_undeleted_key_normal_push_regression(client, db_session):
    """未删 key 行为与现状一致：200 + 占位行照建（active）+ owner 对齐 token 签发人。"""
    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session)

    resp = await _push(client, headers[0], "normal-c")
    assert resp.status_code == 200
    change = await _get_change(db_session, ws_id, "normal-c")
    assert change is not None
    assert change.location == "active"
    assert change.current_stage == "execute"
    assert change.owner_id == users[0].id, "owner 对齐 token 签发人"
    assert await _get_progress_row(db_session, ws_id, "normal-c") is not None


# ── ⑥ base_ts 冲突 409 与 change_deleted 409 错误体可区分 ─────────────────────


async def test_change_deleted_409_distinguishable_from_base_ts_conflict(client, db_session):
    """两种 409 按 code 字段区分：base_ts 冲突体 {conflict, platform_progress,
    last_pushed_at}（无 code，逐字不动）；已删拒收体含 code='change_deleted'。"""
    ws_id, _users, headers = await _make_ws_and_users_with_tokens(db_session)
    # 建存储基准 T1，再以 base_ts=T0（更旧）触发 base_ts 冲突 409
    assert (await _push(client, headers[0], "dist-c", pushed_at=T1)).status_code == 200
    conflict_resp = await _push(
        client,
        headers[0],
        "dist-c",
        body=_progress("dist-c"),
        base_ts="2026-08-29T08:00:00.000Z",
        pushed_at=T2,
    )
    assert conflict_resp.status_code == 409
    conflict_body = conflict_resp.json()
    assert conflict_body["conflict"] is True
    assert "code" not in conflict_body, "base_ts 冲突体逐字不动（契约 §4.4）"

    # 已删拒收 409：含 code、无 conflict 键——两错误体可机器区分
    await _add_deleted_change_row(db_session, ws_id, "dist2-c")
    deleted_resp = await _push(client, headers[0], "dist2-c")
    assert deleted_resp.status_code == 409
    deleted_body = deleted_resp.json()
    assert deleted_body["code"] == "change_deleted"
    assert "conflict" not in deleted_body
    assert conflict_body != deleted_body
