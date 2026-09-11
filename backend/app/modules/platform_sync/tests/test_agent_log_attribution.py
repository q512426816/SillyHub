"""POST /api/agent-logs ctx-owner 两级 find 归属解析测试。

2026-09-11-agent-log-attribution-refactor task-04（design §Phase 2 / FR-02 /
FR-03 / D-002 / D-003 / D-006@v2 / DG-05）：无 hub 分支归属解析专项——

- hub 登记后本地同 ctx 跨 harness 挂接（hub push 落 links 登记 → 无 hub push
  第一级 find 挂 hub 会话、不建新桶，跨 harness 不限制 D-009@v1）；
- 两级 find 第二级聚合键兜底（links 未登记 / bind 失败遗漏的组由
  ``aggregation_key="{ctx}"`` 收敛，挂后 bind 修复登记缺口）；
- 无主 find-or-create（键 ``"{ctx}"``、title「本地 · {ctx}」，同一次 push 里
  同 ctx 跨 harness 双条目收敛同一 owner）；
- 空 ctx 单桶不变（``{harness}|`` 键 + 「{harness} · 本地活动」标题，跨
  harness 各自桶）；
- 同 ctx 幂等重推（不建第二会话、只刷 last_active_at、status 不变）；
- 旧双键 payload 过渡期证据（AC-4：同 entry 带 change_key+quick_id 归 quick
  组，quick owner 存在即赢，即使 change owner 更新）；
- hub 分支时间过滤回归（早于会话 created_at 的条目不挂、ctx 不登记）；
- owner 命中不改 status/turn_count（生命周期契约）。

鉴权 / 落库 / 去重 / scope 等通用行为见 test_agent_log_push.py（本文件只测
归属解析，用例经 router 认证路径推送、不直调 service）。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
from app.modules.platform_sync.model import AgentSessionLogORM

# hub 会话固定 created_at（同 test_agent_log_push.HUB_CREATED_AT 口径）——
# 带时间戳的条目均晚于它，hub 分支时间重叠过滤按「会话期间活跃」放行。
HUB_CREATED_AT = datetime(2026, 8, 23, 0, 0, tzinfo=UTC)
# 旧于 HUB_CREATED_AT 的 last_seen（时间过滤回归用 stale 条目）。
STALE_LAST_SEEN = "2026-08-22T23:00:00.000Z"
FRESH_LAST_SEEN = "2026-08-23T01:00:00.000Z"

PUSH_BASE: dict[str, Any] = {
    "schema_version": 1,
    "pushed_at": "2026-09-12T00:00:00.000Z",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
    "scan_run_id": "run-20260912-attr",
}


def _entry(harness: str, log_path: str, **overrides: Any) -> dict[str, Any]:
    """最小协议 entry（必填 harness + log_path，其余按需覆盖）。"""
    base: dict[str, Any] = {"harness": harness, "log_path": log_path, "exists": True}
    base.update(overrides)
    return base


def _as_utc(dt: datetime) -> datetime:
    """SQLite 测试库 datetime 列丢 tzinfo——naive 统一按 UTC 解释后再比较
    （与 service._entry_last_seen_gte 同口径）。"""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


async def _tool_report_sessions(db_session: AsyncSession) -> list[AgentSession]:
    """查全部未软删 ``origin='tool_report'`` 会话（populate_existing 惯例）。"""
    stmt = (
        select(AgentSession)
        .where(AgentSession.origin == "tool_report", AgentSession.deleted_at.is_(None))
        .execution_options(populate_existing=True)
    )
    return list((await db_session.execute(stmt)).scalars().all())


async def _log_rows_by_path(db_session: AsyncSession) -> dict[str, AgentSessionLogORM]:
    """log_path → 日志行（populate_existing 绕开身份映射旧值，既有惯例）。"""
    stmt = select(AgentSessionLogORM).execution_options(populate_existing=True)
    rows = (await db_session.execute(stmt)).scalars().all()
    return {r.log_path: r for r in rows}


async def _change_links(db_session: AsyncSession) -> list[ChangeSessionLink]:
    stmt = select(ChangeSessionLink).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


async def _quicklog_links(db_session: AsyncSession) -> list[QuicklogSessionLink]:
    stmt = select(QuicklogSessionLink).execution_options(populate_existing=True)
    return list((await db_session.execute(stmt)).scalars().all())


async def _session_by_id(db_session: AsyncSession, session_id: Any) -> AgentSession:
    """按 id 取会话（populate_existing 强制读库新值，供 status/活跃时间断言）。"""
    stmt = (
        select(AgentSession)
        .where(AgentSession.id == session_id)
        .execution_options(populate_existing=True)
    )
    return (await db_session.execute(stmt)).scalar_one()


# ── ① hub 登记后本地同 ctx 跨 harness 挂接（FR-03 Given 2 / D-002）──


@pytest.mark.asyncio
async def test_hub_registered_ctx_local_cross_harness_attaches_hub_session(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """先 hub push（body hub_session_id = SILLYHUB_SESSION_ID 注入形态）登记 ctx 绑定，
    再无 hub push 同 ctx 不同 harness → 第一级 find（links）挂 hub 会话，不建新桶。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    # 平台派发 pi 会话（daemon 派发，provider=pi）。
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="pi",
        status="active",  # 故意非默认：断言挂接不改 status
        created_at=HUB_CREATED_AT,
    )
    db_session.add(hub)
    await db_session.commit()

    # 第一步：hub push 带 ctx=X——hub 分支挂接 + 落 change 绑定（= 登记「hub 会话 ↔ ctx」）。
    resp1 = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "hub_session_id": str(hub.id),
            "entries": [
                _entry(
                    "pi",
                    "C:/Users/qinyi/.pi/sessions/hub-reg-pi.jsonl",
                    change_key="change-hub-reg",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp1.status_code == 200
    changes = list(
        (await db_session.execute(select(Change).execution_options(populate_existing=True)))
        .scalars()
        .all()
    )
    assert [c.change_key for c in changes] == ["change-hub-reg"]  # placeholder 登记
    assert [(ln.change_id, ln.session_id) for ln in await _change_links(db_session)] == [
        (changes[0].id, hub.id)
    ]

    # 第二步：无 hub push 同 ctx=X、不同 harness（本地 zcode 窗口）。
    resp2 = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/local-zcode.jsonl",
                    change_key="change-hub-reg",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp2.status_code == 200

    rows = await _log_rows_by_path(db_session)
    assert rows["C:/Users/qinyi/.pi/sessions/hub-reg-pi.jsonl"].agent_session_id == hub.id
    # 跨 harness 挂接（D-009@v1 否决拦截）：zcode 条目挂 pi 会话。
    assert rows["C:/Users/qinyi/.zcode/cli/rollout/local-zcode.jsonl"].agent_session_id == hub.id
    assert await _tool_report_sessions(db_session) == []  # 不建新桶
    assert len(await _change_links(db_session)) == 1  # 组级 bind 幂等（已有 link 即返回）
    # hub 会话 status 不变（命中只刷 last_active_at，生命周期契约）。
    assert (await _session_by_id(db_session, hub.id)).status == "active"


# ── ② 两级 find 第二级：聚合键兜底（DG-05：bind 失败/未登记遗漏组收敛）──


@pytest.mark.asyncio
async def test_level2_aggregation_key_fallback_attaches_existing_bucket(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """links 无该 ctx 行（bind 从未成功场景）但存在 aggregation_key="{ctx}" 的
    tool_report 会话 → 第二级兜底命中，挂它不新建；组级 bind 顺带修复登记缺口。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    old_active_at = datetime(2026, 8, 20, tzinfo=UTC)
    orphan_bucket = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        origin="tool_report",
        aggregation_key="orphan-ctx",  # 新值域：纯 ctx、无 harness 前缀
        last_active_at=old_active_at,
    )
    db_session.add(orphan_bucket)
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/orphan-zcode.jsonl",
                    change_key="orphan-ctx",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert [s.id for s in sessions] == [orphan_bucket.id]  # 兜底命中，不新建
    rows = await _log_rows_by_path(db_session)
    assert rows["C:/Users/qinyi/.zcode/cli/rollout/orphan-zcode.jsonl"].agent_session_id == (
        orphan_bucket.id
    )
    refreshed = await _session_by_id(db_session, orphan_bucket.id)
    assert refreshed.last_active_at is not None
    assert _as_utc(refreshed.last_active_at) > old_active_at  # 命中刷活跃时间
    # 组级 bind 修复登记缺口：change placeholder + link 落到兜底会话。
    changes = list(
        (await db_session.execute(select(Change).execution_options(populate_existing=True)))
        .scalars()
        .all()
    )
    assert [c.change_key for c in changes] == ["orphan-ctx"]
    assert [(ln.change_id, ln.session_id) for ln in await _change_links(db_session)] == [
        (changes[0].id, orphan_bucket.id)
    ]


# ── ③ 无主 find-or-create：同一次 push 跨 harness 双条目收敛同一 owner（D-003）──


@pytest.mark.asyncio
async def test_orphan_ctx_find_or_create_cross_harness_single_owner(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """两级均未命中 → find-or-create（键 "{ctx}"、title「本地 · {ctx}」）；同一次
    push 里 zcode + pi 同 ctx 两条目只建一个会话，双条目收敛同一 owner。"""
    _ws_id, headers = shpsync_headers
    zcode_path = "C:/Users/qinyi/.zcode/cli/rollout/zk-fresh.jsonl"
    pi_path = "C:/Users/qinyi/.pi/sessions/pi-fresh.jsonl"
    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry("zcode", zcode_path, change_key="fresh-ctx", last_seen_at=FRESH_LAST_SEEN),
                _entry("pi", pi_path, change_key="fresh-ctx", last_seen_at=FRESH_LAST_SEEN),
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 1  # 跨 harness 同 ctx 只建一个 owner
    owner = sessions[0]
    assert owner.aggregation_key == "fresh-ctx"  # 无 harness 前缀（D-003@v2）
    assert owner.title == "本地 · fresh-ctx"
    assert owner.origin == "tool_report"
    assert owner.status == "pending"
    assert owner.turn_count == 0
    # provider/config_snapshot 由首个建桶组决定（zcode → claude，D-007 映射）。
    assert owner.provider == "claude"
    assert owner.config_snapshot == {"harness": "zcode"}

    rows = await _log_rows_by_path(db_session)
    assert rows[zcode_path].agent_session_id == owner.id
    assert rows[pi_path].agent_session_id == owner.id


# ── ④ 空 ctx 单桶不变：跨 harness 各自桶（D-003 边界）──


@pytest.mark.asyncio
async def test_empty_ctx_buckets_per_harness_unchanged(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """空 ctx 维持现状单桶（"{harness}|" 键 + "{harness} · 本地活动" 标题）；
    跨 harness 不合并——zcode / pi 各自一桶，空 ctx 无 links 可查不落绑定。"""
    _ws_id, headers = shpsync_headers
    zcode_path = "C:/Users/qinyi/.zcode/cli/rollout/zk-noctx.jsonl"
    pi_path = "C:/Users/qinyi/.pi/sessions/pi-noctx.jsonl"
    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [_entry("zcode", zcode_path), _entry("pi", pi_path)],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 2  # 各 harness 一桶，不跨 harness 收敛
    by_key = {s.aggregation_key: s for s in sessions}
    assert set(by_key) == {"zcode|", "pi|"}
    assert by_key["zcode|"].title == "zcode · 本地活动"
    assert by_key["pi|"].title == "pi · 本地活动"

    rows = await _log_rows_by_path(db_session)
    assert rows[zcode_path].agent_session_id == by_key["zcode|"].id
    assert rows[pi_path].agent_session_id == by_key["pi|"].id
    # 空 ctx 单桶不落任何绑定（无 ctx 可绑）。
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []
    assert (
        await db_session.execute(select(Change).execution_options(populate_existing=True))
    ).scalars().all() == []


# ── ⑤ 幂等重推：同 ctx 不建第二会话、last_active_at 刷新、status 不变 ──


@pytest.mark.asyncio
async def test_same_ctx_repush_idempotent_single_owner(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """同 ctx 重推（含跨 harness 第二推）不建第二个会话；owner 只刷
    last_active_at，status/turn_count 不变，绑定行不重复。"""
    _ws_id, headers = shpsync_headers
    body1 = {
        **PUSH_BASE,
        "entries": [
            _entry(
                "zcode",
                "C:/Users/qinyi/.zcode/cli/rollout/repush-zk.jsonl",
                change_key="repush-ctx",
                last_seen_at=FRESH_LAST_SEEN,
            )
        ],
    }
    resp1 = await client.post("/api/agent-logs", json=body1, headers=headers)
    assert resp1.status_code == 200
    sessions1 = await _tool_report_sessions(db_session)
    assert len(sessions1) == 1
    first = sessions1[0]
    assert first.last_active_at is not None
    first_active_at = first.last_active_at

    # 二推：同 payload 重推 + 跨 harness 同 ctx 追加条目。
    body2 = {
        **PUSH_BASE,
        "entries": [
            *body1["entries"],
            _entry(
                "pi",
                "C:/Users/qinyi/.pi/sessions/repush-pi.jsonl",
                change_key="repush-ctx",
                last_seen_at=FRESH_LAST_SEEN,
            ),
        ],
    }
    resp2 = await client.post("/api/agent-logs", json=body2, headers=headers)
    assert resp2.status_code == 200

    sessions2 = await _tool_report_sessions(db_session)
    assert len(sessions2) == 1  # 幂等收敛：不重复建会话
    second = sessions2[0]
    assert second.id == first.id
    assert second.last_active_at is not None
    assert second.last_active_at >= first_active_at  # 只刷活跃时间
    assert second.status == "pending"  # 不改 status / turn_count
    assert second.turn_count == 0

    rows = await _log_rows_by_path(db_session)
    assert {r.agent_session_id for r in rows.values()} == {second.id}
    assert len(await _change_links(db_session)) == 1  # bind 幂等（已有 link 即返回）


# ── ⑥ 旧双键 payload 过渡期证据（AC-4：quick 优先归组）──


@pytest.mark.asyncio
async def test_legacy_dual_key_payload_groups_to_quick_owner(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """旧 CLI bug 双键条目（同 entry 带 change_key+quick_id）→ 按 quick_id 归组：
    quick owner 存在即赢（第一级 quick 查到即短路），即使 change owner 更新。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    # change owner：更新（now），经 change link 登记。
    change_owner = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        status="active",
        last_active_at=datetime.now(UTC),
    )
    # quick owner：更旧（前 1 天），经 quicklog link 登记。
    quick_owner = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        status="active",
        last_active_at=datetime.now(UTC) - timedelta(days=1),
    )
    change_row = Change(
        id=_uuid.uuid4(),
        workspace_id=ws_id,
        change_key="dual-change",
        title="dual-change",
        status="draft",
        location="active",
        path="changes/dual-change",
    )
    db_session.add_all(
        [
            change_owner,
            quick_owner,
            change_row,
            ChangeSessionLink(
                id=_uuid.uuid4(), change_id=change_row.id, session_id=change_owner.id
            ),
            QuicklogSessionLink(
                id=_uuid.uuid4(), workspace_id=ws_id, ql_id="ql-dual", session_id=quick_owner.id
            ),
        ]
    )
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/dual-key.jsonl",
                    change_key="dual-change",
                    quick_id="ql-dual",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    # 分组键 quick 优先（D-006@v2）→ 挂 quick owner，change owner（更新）不参与。
    rows = await _log_rows_by_path(db_session)
    assert rows["C:/Users/qinyi/.zcode/cli/rollout/dual-key.jsonl"].agent_session_id == (
        quick_owner.id
    )
    # 不建新桶（两级均已有 owner 候选；也不会落 change 聚合会话）。
    assert await _tool_report_sessions(db_session) == []
    # 组级绑定 quick 优先：quicklog link 幂等不重复，change link 不新增。
    quicklog_links = await _quicklog_links(db_session)
    assert [(ln.workspace_id, ln.ql_id, ln.session_id) for ln in quicklog_links] == [
        (ws_id, "ql-dual", quick_owner.id)
    ]
    assert [(ln.change_id, ln.session_id) for ln in await _change_links(db_session)] == [
        (change_row.id, change_owner.id)  # 仍是预置行，未给 quick owner 落 change 绑定
    ]


# ── ⑦ hub 分支时间过滤回归（早于会话 created_at 的条目不挂、ctx 不登记）──


@pytest.mark.asyncio
async def test_hub_push_stale_entry_time_filter_regression(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """hub 分支时间重叠过滤既有语义不变：last_seen_at 早于会话 created_at 的
    条目不挂接、ctx 不登记（后续同 ctx 无 hub 推送走 find-or-create 新桶，
    不被 stale ctx 抢挂 hub）；会话期间活跃条目照常挂 hub。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    hub = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="pi",
        status="active",
        created_at=HUB_CREATED_AT,
    )
    db_session.add(hub)
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "hub_session_id": str(hub.id),
            "entries": [
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/stale-before-hub.jsonl",
                    change_key="change-stale-ctx",
                    last_seen_at=STALE_LAST_SEEN,
                ),
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/fresh-during-hub.jsonl",
                    last_seen_at=FRESH_LAST_SEEN,
                ),
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    rows = await _log_rows_by_path(db_session)
    assert rows["C:/Users/qinyi/.zcode/cli/rollout/stale-before-hub.jsonl"].agent_session_id is None
    assert rows["C:/Users/qinyi/.zcode/cli/rollout/fresh-during-hub.jsonl"].agent_session_id == (
        hub.id
    )
    # stale 条目 ctx 属于更早的 run，不登记（无 change 行、无绑定）。
    assert (
        await db_session.execute(select(Change).execution_options(populate_existing=True))
    ).scalars().all() == []
    assert await _change_links(db_session) == []
    assert await _quicklog_links(db_session) == []

    # 后续同 ctx 无 hub 推送：未被 stale ctx 登记过 → find-or-create 新桶，
    # 不挂 hub（时间过滤守住了登记口）。
    resp2 = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry(
                    "zcode",
                    "C:/Users/qinyi/.zcode/cli/rollout/stale-ctx-local.jsonl",
                    change_key="change-stale-ctx",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp2.status_code == 200
    sessions = await _tool_report_sessions(db_session)
    assert len(sessions) == 1
    assert sessions[0].aggregation_key == "change-stale-ctx"
    rows2 = await _log_rows_by_path(db_session)
    assert rows2["C:/Users/qinyi/.zcode/cli/rollout/stale-ctx-local.jsonl"].agent_session_id == (
        sessions[0].id
    )
    assert rows2["C:/Users/qinyi/.zcode/cli/rollout/stale-before-hub.jsonl"].agent_session_id is (
        None
    )  # 重推不改写 stale 行归属


# ── ⑧ owner 命中不改 status/turn_count（生命周期契约）──


@pytest.mark.asyncio
async def test_owner_hit_preserves_status_and_turn_count(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """聚合键兜底命中已有 tool_report 会话 → 只挂条目 + 刷 last_active_at，
    status（非默认 active）/turn_count（7）原样保留，不建新会话。"""
    import uuid as _uuid

    ws_id, headers = shpsync_headers
    old_active_at = datetime(2026, 8, 20, tzinfo=UTC)
    owner = AgentSession(
        id=_uuid.uuid4(),
        user_id=_uuid.uuid4(),
        workspace_id=ws_id,
        provider="claude",
        origin="tool_report",
        aggregation_key="status-guard-ctx",
        status="active",  # 故意非默认 pending
        turn_count=7,  # 故意非 0
        last_active_at=old_active_at,
    )
    db_session.add(owner)
    await db_session.commit()

    resp = await client.post(
        "/api/agent-logs",
        json={
            **PUSH_BASE,
            "entries": [
                _entry(
                    "pi",
                    "C:/Users/qinyi/.pi/sessions/status-guard-pi.jsonl",
                    change_key="status-guard-ctx",
                    last_seen_at=FRESH_LAST_SEEN,
                )
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200

    rows = await _log_rows_by_path(db_session)
    assert rows["C:/Users/qinyi/.pi/sessions/status-guard-pi.jsonl"].agent_session_id == owner.id
    assert [s.id for s in await _tool_report_sessions(db_session)] == [owner.id]  # 无新会话
    owner_after = await _session_by_id(db_session, owner.id)
    assert owner_after.status == "active"  # 生命周期契约：不改 status
    assert owner_after.turn_count == 7  # 不动轮次计数
    assert owner_after.last_active_at is not None
    assert _as_utc(owner_after.last_active_at) > old_active_at  # 只刷活跃时间
