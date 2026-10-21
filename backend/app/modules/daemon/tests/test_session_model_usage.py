"""会话 × 模型用量明细端点（GET /api/daemon/sessions/{id}/model-usage）单测。

钉死只读契约：
- 数据形状：``agent_run_model_usage`` 行（run × model，含 cache 两维——该表确有
  列）+ 所属 ``AgentRun`` 起止时间；只输出契约字段，不含日志正文 / system_prompt；
- 排序：轮次序优先（``AgentRun.created_at`` asc），轮内 ``started_at`` /
  ``model`` 兜底——run2 的 started_at 更早也不得插到 run1 之前；
- 归属：他人会话 / 不存在会话同 404（resource-hiding，不泄露存在性）；
- 空态：无 run / 有 run 但无明细行 → 200 + 空 items + truncated=false；
- 硬上限：``_SESSION_MODEL_USAGE_MAX`` 溢出 → 裁剪到上限 + truncated=true。

参照 test_session_fast_replay.py 的 client + auth_headers + db_session 范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.router.session_insights as insights_mod
from app.modules.agent.model import AgentRun, AgentRunModelUsage, AgentSession
from app.modules.auth.model import User

# 契约字段（顺序无关；显式钉死防新增字段把日志正文 / system_prompt 带出来）。
_ITEM_KEYS = {
    "run_id",
    "model",
    "started_at",
    "finished_at",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_creation_tokens",
}


async def _admin_id(db_session: AsyncSession) -> uuid.UUID:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"model-usage-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _seed_session(db_session: AsyncSession, *, owner_id: uuid.UUID) -> uuid.UUID:
    sid = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
        )
    )
    await db_session.commit()
    return sid


def _run(
    sid: uuid.UUID,
    *,
    created_at: datetime,
    started_at: datetime | None,
    finished_at: datetime | None = None,
) -> AgentRun:
    return AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status="completed",
        agent_session_id=sid,
        created_at=created_at,
        started_at=started_at,
        finished_at=finished_at,
    )


def _usage(
    run_id: uuid.UUID,
    *,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
) -> AgentRunModelUsage:
    return AgentRunModelUsage(
        id=uuid.uuid4(),
        run_id=run_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
    )


class TestSessionModelUsage:
    async def test_rows_two_runs_two_models_ordered_by_run_then_started_at(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """2 run × 2 model：明细行直映真实列（含 cache 两维），按轮次序升序。

        run2 的 started_at 刻意早于 run1（派发异常轮形态）——排序必须以
        ``created_at`` 轮次序为准，run2 不得插到 run1 之前。
        """
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)

        run1 = _run(
            sid,
            created_at=base,
            started_at=base + timedelta(seconds=5),
            finished_at=base + timedelta(seconds=30),
        )
        # run2 轮次序在后（created_at 更晚），但 started_at 更早。
        run2 = _run(
            sid,
            created_at=base + timedelta(seconds=60),
            started_at=base - timedelta(seconds=30),
            finished_at=base + timedelta(seconds=90),
        )
        db_session.add_all([run1, run2])
        await db_session.commit()

        # 插入序刻意乱序（gpt-5 先插），验证 DB 侧 order by 生效。
        db_session.add_all(
            [
                _usage(run1.id, model="gpt-5", input_tokens=222, output_tokens=33),
                _usage(
                    run1.id,
                    model="claude-sonnet-4",
                    input_tokens=111,
                    output_tokens=22,
                    cache_read_tokens=33,
                    cache_creation_tokens=44,
                ),
                _usage(run2.id, model="gpt-5", input_tokens=333, output_tokens=55),
            ]
        )
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/model-usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["session_id"] == str(sid)
        assert body["truncated"] is False

        items = body["items"]
        # 轮次序：run1 两行（轮内 model 升序）→ run2 一行。
        assert [(it["run_id"], it["model"]) for it in items] == [
            (str(run1.id), "claude-sonnet-4"),
            (str(run1.id), "gpt-5"),
            (str(run2.id), "gpt-5"),
        ]

        first = items[0]
        assert set(first) == _ITEM_KEYS  # 不含日志正文 / system_prompt 等
        assert first["input_tokens"] == 111
        assert first["output_tokens"] == 22
        assert first["cache_read_tokens"] == 33
        assert first["cache_creation_tokens"] == 44
        assert first["started_at"] is not None
        assert first["finished_at"] is not None
        # 每行起止时间取所属 run（run1 两行同值，run2 行不同）。
        assert items[1]["started_at"] == first["started_at"]
        assert items[2]["started_at"] != first["started_at"]
        assert items[2]["input_tokens"] == 333
        assert items[2]["output_tokens"] == 55
        assert items[2]["cache_read_tokens"] == 0
        assert items[2]["cache_creation_tokens"] == 0

    async def test_404_cross_user_and_unknown_session(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """他人会话 / 不存在的会话 → 同 404（resource-hiding 不泄露存在性）。"""
        other = await _seed_user(db_session)
        other_sid = await _seed_session(db_session, owner_id=other)

        resp = await client.get(
            f"/api/daemon/sessions/{other_sid}/model-usage", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

        unknown = await client.get(
            f"/api/daemon/sessions/{uuid.uuid4()}/model-usage", headers=auth_headers
        )
        assert unknown.status_code == 404, unknown.text
        assert unknown.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    async def test_empty_session_and_run_without_usage_rows(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """空会话（无 run）与「有 run 但无明细行」（老 run 未上报 modelUsage）均
        返回 200 + 空 items + truncated=false（不报错、不伪造）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)

        resp = await client.get(f"/api/daemon/sessions/{sid}/model-usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"session_id": str(sid), "items": [], "truncated": False}

        base = datetime.now(UTC) - timedelta(minutes=5)
        db_session.add(_run(sid, created_at=base, started_at=base))
        await db_session.commit()

        resp_run_only = await client.get(
            f"/api/daemon/sessions/{sid}/model-usage", headers=auth_headers
        )
        assert resp_run_only.status_code == 200, resp_run_only.text
        assert resp_run_only.json() == {"session_id": str(sid), "items": [], "truncated": False}

    async def test_truncated_flag_when_over_hard_cap(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """明细行超硬上限：裁剪到上限（保留轮次序前 N 行）并置 truncated=true
        （常量 setattr 调小验证，真实上限 2000）。"""
        monkeypatch.setattr(insights_mod, "_SESSION_MODEL_USAGE_MAX", 3)

        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=5)
        run1 = _run(sid, created_at=base, started_at=base)
        db_session.add(run1)
        await db_session.commit()
        db_session.add_all([_usage(run1.id, model=f"model-{i}") for i in range(5)])
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/model-usage", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["truncated"] is True
        assert [it["model"] for it in body["items"]] == ["model-0", "model-1", "model-2"]
