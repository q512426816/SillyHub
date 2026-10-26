"""heartbeat thin_flows 逐变更写入测试（2026-10-26-session-change-progress-hover
task-05 / FR-03/FR-06 / D-008@v2 / D-014@v1）。

覆盖（design 生命周期契约表事件 3 + plan 盲区清单 #3）：

* 主路径：executing/closing/awaiting_approval/spec 四相位归一落库
  （stages["thin_flow"] 结构=ThinFlowProgress 同构 dict）；
* D-014@v1：写入只 set stages 列，changes.updated_at 不变（防入口圈偏向轻量）；
* 坏条目（workspace_id 非 UUID / change 空 / 非 dict）单条丢弃整批不拒；
* 未知变更（change_key 无行）静默跳过不建行（盲区#3）；
* legacy_fallback → upgraded=True；location='deleted' 行跳过；
* 既有 stages 键保留（reparse 投影键不被覆盖，merge 语义）。

归一口径与 sillyspec flow.js:3284-3296 逐字对齐（service._normalize_thin_phase
docstring 锚定）。SQLite in-memory（db_session fixture），FK 不强制故无需 seed
workspace 行（test_heartbeat_spec_cache 同款口径）。

⚠ 测试范式注意：heartbeat_daemon 末尾 commit 会 expire 全部 ORM 实例，之后
同步访问 ``change.<attr>`` 触发 lazy refresh IO（async session 下 MissingGreenlet）
——所有 heartbeat 之后的断言经 ``_reload_by_key``（change_key 字符串查询）取
新鲜行，key 在 heartbeat 前抓取。
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import RuntimeService


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


async def _seed_daemon(db_session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    """最小 daemon_instances 行（heartbeat_daemon 前置）。"""
    daemon_id = uuid.uuid4()
    db_session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user_id,
            hostname=f"h-{daemon_id.hex[:8]}",
            server_url="http://localhost:1",
        )
    )
    await db_session.commit()
    return daemon_id


async def _seed_change(
    db_session: AsyncSession,
    *,
    change_key: str,
    stages: dict | None = None,
    location: str = "active",
) -> Change:
    """最小 changes 行（workspace_id 随机 UUID——SQLite 不强制 FK）。"""
    ws_id = uuid.uuid4()
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key=change_key,
        title=change_key,
        status="active",
        location=location,
        path=f"changes/{change_key}",
        current_stage="thin",
        owner_id=None,
        change_type="feature",
        **({"stages": stages} if stages is not None else {}),
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)
    return change


def _flow_item(
    ws_id: uuid.UUID,
    change_key: str,
    *,
    substeps: list[str] | None = None,
    design_filled: bool = True,
    fr_filled: bool = True,
    bindings_total: int = 2,
    bindings_filled: int = 2,
    spec_approved: bool = True,
    autopilot: bool = False,
    tasks_total: int = 12,
    tasks_checked: int = 4,
    legacy_fallback: bool = False,
) -> dict:
    """daemon 白名单透传条目（DaemonHeartbeatThinFlow.model_dump 同构）。"""
    return {
        "workspace_id": str(ws_id),
        "change": change_key,
        "phase": "② 执行（已批准·写代码跑测试）",  # CLI 文案——归一按结构字段重算
        "design_filled": design_filled,
        "fr_filled": fr_filled,
        "bindings_total": bindings_total,
        "bindings_filled": bindings_filled,
        "tasks_total": tasks_total,
        "tasks_checked": tasks_checked,
        "substeps": substeps or [],
        "spec_approved": spec_approved,
        "autopilot": autopilot,
        "legacy_fallback": legacy_fallback,
    }


async def _heartbeat(
    db_session: AsyncSession, daemon_id: uuid.UUID, thin_flows: list[dict] | None
) -> None:
    svc = RuntimeService(db_session)
    await svc.heartbeat_daemon(daemon_id, providers=None, thin_flows=thin_flows, actor_user_id=None)


async def _reload_by_key(db_session: AsyncSession, change_key: str) -> Change:
    """按 change_key 查新鲜行（heartbeat commit 已 expire 既有实例，勿触其属性）。"""
    result = await db_session.execute(select(Change).where(Change.change_key == change_key))
    return result.scalar_one()


class TestThinFlowMerge:
    @pytest.mark.asyncio
    async def test_executing_phase_lands_in_stages(self, db_session: AsyncSession) -> None:
        """docs 齐 + 已批准 → executing；结构字段全落库（FR-03 主路径）。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-a")
        key, ws_id = change.change_key, change.workspace_id  # expire 前抓取

        await _heartbeat(db_session, daemon_id, [_flow_item(ws_id, key)])

        tf = (await _reload_by_key(db_session, key)).stages["thin_flow"]
        assert tf["phase"] == "executing"
        assert tf["approved"] is True
        assert tf["autopilot"] is False
        assert tf["tasks_total"] == 12
        assert tf["tasks_done"] == 4
        assert tf["substeps_done"] == 0
        assert tf["substeps_total"] == 8
        assert tf["upgraded"] is False
        assert tf["adopted_from"] is None

    @pytest.mark.asyncio
    async def test_closing_phase_by_ledger_substep(self, db_session: AsyncSession) -> None:
        """substeps 含 ledger（5 done）→ closing（flow.js:3296 同口径）。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-b")
        key, ws_id = change.change_key, change.workspace_id

        await _heartbeat(
            db_session,
            daemon_id,
            [
                _flow_item(
                    ws_id,
                    key,
                    substeps=["artifacts", "ledger", "patch", "review", "probes"],
                )
            ],
        )

        tf = (await _reload_by_key(db_session, key)).stages["thin_flow"]
        assert tf["phase"] == "closing"
        assert tf["substeps_done"] == 5

    @pytest.mark.asyncio
    async def test_awaiting_approval_and_spec_phases(self, db_session: AsyncSession) -> None:
        """docs 齐未批准 → awaiting_approval；docs 不齐 → spec。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        a = await _seed_change(db_session, change_key="2026-10-26-thin-c")
        b = await _seed_change(db_session, change_key="2026-10-26-thin-d")
        key_a, ws_a = a.change_key, a.workspace_id
        key_b, ws_b = b.change_key, b.workspace_id

        await _heartbeat(
            db_session,
            daemon_id,
            [
                _flow_item(ws_a, key_a, spec_approved=False, autopilot=False),
                _flow_item(ws_b, key_b, design_filled=False, spec_approved=False),
            ],
        )

        tf_a = (await _reload_by_key(db_session, key_a)).stages["thin_flow"]
        assert tf_a["phase"] == "awaiting_approval"
        assert tf_a["approved"] is False
        tf_b = (await _reload_by_key(db_session, key_b)).stages["thin_flow"]
        assert tf_b["phase"] == "spec"

    @pytest.mark.asyncio
    async def test_autopilot_counts_as_executing(self, db_session: AsyncSession) -> None:
        """autopilot 豁免 → executing + approved=True（flow.js 豁免语义）。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-e")
        key, ws_id = change.change_key, change.workspace_id

        await _heartbeat(
            db_session,
            daemon_id,
            [_flow_item(ws_id, key, spec_approved=False, autopilot=True)],
        )

        tf = (await _reload_by_key(db_session, key)).stages["thin_flow"]
        assert tf["phase"] == "executing"
        assert tf["approved"] is True
        assert tf["autopilot"] is True

    @pytest.mark.asyncio
    async def test_updated_at_not_touched(self, db_session: AsyncSession) -> None:
        """D-014@v1：写入只 set stages 列，changes.updated_at 不变。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-f")
        key, ws_id = change.change_key, change.workspace_id
        # 制造可观测时间差（SQLite 秒级精度下同秒写会掩盖差异）
        stale_before = (change.updated_at.replace(tzinfo=None)) - timedelta(seconds=5)
        await db_session.execute(
            Change.__table__.update().where(Change.id == change.id).values(updated_at=stale_before)
        )
        await db_session.commit()
        db_session.expire_all()

        await _heartbeat(db_session, daemon_id, [_flow_item(ws_id, key)])

        row = await _reload_by_key(db_session, key)
        after = row.updated_at.replace(tzinfo=None) if row.updated_at else None
        assert after == stale_before, "thin_flow 写入不得刷 changes.updated_at（D-014@v1）"
        assert "thin_flow" in row.stages

    @pytest.mark.asyncio
    async def test_bad_items_dropped_batch_not_rejected(self, db_session: AsyncSession) -> None:
        """坏条目（workspace_id 非 UUID / change 空 / 非 dict）单条丢弃，好条目照落，不抛。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        good = await _seed_change(db_session, change_key="2026-10-26-thin-g")
        key, ws_id = good.change_key, good.workspace_id

        await _heartbeat(
            db_session,
            daemon_id,
            [
                {"workspace_id": "not-a-uuid", "change": "x"},
                {"workspace_id": str(ws_id), "change": ""},  # change 空
                {"change": "not-even-a-dict"},  # 非 dict 带缺失键的坏条目形态
                _flow_item(ws_id, key),  # 好条目
            ],
        )

        assert "thin_flow" in (await _reload_by_key(db_session, key)).stages

    @pytest.mark.asyncio
    async def test_unknown_change_skipped_no_row_created(self, db_session: AsyncSession) -> None:
        """盲区#3：change_key 无行静默跳过，不建行不抛。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)

        await _heartbeat(
            db_session,
            daemon_id,
            [_flow_item(uuid.uuid4(), "2026-10-26-ghost")],
        )

        rows = (await db_session.execute(select(Change))).scalars().all()
        assert rows == []

    @pytest.mark.asyncio
    async def test_legacy_fallback_marks_upgraded(self, db_session: AsyncSession) -> None:
        """legacy_fallback=True → upgraded=True（升厚标注数据源，D-007@v1）。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-h")
        key, ws_id = change.change_key, change.workspace_id

        await _heartbeat(
            db_session,
            daemon_id,
            [_flow_item(ws_id, key, legacy_fallback=True)],
        )

        assert (await _reload_by_key(db_session, key)).stages["thin_flow"]["upgraded"] is True

    @pytest.mark.asyncio
    async def test_existing_stage_keys_preserved(self, db_session: AsyncSession) -> None:
        """merge 语义：既有 stages 键（reparse 投影键）保留不被覆盖。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(
            db_session,
            change_key="2026-10-26-thin-i",
            stages={"team_worker_preset": {"workers": 2}, "old": 1},
        )
        key, ws_id = change.change_key, change.workspace_id

        await _heartbeat(db_session, daemon_id, [_flow_item(ws_id, key)])

        stages = (await _reload_by_key(db_session, key)).stages
        assert stages["team_worker_preset"] == {"workers": 2}
        assert stages["old"] == 1
        assert "thin_flow" in stages

    @pytest.mark.asyncio
    async def test_deleted_location_row_skipped(self, db_session: AsyncSession) -> None:
        """location='deleted' 行跳过（软删不复活，防复活口径）。"""
        uid = await _seed_user(db_session)
        daemon_id = await _seed_daemon(db_session, uid)
        change = await _seed_change(db_session, change_key="2026-10-26-thin-j", location="deleted")
        key, ws_id = change.change_key, change.workspace_id

        await _heartbeat(db_session, daemon_id, [_flow_item(ws_id, key)])

        stages = (await _reload_by_key(db_session, key)).stages or {}
        assert "thin_flow" not in stages
