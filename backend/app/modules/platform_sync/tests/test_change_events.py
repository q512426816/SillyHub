"""platform_sync 变更事件通道测试（change 2026-09-26-change-events-r18-full）。

task-01 四组：收 / 去重 / 鉴权 / 上限（task-02 增第五组「取」）。
红线 D-004：provisional 原值透传、零业务判定（存储无流程外键）。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.modules.platform_sync.model import PlatformChangeEventORM


def _event(
    *,
    ts: str,
    rule: str = "stage-stuck",
    kind: str = "watchdog",
    severity: str = "info",
    detail: str | None = "详情",
    event_id: str | None = None,
) -> dict[str, Any]:
    """构造 watcher 推送事件 body（id 可缺省——回退 ts+rule 去重键）。"""
    body: dict[str, Any] = {
        "kind": kind,
        "rule": rule,
        "severity": severity,
        "provisional": True,
        "detail": detail,
        "ts": ts,
    }
    if event_id is not None:
        body["id"] = event_id
    return body


async def _count_rows(db_session: Any, change_name: str) -> int:
    stmt = (
        select(func.count())
        .select_from(PlatformChangeEventORM)
        .where(PlatformChangeEventORM.change_name == change_name)
    )
    return int((await db_session.execute(stmt)).scalar_one())


class TestPush:
    """收：POST 落库断言。"""

    async def test_push_stores_event_row(
        self, client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
    ) -> None:
        _ws, headers = shpsync_headers
        resp = await client.post(
            "/api/changes/evt-push-demo/events",
            headers=headers,
            json=_event(ts="2026-09-26T06:00:00Z", severity="warning"),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["change_name"] == "evt-push-demo"
        assert body["stored"] is True
        assert body["deduplicated"] is False
        assert body["truncated"] == 0

    async def test_push_row_fields_match_payload(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        _ws, headers = shpsync_headers
        await client.post(
            "/api/changes/evt-fields/events",
            headers=headers,
            json=_event(
                ts="2026-09-26T06:01:00Z",
                rule="gate-retry-storm",
                kind="watchdog",
                severity="warning",
                detail="同一门禁 10 分钟内拦截 4 次",
                event_id="evt-abc-001",
            ),
        )
        rows = (
            (
                await db_session.execute(
                    select(PlatformChangeEventORM).where(
                        PlatformChangeEventORM.change_name == "evt-fields"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        row = rows[0]
        assert row.kind == "watchdog"
        assert row.rule == "gate-retry-storm"
        assert row.severity == "warning"
        assert row.provisional is True  # 红线：原值透传
        assert row.detail == "同一门禁 10 分钟内拦截 4 次"
        assert row.ts == "2026-09-26T06:01:00Z"
        assert row.dedup_key == "evt-abc-001"

    async def test_push_defaults_provisional_and_severity(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """body 缺 provisional/severity → 缺省 true/info（schema 兜底）。"""
        _ws, headers = shpsync_headers
        resp = await client.post(
            "/api/changes/evt-defaults/events",
            headers=headers,
            json={"kind": "heartbeat", "rule": "cli-alive", "ts": "2026-09-26T06:02:00Z"},
        )
        assert resp.status_code == 200
        row = (
            await db_session.execute(
                select(PlatformChangeEventORM).where(
                    PlatformChangeEventORM.change_name == "evt-defaults"
                )
            )
        ).scalar_one()
        assert row.provisional is True
        assert row.severity == "info"


class TestDedup:
    """去重：事件 id 优先 / ts+rule 回退。"""

    async def test_duplicate_same_event_id(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        _ws, headers = shpsync_headers
        payload = _event(ts="2026-09-26T06:03:00Z", event_id="evt-dup-1")
        first = await client.post("/api/changes/evt-dedup/events", headers=headers, json=payload)
        assert first.json()["deduplicated"] is False
        second = await client.post("/api/changes/evt-dedup/events", headers=headers, json=payload)
        assert second.status_code == 200
        assert second.json()["deduplicated"] is True
        assert await _count_rows(db_session, "evt-dedup") == 1

    async def test_duplicate_fallback_ts_rule(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """无 id：同 (ts, rule) 二次推不增行；同 ts 不同 rule 是新事件。"""
        _ws, headers = shpsync_headers
        await client.post(
            "/api/changes/evt-fallback/events",
            headers=headers,
            json=_event(ts="2026-09-26T06:04:00Z", rule="r1"),
        )
        again = await client.post(
            "/api/changes/evt-fallback/events",
            headers=headers,
            json=_event(ts="2026-09-26T06:04:00Z", rule="r1"),
        )
        assert again.json()["deduplicated"] is True
        await client.post(
            "/api/changes/evt-fallback/events",
            headers=headers,
            json=_event(ts="2026-09-26T06:04:00Z", rule="r2"),
        )
        assert await _count_rows(db_session, "evt-fallback") == 2

    async def test_dedup_scoped_by_change_name(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """同去重键不同 change_name → 各自一行（去重键含 change_name 维度）。"""
        _ws, headers = shpsync_headers
        payload = _event(ts="2026-09-26T06:05:00Z", event_id="evt-shared-id")
        await client.post("/api/changes/evt-a/events", headers=headers, json=payload)
        await client.post("/api/changes/evt-b/events", headers=headers, json=payload)
        assert await _count_rows(db_session, "evt-a") == 1
        assert await _count_rows(db_session, "evt-b") == 1


class TestAuth:
    """鉴权：写通道仅 shpsync_。"""

    async def test_push_no_token_401(self, client: AsyncClient) -> None:
        resp = await client.post("/api/changes/x/events", json=_event(ts="2026-09-26T06:06:00Z"))
        assert resp.status_code == 401

    async def test_push_jwt_403(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        resp = await client.post(
            "/api/changes/x/events",
            headers=auth_headers,
            json=_event(ts="2026-09-26T06:06:00Z"),
        )
        assert resp.status_code == 403

    async def test_push_api_key_403(
        self, client: AsyncClient, apikey_headers: dict[str, str]
    ) -> None:
        resp = await client.post(
            "/api/changes/x/events",
            headers=apikey_headers,
            json=_event(ts="2026-09-26T06:06:00Z"),
        )
        assert resp.status_code == 403


class TestCap:
    """上限：单变更 >5000 截断最旧不拒绝。"""

    @pytest.mark.parametrize("over_by", [1, 3])
    async def test_cap_trims_oldest(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
        over_by: int,
    ) -> None:
        """预置 5000 条 → 再推 over_by 条：旧行被截、新事件恒 200 存入。"""
        import uuid as _uuid

        _ws, headers = shpsync_headers
        change = f"evt-cap-{over_by}"
        # 预置 5000 条（bulk 直插，绕开 HTTP：上限行为只验 service/端点截断）
        db_session.add_all(
            PlatformChangeEventORM(
                id=_uuid.uuid4(),
                workspace_id=_ws,
                change_name=change,
                dedup_key=f"seed-{i}",
                kind="watchdog",
                rule="seed",
                severity="info",
                provisional=True,
                detail=None,
                ts=f"2026-09-25T06:{i // 60:02d}:{i % 60:02d}Z",  # i 升序=时间升序
            )
            for i in range(5000)
        )
        await db_session.commit()
        resp = await client.post(
            f"/api/changes/{change}/events",
            headers=headers,
            json=_event(ts="2026-09-26T07:00:00Z", event_id="evt-new-1"),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["stored"] is True
        assert resp.json()["truncated"] >= 1
        assert await _count_rows(db_session, change) <= 5000
        # 最旧 seed 行被截（seed-0 不在），最新事件在
        keys = {
            r
            for (r,) in await db_session.execute(
                select(PlatformChangeEventORM.dedup_key).where(
                    PlatformChangeEventORM.change_name == change
                )
            )
        }
        assert "seed-0" not in keys
        assert "evt-new-1" in keys


# ── task-02：第五组「取」（GET 正序/增量/隔离/JWT 读通道）──


class TestList:
    """取：GET 正序增量。"""

    async def _push_three(self, client: AsyncClient, headers: dict[str, str], change: str) -> None:
        for ts in ("2026-09-26T06:10:00Z", "2026-09-26T06:11:00Z", "2026-09-26T06:12:00Z"):
            resp = await client.post(
                f"/api/changes/{change}/events",
                headers=headers,
                json=_event(ts=ts, event_id=f"{change}-{ts}"),
            )
            assert resp.status_code == 200

    async def test_get_returns_chronological_order(
        self, client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
    ) -> None:
        """GET 输出按 ts 正序（推入顺序打乱仍正序）。"""
        _ws, headers = shpsync_headers
        change = "evt-list-order"
        for ts in ("2026-09-26T06:20:02Z", "2026-09-26T06:20:00Z", "2026-09-26T06:20:01Z"):
            await client.post(
                f"/api/changes/{change}/events",
                headers=headers,
                json=_event(ts=ts, event_id=f"o-{ts}"),
            )
        resp = await client.get(f"/api/changes/{change}/events", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["change_name"] == change
        assert body["count"] == 3
        ts_list = [it["ts"] for it in body["items"]]
        assert ts_list == sorted(ts_list)  # 正序

    async def test_get_since_strictly_greater(
        self, client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
    ) -> None:
        """since 严格大于：不含等值行。"""
        _ws, headers = shpsync_headers
        change = "evt-list-since"
        await self._push_three(client, headers, change)
        resp = await client.get(
            f"/api/changes/{change}/events",
            headers=headers,
            params={"since": "2026-09-26T06:11:00Z"},
        )
        assert resp.status_code == 200
        ts_list = [it["ts"] for it in resp.json()["items"]]
        assert ts_list == ["2026-09-26T06:12:00Z"]

    async def test_get_workspace_isolation(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """shpsync_ 收件箱隔离：他 workspace 事件不可见。"""
        import uuid as _uuid

        from app.modules.workspace.model import Workspace

        _ws, headers = shpsync_headers
        change = "evt-list-iso"
        await client.post(
            f"/api/changes/{change}/events",
            headers=headers,
            json=_event(ts="2026-09-26T06:30:00Z", event_id="iso-1"),
        )
        other = Workspace(
            id=_uuid.uuid4(),
            name=f"ws-other-{_uuid.uuid4().hex[:6]}",
            slug=f"ws-other-{_uuid.uuid4().hex[:6]}",
            root_path=f"/tmp/ws-other-{_uuid.uuid4().hex[:6]}",
            status="active",
        )
        db_session.add(other)
        await db_session.commit()
        db_session.add(
            PlatformChangeEventORM(
                workspace_id=other.id,
                change_name=change,
                dedup_key="foreign-1",
                kind="watchdog",
                rule="foreign",
                severity="info",
                provisional=True,
                ts="2026-09-26T06:31:00Z",
            )
        )
        await db_session.commit()
        resp = await client.get(f"/api/changes/{change}/events", headers=headers)
        items = resp.json()["items"]
        assert [it["rule"] for it in items] == ["stage-stuck"]  # 只见本 workspace

    async def test_get_jwt_can_read(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        auth_headers: dict[str, str],
    ) -> None:
        """JWT 读通道可读（前端面板走此路径，X-003 实证）。"""
        _ws, shp = shpsync_headers
        change = "evt-list-jwt"
        await client.post(
            f"/api/changes/{change}/events",
            headers=shp,
            json=_event(ts="2026-09-26T06:40:00Z", event_id="jwt-1"),
        )
        resp = await client.get(f"/api/changes/{change}/events", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    async def test_get_latest_n_then_chronological(
        self,
        client: AsyncClient,
        db_session: Any,
        shpsync_headers: tuple[Any, dict[str, str]],
    ) -> None:
        """无 since 且 >200 条 → 回最新 200 条且仍正序（Grill X-001）。"""
        import uuid as _uuid

        _ws, headers = shpsync_headers
        change = "evt-list-cap200"
        db_session.add_all(
            PlatformChangeEventORM(
                id=_uuid.uuid4(),
                workspace_id=_ws,
                change_name=change,
                dedup_key=f"l-{i}",
                kind="watchdog",
                rule="seed",
                severity="info",
                provisional=True,
                ts=f"2026-09-26T05:{i // 60:02d}:{i % 60:02d}Z",
            )
            for i in range(250)
        )
        await db_session.commit()
        resp = await client.get(f"/api/changes/{change}/events", headers=headers)
        body = resp.json()
        assert body["count"] == 200
        ts_list = [it["ts"] for it in body["items"]]
        assert ts_list == sorted(ts_list)  # 仍正序
        assert ts_list[0] > "2026-09-26T05:00:49Z"  # 最旧 50 条被排除（最新 200）
