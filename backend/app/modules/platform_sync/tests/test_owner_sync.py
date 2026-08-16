"""owner 对齐 token 身份 + owner_change 事件留痕测试（task-02 / D-001@v1）。

覆盖 design §5 Phase 1.2-1.3 写入侧五场景：

1. 首填：占位行 owner=None → push 后 owner=token 用户，**不记事件**；
2. 变化：预置 owner=A 再以 B 的 token push → owner=B + 恰 1 条 owner_change
   事件（detail 键 from_user_id/to_user_id 逐字，task-04 读侧消费契约）；
3. 幂等含 A→B→A 交替：每次实际变化 1 条事件，同值重试零写（终态 2 条）；
4. 占位行 race-lost：对端已建 Change 行（_ensure_change_row existing 早退，
   不返回行对象）→ SELECT 重查路径命中首填，不依赖上游传行；
5. 失败容错：事件写入抛错 → savepoint 回滚 + log.warning，进度行已落、
   响应仍 200、owner 未变（best-effort，主流程不被吞）。

helper 复用 test_router.py ``_make_ws_and_shpsync`` 同款（建 workspace+User+签
shpsync_ token），扩展为多用户版本——A→B 交替场景需同一 workspace 两个用户
各持 token（token 签发人即鉴权派生的真实 User，auth.py:137）。
"""

from __future__ import annotations

import uuid as _uuid

# ISO 8601 UTC 串（契约 §7：字典序 == 时间序）
T1 = "2026-08-16T09:00:00.000Z"
T2 = "2026-08-16T09:30:00.000Z"


def _progress(name: str) -> dict:
    """serializeForSync 六表 body（changes[0] 同名条目，供占位行取 title/stage）。"""
    return {
        "project": {"name": "demo"},
        "changes": [
            {"name": name, "current_stage": "execute", "status": "in_progress", "title": name}
        ],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _make_ws_and_users_with_tokens(db_session, *, n_users: int = 1):
    """建 workspace + N 个 User 各签 shpsync_ token，返回 (workspace_id, users, headers)。

    同款范式来自 test_router.py ``_make_ws_and_shpsync``；多用户版供 owner 交替
    场景——每用户独立 token，push 时鉴权派生各自真实 User（owner 对齐来源）。
    """
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    tag = _uuid.uuid4().hex[:8]
    ws = Workspace(
        id=_uuid.uuid4(),
        name=f"ws-owner-sync-{tag}",
        slug=f"ws-owner-sync-{tag}",
        root_path=f"/tmp/ws-owner-sync-{tag}",
        status="active",
    )
    db_session.add(ws)
    users: list[User] = []
    for i in range(n_users):
        user = User(
            id=_uuid.uuid4(),
            email=f"owner-sync-{tag}-{i}@example.com",
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
            name=f"owner-sync-{tag}-{i}",
            created_by=user.id,
        )
        headers.append({"Authorization": f"Bearer {plaintext}"})
    return ws.id, users, headers


async def _get_change(db_session, ws_id, name):
    """取 (workspace, change_key) 唯一的 ux_changes 行。"""
    from sqlalchemy import select

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


async def _get_events(db_session, ws_id):
    """取该 workspace 全部 change_events 行（按创建序）——每用例独立 workspace。"""
    from sqlalchemy import select

    from app.modules.change.model import ChangeEventORM

    return list(
        (
            await db_session.execute(
                select(ChangeEventORM)
                .where(ChangeEventORM.workspace_id == ws_id)
                .order_by(ChangeEventORM.created_at)
            )
        )
        .scalars()
        .all()
    )


async def _push(client, headers, name, *, pushed_at=T1):
    """push progress（无 base_ts=首推无条件接受，命中接受分支）。"""
    return await client.post(
        f"/api/changes/{name}/progress",
        json=_progress(name),
        headers={**headers, "X-SillySpec-Pushed-At": pushed_at},
    )


# ── 场景 1：首填 None → owner=token 用户，不记事件 ──────────────────────────────


async def test_first_fill_owner_no_event(client, db_session):
    """占位行 owner=None 首推 → owner=token 用户 + change_events 零行（首填非"变化"）。"""
    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session)
    resp = await _push(client, headers[0], "first-fill-c")
    assert resp.status_code == 200

    change = await _get_change(db_session, ws_id, "first-fill-c")
    assert change is not None, "首推应建 ux_changes 占位行"
    assert change.owner_id == users[0].id
    assert await _get_events(db_session, ws_id) == []


# ── 场景 2：owner 变化 → UPDATE + 恰 1 条 owner_change 事件 ─────────────────────


async def test_owner_change_records_event_with_from_to(client, db_session):
    """预置 owner=A 再以 B 的 token push → owner=B + 1 事件（detail/created_by/
    workspace/change_id 全断言，task-04 读侧消费契约）。"""
    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session, n_users=2)
    user_a, user_b = users
    # 预置 owner=A：A 的 token 首推（首填，无事件）
    assert (await _push(client, headers[0], "swap-c", pushed_at=T1)).status_code == 200
    # B 的 token push → A→B 变化
    resp = await _push(client, headers[1], "swap-c", pushed_at=T2)
    assert resp.status_code == 200

    change = await _get_change(db_session, ws_id, "swap-c")
    assert change is not None
    assert change.owner_id == user_b.id

    events = await _get_events(db_session, ws_id)
    assert len(events) == 1, "A→B 变化应恰记 1 条事件"
    ev = events[0]
    assert ev.event_type == "owner_change"
    assert ev.detail == {
        "from_user_id": str(user_a.id),
        "to_user_id": str(user_b.id),
    }
    assert ev.created_by == user_b.id
    assert ev.workspace_id == ws_id
    assert ev.change_id == change.id


# ── 场景 3：幂等 + A→B→A 交替（终态 2 条事件）──────────────────────────────────


async def test_idempotent_and_abba_alternation(client, db_session):
    """A 首填（0）→ A→B（1）→ B→A（1）→ A 再推同值（0）——终态 2 条事件，owner=A。"""
    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session, n_users=2)
    user_a, user_b = users

    for headers_i in (headers[0], headers[1], headers[0], headers[0]):
        resp = await _push(client, headers_i, "abba-c")
        assert resp.status_code == 200

    change = await _get_change(db_session, ws_id, "abba-c")
    assert change is not None
    assert change.owner_id == user_a.id, "A 再推后 owner 终态=A"

    events = await _get_events(db_session, ws_id)
    assert len(events) == 2, "首填 + 同值重试均零写，仅两次实际变化各 1 条"
    assert events[0].detail == {
        "from_user_id": str(user_a.id),
        "to_user_id": str(user_b.id),
    }
    assert events[1].detail == {
        "from_user_id": str(user_b.id),
        "to_user_id": str(user_a.id),
    }


# ── 场景 4：占位行 race-lost（对端已建行，SELECT 重查路径命中）─────────────────


async def test_race_lost_preexisting_row_first_fill(client, db_session):
    """预插 Change 行模拟对端已建（_ensure_change_row existing 早退不返回行对象）
    → push 后 SELECT 重查路径命中首填成功，不依赖上游传行。"""
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session)
    pre = Change(
        id=_uuid.uuid4(),
        workspace_id=ws_id,
        change_key="race-lost-c",
        title="race-lost-c",
        status="active",
        location="active",
        path="changes/race-lost-c",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(pre)
    await db_session.commit()

    resp = await _push(client, headers[0], "race-lost-c")
    assert resp.status_code == 200

    # db_session 身份映射缓存 pre 旧属性（expire_on_commit=False，跨 session 写
    # 不自动失效），refresh 重读库后断言。
    await db_session.refresh(pre)
    change = await _get_change(db_session, ws_id, "race-lost-c")
    assert change is not None
    assert change.id == pre.id, "复用对端已建行（不重复建行）"
    assert change.owner_id == users[0].id, "重查路径首填 owner"
    assert await _get_events(db_session, ws_id) == []


# ── 场景 5：owner 同步失败容错（进度上行不被吞）────────────────────────────────


async def test_owner_sync_failure_does_not_block_progress(client, db_session, monkeypatch):
    """事件 INSERT 抛错 → savepoint 回滚 + log.warning：响应仍 200、进度行已落、
    owner 未变（best-effort）。"""
    from unittest.mock import MagicMock

    from sqlalchemy import select

    from app.modules.change import model as change_model
    from app.modules.platform_sync import service as svc_mod
    from app.modules.platform_sync.model import PlatformChangeProgressORM

    ws_id, users, headers = await _make_ws_and_users_with_tokens(db_session, n_users=2)
    user_a, _user_b = users
    # 预置 owner=A（B push 时走变化分支 → 构造事件即触发 mock 抛错）
    assert (await _push(client, headers[0], "fault-c", pushed_at=T1)).status_code == 200

    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("owner_change insert failed")

    monkeypatch.setattr(change_model, "ChangeEventORM", _boom)
    # structlog PrintLoggerFactory 直写 stderr，caplog 抓不到；替换模块级 log
    # 符号捕获（daemon 测试 test_session_readiness.py:324 同款范式）。
    log_spy = MagicMock()
    monkeypatch.setattr(svc_mod, "log", log_spy)

    resp = await _push(client, headers[1], "fault-c", pushed_at=T2)
    assert resp.status_code == 200, "owner 同步失败不得阻断进度上行"

    # 撤销 patch 再断言：helper 的 ``from app.modules.change.model import ChangeEventORM``
    # 在调用时解析模块属性，不撤销会把 mock 选进 SELECT。
    monkeypatch.undo()

    # 进度主数据完好：platform_change_progress 行已落（_apply 已 commit）
    progress_row = (
        (
            await db_session.execute(
                select(PlatformChangeProgressORM).where(
                    PlatformChangeProgressORM.workspace_id == ws_id,
                    PlatformChangeProgressORM.change_name == "fault-c",
                )
            )
        )
        .scalars()
        .one_or_none()
    )
    assert progress_row is not None
    assert progress_row.latest_progress is not None

    # owner 未变（savepoint 回滚，UPDATE 不落库）+ 零事件
    change = await _get_change(db_session, ws_id, "fault-c")
    assert change is not None
    assert change.owner_id == user_a.id
    assert await _get_events(db_session, ws_id) == []

    # log.warning 可捕（事件名 + 上下文键）
    assert log_spy.warning.called
    call = log_spy.warning.call_args
    assert call.args[0] == "platform_sync.change_owner_sync_failed"
    assert call.kwargs.get("change_key") == "fault-c"
