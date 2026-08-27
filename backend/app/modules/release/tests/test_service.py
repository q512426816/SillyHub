"""Unit tests for ReleaseService."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.release.service import (
    ReleaseError,
    ReleaseNotAllowed,
    ReleaseService,
    check_deploy_window,
)


async def _make_workspace(db_session) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Test WS",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path="/tmp/test",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws_id


async def _make_user(db_session) -> uuid.UUID:
    from app.core.security import password_hasher
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"test-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Test",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    return user_id


async def test_create_release_staging(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        user_id,
        ReleaseCreate(version="v1.0.0", title="First Release"),
    )
    assert release.status == "draft"
    assert release.version == "v1.0.0"
    assert release.target_environment == "staging"
    assert release.creator_id == user_id


async def test_create_release_production(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        user_id,
        ReleaseCreate(
            version="v2.0.0",
            target_environment="production",
        ),
    )
    assert release.target_environment == "production"


async def test_create_release_invalid_environment(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    with pytest.raises(ReleaseError):
        await svc.create(
            ws_id,
            user_id,
            ReleaseCreate(version="v1.0.0", target_environment="canary"),
        )


async def test_list_releases(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    await svc.create(ws_id, user_id, ReleaseCreate(version="v1.0.0"))
    await svc.create(ws_id, user_id, ReleaseCreate(version="v2.0.0"))

    releases = await svc.list_releases(ws_id)
    assert len(releases) == 2


async def test_list_releases_filter_status(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    await svc.create(ws_id, user_id, ReleaseCreate(version="v1.0.0"))

    releases = await svc.list_releases(ws_id, status="draft")
    assert len(releases) == 1
    releases = await svc.list_releases(ws_id, status="deployed")
    assert len(releases) == 0


async def test_approve_release(db_session):
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)
    approver_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(version="v1.0.0"),
    )

    approval = await svc.approve(release.id, approver_id, "approve", "LGTM")
    assert approval.verdict == "approve"
    assert approval.approver_id == approver_id


async def test_creator_cannot_approve(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(ws_id, user_id, ReleaseCreate(version="v1.0.0"))

    with pytest.raises(ReleaseNotAllowed, match="创建人不能审批"):
        await svc.approve(release.id, user_id, "approve")


async def test_double_approve_blocked(db_session):
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)
    approver_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(ws_id, creator_id, ReleaseCreate(version="v1.0.0"))

    await svc.approve(release.id, approver_id, "approve")
    with pytest.raises(ReleaseError, match="已在该发布单投过票"):
        await svc.approve(release.id, approver_id, "approve")


async def test_approve_triggers_status_change(db_session):
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)
    a1 = await _make_user(db_session)
    a2 = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(version="v1.0.0"),
    )

    await svc.approve(release.id, a1, "approve")
    await svc.approve(release.id, a2, "approve")

    await db_session.refresh(release)
    assert release.status == "approved"


async def test_deploy_staging(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        user_id,
        ReleaseCreate(version="v1.0.0"),
    )
    release.status = "staging"
    await db_session.commit()

    deployed = await svc.deploy(release.id)
    assert deployed.status == "deployed"
    assert deployed.deployed_at is not None


async def test_deploy_production_requires_approvals(db_session):
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(version="v1.0.0", target_environment="production"),
    )
    release.status = "staging"
    await db_session.commit()

    with pytest.raises(ReleaseNotAllowed, match="需要至少 2 人审批"):
        await svc.deploy(release.id)


async def test_rollback(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        user_id,
        ReleaseCreate(version="v1.0.0"),
    )
    release.status = "deployed"
    release.deployed_at = datetime.now(UTC)
    await db_session.commit()

    rolled = await svc.rollback(release.id)
    assert rolled.status == "rolled_back"
    assert rolled.rolled_back_at is not None


async def test_rollback_only_from_deployed(db_session):
    ws_id = await _make_workspace(db_session)
    user_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        user_id,
        ReleaseCreate(version="v1.0.0"),
    )

    with pytest.raises(ReleaseError, match="仅已发布的发布单可回滚"):
        await svc.rollback(release.id)


# ── deploy window ──────────────────────────────────────────────


def test_check_deploy_window_within_hours():
    # Use a wide-open window so test passes regardless of when run
    policy = {"deploy_window": {"days": list(range(7)), "start_hour": 0, "end_hour": 24}}
    check_deploy_window(policy)  # should not raise


def test_check_deploy_window_outside_days():
    now = datetime.now(UTC)
    all_days = list(range(7))
    if now.weekday() in all_days:
        # Remove today to force failure
        days_without_today = [d for d in all_days if d != now.weekday()]
        policy = {"deploy_window": {"days": days_without_today, "start_hour": 0, "end_hour": 24}}
        with pytest.raises(ReleaseNotAllowed, match="不在允许发布的日期"):
            check_deploy_window(policy)


# ── 审批门加固（2026-08-27 缺陷排查批次） ────────────────────────────────


async def test_create_clamps_min_approvers_to_one(db_session):
    """create 注入 min_approvers=0/负数/非法值 → 存储值钳制 ≥1（防零审批生产部署）。"""
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    r0 = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(
            version="v0.1.0",
            target_environment="production",
            deploy_policy={"min_approvers": 0},
        ),
    )
    assert r0.deploy_policy["min_approvers"] == 1

    r_neg = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(
            version="v0.2.0",
            target_environment="production",
            deploy_policy={"min_approvers": -5},
        ),
    )
    assert r_neg.deploy_policy["min_approvers"] == 1

    r_bad = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(
            version="v0.3.0",
            target_environment="production",
            deploy_policy={"min_approvers": "many"},
        ),
    )
    assert r_bad.deploy_policy["min_approvers"] == 2  # 非法值回退默认


async def test_reject_votes_block_production_deploy(db_session):
    """已达 approved 后补投 reject 票 → deploy 仍被拒（此前 reject 完全不阻断）。"""
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)
    approver = await _make_user(db_session)
    rejector = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(
            version="v1.0.0",
            target_environment="production",
            deploy_policy={"min_approvers": 1},
        ),
    )
    await svc.approve(release.id, approver, "approve")
    await db_session.refresh(release)
    assert release.status == "approved"  # 前置：无 reject 时正常过审

    await svc.approve(release.id, rejector, "reject", "配置有坑")

    with pytest.raises(ReleaseNotAllowed, match="已被 1 人拒绝"):
        await svc.deploy(release.id)


async def test_reject_votes_block_threshold_transition(db_session):
    """approve 票数达标但存在 reject → 不转 approved。"""
    ws_id = await _make_workspace(db_session)
    creator_id = await _make_user(db_session)
    a1 = await _make_user(db_session)
    a2 = await _make_user(db_session)
    rejector = await _make_user(db_session)

    from app.modules.release.schema import ReleaseCreate

    svc = ReleaseService(db_session)
    release = await svc.create(
        ws_id,
        creator_id,
        ReleaseCreate(version="v2.0.0", deploy_policy={"min_approvers": 2}),
    )
    await svc.approve(release.id, a1, "approve")
    await svc.approve(release.id, rejector, "reject")
    await svc.approve(release.id, a2, "approve")  # 达标最后一张 approve

    await db_session.refresh(release)
    assert release.status != "approved"
