"""变更中心用量聚合测试（2026-08-30-change-center-usage-stats task-05 / FR-01~FR-04）。

锁定 ``ChangeUsageQueryService`` 聚合语义与两个 usage 端点 / 列表批量投影口径
（造数直写 ORM，断言数字与 DB 手工 SUM 对齐，不 mock 聚合 SQL）：

聚合语义（经 service 直调，编号对应任务卡 1-10）：
1. 纯明细：多 run 多模型——跨 run 同模型 SUM、不同模型分组、by_model
   input+output 降序、api_requests/num_turns 计入 totals；
2. 纯兜底：无明细行 run 四维列并入（NULL 列 COALESCE 0）、「未记录」桶
   model=NULL 归并且恒末位（即使总量最大）、兜底 api_requests=0；
3. 混合：明细 + 兜底并存且同名模型桶相加不丢、有明细 run 的 run 级列不重复计入；
4. 空集合：totals 全 0（含 num_turns）、by_model 空、时间三元组 None、列表 usage=None；
5. 并集去重：同 run 双锚点（change_id + 会话 link 同变更）只计一次（D-002@v1）；
6. 跨变更共享会话：两会话锚点变更各完整计该会话消耗（R-03 口径特性）；
7. 软删会话（deleted_at 非空）执行计入（D-006@v1）；
8. quicklog 恒走 quicklog_session_links 会话链路（未绑条目零值不 404）；
9. 时间三元组三种 NULL 组合（无执行 / 进行中 / 全部完成，D-001@v1）+
   MAX(finished_at) 忽略 NULL 的混合组合；
10. ctx_tokens 快照列不参与任何求和（详情两段与批量摘要两路均验）。

端点与列表（编号 11-13）：
11. GET /changes/{cid}/usage：正常 200 / 不存在 404 / 跨工作区 404（同码
    resource-hiding）/ deleted 变更 200（同既有详情端点口径）/ 缺权限 403 / 未认证 401；
12. GET /quicklog-entries/{ql_id}/usage：条目存在 200（含未绑零值）/ 不存在 404
    （严格对齐详情端点）；
13. 列表批量投影：GET /changes 与 GET /quicklog-entries 多行 usage 一次填充、
    无执行行与 deleted 行 usage 恒 None。

fixture 复用根 conftest（client/db_session/auth_headers），造数 helper 对齐
daemon/tests/test_session_usage.py（ORM 直插 run/usage）与
test_enrich_projection.py（Change 行）/ test_quicklog_router.py（文件源条目）先例。

Author: SillySpec change 2026-08-30-change-center-usage-stats (task-05)
Created: 2026-08-30
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.modules.agent.model import AgentRun, AgentRunModelUsage, AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
from app.modules.change.usage_service import ChangeUsageQueryService
from app.modules.workspace.model import Workspace

# 固定种子时间（断言经 _naive 归一为 naive 墙钟：SQLite DateTime 读写丢时区，
# 写入 aware UTC 读回 naive 墙钟值与原值数字一致）。
_T10 = datetime(2026, 8, 30, 10, 0, 0, tzinfo=UTC)
_T1030 = datetime(2026, 8, 30, 10, 30, 0, tzinfo=UTC)
_T1045 = datetime(2026, 8, 30, 10, 45, 0, tzinfo=UTC)
_T11 = datetime(2026, 8, 30, 11, 0, 0, tzinfo=UTC)
_T12 = datetime(2026, 8, 30, 12, 0, 0, tzinfo=UTC)


def _naive(value: datetime | str | None) -> datetime | None:
    """datetime / ISO 串统一剥时区（service 直调返回 datetime、端点返回 ISO 串）。"""
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=None)


async def _make_user(db_session: AsyncSession) -> uuid.UUID:
    """独立普通用户（会话行 user_id FK 锚点；service 直调用例无 auth fixture，
    不依赖 auth_headers 背后的平台管理员，对齐 test_session_usage._seed_user）。"""
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"usage-{uid}@example.com",
            password_hash="x",
            display_name="UsageT",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _make_workspace(db_session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="usage-ws",
        slug=f"usage-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_change(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    key: str,
    *,
    location: str = "active",
) -> Change:
    """Change 行直写（对齐 test_enrich_projection._make_change 模式）。"""
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=key,
        title=key,
        status="active",
        location=location,
        path=f"changes/{key}",
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)
    return change


async def _make_session(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    deleted_at: datetime | None = None,
) -> AgentSession:
    """最小会话行（usage 聚合只锚 user_id，无需 runtime/lease）。"""
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="ended",
        turn_count=1,
        created_at=_T10,
        last_active_at=_T11,
        deleted_at=deleted_at,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _make_run(
    db_session: AsyncSession,
    *,
    change_id: uuid.UUID | None = None,
    agent_session_id: uuid.UUID | None = None,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
    ctx_tokens: int | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
    duration_ms: int | None = None,
    num_turns: int | None = None,
) -> AgentRun:
    """run 行直写：四维 token 列保持 nullable（None = 老 run，兜底段 COALESCE 0）。

    ``ctx_tokens`` 为提示词大小快照列，造数刻意置大值验证不混入任何求和。
    """
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        change_id=change_id,
        agent_session_id=agent_session_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        ctx_tokens=ctx_tokens,
        started_at=started_at,
        finished_at=finished_at,
        duration_ms=duration_ms,
        num_turns=num_turns,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


async def _make_model_usage(
    db_session: AsyncSession,
    *,
    run_id: uuid.UUID,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_creation_tokens: int = 0,
    api_requests: int = 1,
) -> AgentRunModelUsage:
    """agent_run_model_usage 明细行（UNIQUE(run_id, model)，同 run 同模型一行）。"""
    usage = AgentRunModelUsage(
        id=uuid.uuid4(),
        run_id=run_id,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_creation_tokens=cache_creation_tokens,
        api_requests=api_requests,
    )
    db_session.add(usage)
    await db_session.commit()
    return usage


async def _make_change_link(
    db_session: AsyncSession, *, change_id: uuid.UUID, session_id: uuid.UUID
) -> ChangeSessionLink:
    link = ChangeSessionLink(id=uuid.uuid4(), change_id=change_id, session_id=session_id)
    db_session.add(link)
    await db_session.commit()
    return link


async def _make_quicklog_link(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    ql_id: str,
    session_id: uuid.UUID,
) -> QuicklogSessionLink:
    link = QuicklogSessionLink(
        id=uuid.uuid4(), workspace_id=workspace_id, ql_id=ql_id, session_id=session_id
    )
    db_session.add(link)
    await db_session.commit()
    return link


def _write_quicklog_file(tmp_path: Path, *ql_ids: str) -> None:
    """写文件源 quicklog 条目（格式对齐 test_quicklog_router 先例，CRLF 行尾）。"""
    quicklog_dir = tmp_path / ".sillyspec" / "quicklog"
    quicklog_dir.mkdir(parents=True, exist_ok=True)
    blocks = []
    for i, ql_id in enumerate(ql_ids):
        blocks.append(f"## {ql_id} | 2026-08-30 09:00:0{i} | 用量统计测试条目{i}\n状态：已完成\n")
    (quicklog_dir / "QUICKLOG-usage.md").write_bytes(
        "".join(blocks).replace("\n", "\r\n").encode("utf-8")
    )


def _bucket(body: dict, model: str) -> dict:
    """by_model 按模型名取桶（存在性由调用方断言顺序保证）。"""
    return next(item for item in body["by_model"] if item["model"] == model)


# ── 1-10：变更/quicklog 聚合语义（service 直调）────────────────────────────


class TestChangeAggregationSemantics:
    """ChangeUsageQueryService.get_change_usage / summarize_changes 聚合口径。"""

    async def test_pure_detail_multi_model(self, db_session: AsyncSession) -> None:
        """1 纯明细：3 run × 2 模型，跨 run 同模型 SUM、降序排序、totals 对账。

        手算：claude-sonnet-4-5（run1+run2 合并）input=1400/output=800/
        cache_read=6500/cache_creation=400/api=5（input+output=2200）；gpt-5-mini
        input=3000/output=100/api=1（3100）→ 降序 gpt 在前；totals input=4400/
        output=900/cache_read=6500/cache_creation=400/api=6/num_turns=3+4+1=8。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-detail")

        run1 = await _make_run(db_session, change_id=change.id, num_turns=3, ctx_tokens=999_999)
        run2 = await _make_run(db_session, change_id=change.id, num_turns=4)
        run3 = await _make_run(db_session, change_id=change.id, num_turns=1)
        await _make_model_usage(
            db_session,
            run_id=run1.id,
            model="claude-sonnet-4-5",
            input_tokens=1000,
            output_tokens=200,
            cache_read_tokens=5000,
            cache_creation_tokens=300,
            api_requests=3,
        )
        await _make_model_usage(
            db_session,
            run_id=run2.id,
            model="claude-sonnet-4-5",
            input_tokens=400,
            output_tokens=600,
            cache_read_tokens=1500,
            cache_creation_tokens=100,
            api_requests=2,
        )
        await _make_model_usage(
            db_session,
            run_id=run3.id,
            model="gpt-5-mini",
            input_tokens=3000,
            output_tokens=100,
            api_requests=1,
        )

        usage = await ChangeUsageQueryService(db_session).get_change_usage(ws.id, change.id)

        # by_model 两桶，input+output 降序（3100 > 2200）。
        assert [item.model for item in usage.by_model] == ["gpt-5-mini", "claude-sonnet-4-5"]
        assert usage.by_model[0].model_dump() == {
            "model": "gpt-5-mini",
            "input_tokens": 3000,
            "output_tokens": 100,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 1,
        }
        assert usage.by_model[1].model_dump() == {
            "model": "claude-sonnet-4-5",
            "input_tokens": 1400,
            "output_tokens": 800,
            "cache_read_tokens": 6500,
            "cache_creation_tokens": 400,
            "api_requests": 5,
        }
        assert usage.totals.model_dump() == {
            "input_tokens": 4400,
            "output_tokens": 900,
            "cache_read_tokens": 6500,
            "cache_creation_tokens": 400,
            "api_requests": 6,
            "num_turns": 8,
        }

    async def test_pure_fallback_bucket(self, db_session: AsyncSession) -> None:
        """2 纯兜底：无明细行四维列并入、「未记录」末位、api_requests=0。

        手算：run4（model=claude-opus-4）input=100/output=50/cache_read=1000/
        cache_creation=200/ctx=99999；run5（model=NULL → 「未记录」）input=200/
        output=80/cache 两列 NULL → 0/ctx=7777。「未记录」input+output=280 >
        150 仍恒末位；兜底桶 api_requests 无来源恒 0；duration SUM 忽略 NULL
        （1500+NULL=1500）、num_turns 同（2+NULL=2）。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-fallback")
        await _make_run(
            db_session,
            change_id=change.id,
            model="claude-opus-4",
            input_tokens=100,
            output_tokens=50,
            cache_read_tokens=1000,
            cache_creation_tokens=200,
            ctx_tokens=99_999,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1500,
            num_turns=2,
        )
        await _make_run(
            db_session,
            change_id=change.id,
            model=None,
            input_tokens=200,
            output_tokens=80,
            cache_read_tokens=None,
            cache_creation_tokens=None,
            ctx_tokens=7777,
        )

        usage = await ChangeUsageQueryService(db_session).get_change_usage(ws.id, change.id)

        assert [item.model for item in usage.by_model] == ["claude-opus-4", "未记录"]
        assert usage.by_model[0].model_dump() == {
            "model": "claude-opus-4",
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_read_tokens": 1000,
            "cache_creation_tokens": 200,
            "api_requests": 0,
        }
        assert usage.by_model[1].model_dump() == {
            "model": "未记录",
            "input_tokens": 200,
            "output_tokens": 80,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
        }
        # totals 不含 ctx_tokens（若混入 input/cache_read 会突破手算值）。
        assert usage.totals.model_dump() == {
            "input_tokens": 300,
            "output_tokens": 130,
            "cache_read_tokens": 1000,
            "cache_creation_tokens": 200,
            "api_requests": 0,
            "num_turns": 2,
        }
        # SUM(duration_ms) 忽略 NULL：1500 + NULL = 1500。
        assert usage.duration_ms == 1500

    async def test_mixed_detail_and_fallback_merge(self, db_session: AsyncSession) -> None:
        """3 混合：明细 run + 无明细 run 同名模型 → 同名桶相加不丢、totals=两段之和。

        手算：run6（有明细）明细 input=500/output=250/cache_read=100/
        cache_creation=50/api=2，run 级四维列置 9999 诱饵（有明细行不得再并入）；
        run7（无明细，model 同名）input=700/output=350/cache_read=200/
        cache_creation=80。同名桶合并 input=1200/output=600/cache_read=300/
        cache_creation=130/api=2。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-mixed")
        run6 = await _make_run(
            db_session,
            change_id=change.id,
            model="claude-sonnet-4-5",
            input_tokens=9999,
            output_tokens=9999,
            cache_read_tokens=9999,
            cache_creation_tokens=9999,
        )
        await _make_run(
            db_session,
            change_id=change.id,
            model="claude-sonnet-4-5",
            input_tokens=700,
            output_tokens=350,
            cache_read_tokens=200,
            cache_creation_tokens=80,
        )
        await _make_model_usage(
            db_session,
            run_id=run6.id,
            model="claude-sonnet-4-5",
            input_tokens=500,
            output_tokens=250,
            cache_read_tokens=100,
            cache_creation_tokens=50,
            api_requests=2,
        )

        usage = await ChangeUsageQueryService(db_session).get_change_usage(ws.id, change.id)

        assert [item.model for item in usage.by_model] == ["claude-sonnet-4-5"]
        assert usage.by_model[0].model_dump() == {
            "model": "claude-sonnet-4-5",
            "input_tokens": 1200,
            "output_tokens": 600,
            "cache_read_tokens": 300,
            "cache_creation_tokens": 130,
            "api_requests": 2,
        }
        assert usage.totals.model_dump() == {
            "input_tokens": 1200,
            "output_tokens": 600,
            "cache_read_tokens": 300,
            "cache_creation_tokens": 130,
            "api_requests": 2,
            "num_turns": 0,
        }

    async def test_empty_change_all_zero(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """4 空集合：变更无任何关联 run → 端点 200、totals 全 0、by_model 空、
        时间三元组 None、列表 usage=None。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-empty")

        usage = await ChangeUsageQueryService(db_session).get_change_usage(ws.id, change.id)
        assert usage.totals.model_dump() == {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
            "num_turns": 0,
        }
        assert usage.by_model == []
        assert (usage.started_at, usage.finished_at, usage.duration_ms) == (None, None, None)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/usage", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["by_model"] == []
        assert body["totals"] == {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
            "num_turns": 0,
        }
        assert (body["started_at"], body["finished_at"], body["duration_ms"]) == (
            None,
            None,
            None,
        )

        list_resp = await client.get(f"/api/workspaces/{ws.id}/changes", headers=auth_headers)
        assert list_resp.status_code == 200, list_resp.text
        item = next(i for i in list_resp.json()["items"] if i["id"] == str(change.id))
        assert item["usage"] is None

    async def test_union_dedup_dual_anchor(self, db_session: AsyncSession) -> None:
        """5 并集去重：同 run 同时挂 change_id 且其会话被 change_session_links
        绑定同变更 → 两锚点 UNION 整行去重只计一次（详情与批量摘要两路均验）。

        手算：runD（双锚点，有明细）input=100/output=40/api=2（input+output=140）；
        runF（仅会话锚点，无明细兜底）input=50/output=20。totals input=150（若
        runD 双计则为 250，锁定只计一次）；by_model 降序 dual(140) > fb(70)。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        owner = await _make_user(db_session)
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-dedup")
        sess = await _make_session(db_session, owner)
        await _make_change_link(db_session, change_id=change.id, session_id=sess.id)

        run_d = await _make_run(
            db_session, change_id=change.id, agent_session_id=sess.id, model="dual"
        )
        await _make_model_usage(
            db_session,
            run_id=run_d.id,
            model="dual",
            input_tokens=100,
            output_tokens=40,
            cache_read_tokens=10,
            cache_creation_tokens=5,
            api_requests=2,
        )
        await _make_run(
            db_session,
            agent_session_id=sess.id,
            model="fb",
            input_tokens=50,
            output_tokens=20,
            cache_read_tokens=5,
            cache_creation_tokens=0,
        )

        svc = ChangeUsageQueryService(db_session)
        usage = await svc.get_change_usage(ws.id, change.id)
        assert [item.model for item in usage.by_model] == ["dual", "fb"]
        assert usage.totals.model_dump() == {
            "input_tokens": 150,
            "output_tokens": 60,
            "cache_read_tokens": 15,
            "cache_creation_tokens": 5,
            "api_requests": 2,
            "num_turns": 0,
        }

        # 批量摘要锚点（(锚点 change_id, run) UNION 去重）同样只计一次。
        summary_map = await svc.summarize_changes([change.id])
        assert summary_map[change.id].totals.model_dump() == {
            "input_tokens": 150,
            "output_tokens": 60,
            "cache_read_tokens": 15,
            "cache_creation_tokens": 5,
            "api_requests": 2,
            "num_turns": 0,
        }

    async def test_shared_session_counted_in_both_changes(self, db_session: AsyncSession) -> None:
        """6 跨变更共享会话：一个会话绑两个变更 → 两变更各自完整计该会话消耗
        （D-002@v1 / R-03 口径特性，非 bug）。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        owner = await _make_user(db_session)
        change_a = await _make_change(db_session, ws.id, "2026-08-30-usage-shared-a")
        change_b = await _make_change(db_session, ws.id, "2026-08-30-usage-shared-b")
        sess = await _make_session(db_session, owner)
        await _make_change_link(db_session, change_id=change_a.id, session_id=sess.id)
        await _make_change_link(db_session, change_id=change_b.id, session_id=sess.id)

        run_r = await _make_run(db_session, agent_session_id=sess.id)
        await _make_model_usage(
            db_session,
            run_id=run_r.id,
            model="shared-model",
            input_tokens=100,
            output_tokens=10,
            api_requests=1,
        )

        svc = ChangeUsageQueryService(db_session)
        usage_a = await svc.get_change_usage(ws.id, change_a.id)
        usage_b = await svc.get_change_usage(ws.id, change_b.id)
        for usage in (usage_a, usage_b):
            assert usage.totals.model_dump() == {
                "input_tokens": 100,
                "output_tokens": 10,
                "cache_read_tokens": 0,
                "cache_creation_tokens": 0,
                "api_requests": 1,
                "num_turns": 0,
            }
            assert [item.model for item in usage.by_model] == ["shared-model"]

        # 批量摘要一次查询两变更各得一份完整摘要。
        summary_map = await svc.summarize_changes([change_a.id, change_b.id])
        assert set(summary_map) == {change_a.id, change_b.id}
        assert summary_map[change_a.id].totals == usage_a.totals
        assert summary_map[change_b.id].totals == usage_b.totals

    async def test_soft_deleted_session_runs_counted(self, db_session: AsyncSession) -> None:
        """7 软删会话（agent_sessions.deleted_at 非空）执行仍计入（D-006@v1：
        消耗真实发生；会话卡 UI 隐藏是展示层考虑，与用量口径不矛盾）。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        owner = await _make_user(db_session)
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-softdel")
        sess = await _make_session(db_session, owner, deleted_at=_T11)
        await _make_change_link(db_session, change_id=change.id, session_id=sess.id)

        run = await _make_run(db_session, agent_session_id=sess.id, num_turns=4)
        await _make_model_usage(
            db_session,
            run_id=run.id,
            model="softdel-model",
            input_tokens=300,
            output_tokens=30,
            cache_read_tokens=90,
            api_requests=2,
        )

        usage = await ChangeUsageQueryService(db_session).get_change_usage(ws.id, change.id)
        assert usage.totals.model_dump() == {
            "input_tokens": 300,
            "output_tokens": 30,
            "cache_read_tokens": 90,
            "cache_creation_tokens": 0,
            "api_requests": 2,
            "num_turns": 4,
        }

    async def test_time_triple_null_combinations(self, db_session: AsyncSession) -> None:
        """9 时间三元组三种 NULL 组合（D-001@v1 执行时间口径）+ MAX 忽略 NULL。

        - 无执行：三值全 None；
        - 进行中：单 run started 有值 finished/duration NULL → (T, None, None)；
          已开始且带累计时长 → duration 有值（FR-01「耗时显示已有累计值」）；
        - 全部完成：MIN(started)/MAX(finished)/SUM(duration) 精确对账；
        - 混合（完成 + 进行中）：MAX(finished) 忽略 NULL 取已完成值（SQL 聚合
          语义，design 总体方案固化），SUM(duration) 两段累加。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        c_none = await _make_change(db_session, ws.id, "2026-08-30-usage-t-none")
        c_prog = await _make_change(db_session, ws.id, "2026-08-30-usage-t-prog")
        c_done = await _make_change(db_session, ws.id, "2026-08-30-usage-t-done")
        c_mixed = await _make_change(db_session, ws.id, "2026-08-30-usage-t-mixed")

        # 进行中：started 有值、finished/duration NULL。
        await _make_run(db_session, change_id=c_prog.id, started_at=_T12)
        # 全部完成：两 run。
        await _make_run(
            db_session,
            change_id=c_done.id,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1500,
        )
        await _make_run(
            db_session,
            change_id=c_done.id,
            started_at=_T1045,
            finished_at=_T11,
            duration_ms=2500,
        )
        # 混合：一完成 + 一进行中（带累计时长 5000）。
        await _make_run(
            db_session,
            change_id=c_mixed.id,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1500,
        )
        await _make_run(
            db_session, change_id=c_mixed.id, started_at=_T12, finished_at=None, duration_ms=5000
        )

        svc = ChangeUsageQueryService(db_session)
        none_usage = await svc.get_change_usage(ws.id, c_none.id)
        assert (none_usage.started_at, none_usage.finished_at, none_usage.duration_ms) == (
            None,
            None,
            None,
        )

        prog_usage = await svc.get_change_usage(ws.id, c_prog.id)
        assert _naive(prog_usage.started_at) == _T12.replace(tzinfo=None)
        assert prog_usage.finished_at is None
        assert prog_usage.duration_ms is None

        done_usage = await svc.get_change_usage(ws.id, c_done.id)
        assert _naive(done_usage.started_at) == _T10.replace(tzinfo=None)
        assert _naive(done_usage.finished_at) == _T11.replace(tzinfo=None)
        assert done_usage.duration_ms == 4000

        mixed_usage = await svc.get_change_usage(ws.id, c_mixed.id)
        assert _naive(mixed_usage.started_at) == _T10.replace(tzinfo=None)
        assert _naive(mixed_usage.finished_at) == _T1030.replace(tzinfo=None)
        assert mixed_usage.duration_ms == 6500

    async def test_ctx_tokens_snapshot_excluded(self, db_session: AsyncSession) -> None:
        """10 ctx_tokens 快照列不参与任何求和：明细 run 与兜底 run 均置大值，
        详情两段聚合与批量摘要的 token 四维均不受影响。

        手算：runA（有明细，ctx=9999999）明细 input=100/output=50/api=1；
        runB（无明细兜底，ctx=8888888）input=30/output=10。totals input=130/
        output=60/api=1（若 ctx 混入任一维度即突破手算值）。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-ctx")
        run_a = await _make_run(db_session, change_id=change.id, ctx_tokens=9_999_999, num_turns=2)
        await _make_run(
            db_session,
            change_id=change.id,
            input_tokens=30,
            output_tokens=10,
            ctx_tokens=8_888_888,
        )
        await _make_model_usage(
            db_session,
            run_id=run_a.id,
            model="ctx-model",
            input_tokens=100,
            output_tokens=50,
            api_requests=1,
        )

        svc = ChangeUsageQueryService(db_session)
        usage = await svc.get_change_usage(ws.id, change.id)
        assert usage.totals.model_dump() == {
            "input_tokens": 130,
            "output_tokens": 60,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 1,
            "num_turns": 2,
        }

        summary_map = await svc.summarize_changes([change.id])
        assert summary_map[change.id].totals.model_dump() == {
            "input_tokens": 130,
            "output_tokens": 60,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 1,
            "num_turns": 2,
        }


# ── 8：quicklog 聚合语义（service 直调）──────────────────────────────────


class TestQuicklogAggregationSemantics:
    """get_quicklog_usage 恒走 quicklog_session_links 会话链路（FR-02）。"""

    async def test_quicklog_link_path_and_unbound(self, db_session: AsyncSession) -> None:
        """8 quicklog 链路：绑会话的 run 计入（含软删噪声之外的无关 run 排除）；
        未绑条目零值不 404。

        手算：runQ（绑定会话内）input=250/output=25/cache_read=75/api=3/
        turns=6/duration=1200；噪声 run（挂别的 change_id、无 quicklog link）
        不得计入。未绑 ql2 → totals 全 0 + 三元组 None。
        """
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        owner = await _make_user(db_session)
        sess = await _make_session(db_session, owner)
        ql_bound = "ql-20260830-701-bound"
        ql_unbound = "ql-20260830-702-unbound"
        await _make_quicklog_link(
            db_session, workspace_id=ws.id, ql_id=ql_bound, session_id=sess.id
        )

        run_q = await _make_run(
            db_session,
            agent_session_id=sess.id,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1200,
            num_turns=6,
        )
        await _make_model_usage(
            db_session,
            run_id=run_q.id,
            model="ql-model",
            input_tokens=250,
            output_tokens=25,
            cache_read_tokens=75,
            api_requests=3,
        )
        # 噪声：挂 change_id 的派发 run（无 quicklog link）不属于 quicklog 集合。
        noise_change = await _make_change(db_session, ws.id, "2026-08-30-usage-ql-noise")
        noise_run = await _make_run(db_session, change_id=noise_change.id)
        await _make_model_usage(
            db_session, run_id=noise_run.id, model="noise-model", input_tokens=999
        )

        svc = ChangeUsageQueryService(db_session)
        bound_usage = await svc.get_quicklog_usage(ws.id, ql_bound)
        assert bound_usage.totals.model_dump() == {
            "input_tokens": 250,
            "output_tokens": 25,
            "cache_read_tokens": 75,
            "cache_creation_tokens": 0,
            "api_requests": 3,
            "num_turns": 6,
        }
        assert [item.model for item in bound_usage.by_model] == ["ql-model"]
        assert _naive(bound_usage.started_at) == _T10.replace(tzinfo=None)
        assert bound_usage.duration_ms == 1200

        unbound_usage = await svc.get_quicklog_usage(ws.id, ql_unbound)
        assert unbound_usage.totals.model_dump() == {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_creation_tokens": 0,
            "api_requests": 0,
            "num_turns": 0,
        }
        assert unbound_usage.by_model == []
        assert (unbound_usage.started_at, unbound_usage.finished_at, unbound_usage.duration_ms) == (
            None,
            None,
            None,
        )


# ── 11：GET /changes/{cid}/usage 端点 ─────────────────────────────────────


class TestChangeUsageEndpoint:
    """变更维度 usage 端点（task-04 / FR-03：权限、404 resource-hiding、deleted 口径）。"""

    async def test_200_ok(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """正常 200：明细聚合数字 + 时间三元组逐字段精确对账。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-endpoint")
        run = await _make_run(
            db_session,
            change_id=change.id,
            num_turns=5,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1800,
        )
        await _make_model_usage(
            db_session,
            run_id=run.id,
            model="endpoint-model",
            input_tokens=700,
            output_tokens=70,
            cache_read_tokens=7,
            api_requests=2,
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/usage", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["totals"] == {
            "input_tokens": 700,
            "output_tokens": 70,
            "cache_read_tokens": 7,
            "cache_creation_tokens": 0,
            "api_requests": 2,
            "num_turns": 5,
        }
        assert body["by_model"] == [
            {
                "model": "endpoint-model",
                "input_tokens": 700,
                "output_tokens": 70,
                "cache_read_tokens": 7,
                "cache_creation_tokens": 0,
                "api_requests": 2,
            }
        ]
        assert _naive(body["started_at"]) == _T10.replace(tzinfo=None)
        assert _naive(body["finished_at"]) == _T1030.replace(tzinfo=None)
        assert body["duration_ms"] == 1800

    async def test_404_unknown_change(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """不存在 → 404（ChangeNotFound，中文 l10n 文案）。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{uuid.uuid4()}/usage", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_CHANGE_NOT_FOUND"
        assert resp.json()["message"] == "变更不存在，请检查变更 ID 是否正确或刷新变更列表。"

    async def test_404_cross_workspace(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """跨工作区：变更属 ws_a，经 ws_b 请求 → 404 同码（不泄露存在性）。"""
        ws_a = await _make_workspace(db_session, root_path=f"/tmp/usage-a-{uuid.uuid4()}")
        ws_b = await _make_workspace(db_session, root_path=f"/tmp/usage-b-{uuid.uuid4()}")
        change = await _make_change(db_session, ws_a.id, "2026-08-30-usage-isolated")

        resp = await client.get(
            f"/api/workspaces/{ws_b.id}/changes/{change.id}/usage", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_CHANGE_NOT_FOUND"

        # 同变更经归属工作区请求正常（对照）。
        ok = await client.get(
            f"/api/workspaces/{ws_a.id}/changes/{change.id}/usage", headers=auth_headers
        )
        assert ok.status_code == 200, ok.text

    async def test_deleted_change_200(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """deleted 变更 200（同既有详情端点口径：防复活是列表投影层过滤，非 HTTP 404）。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(
            db_session, ws.id, "2026-08-30-usage-deleted", location="deleted"
        )
        run = await _make_run(db_session, change_id=change.id)
        await _make_model_usage(
            db_session, run_id=run.id, model="deleted-model", input_tokens=500, output_tokens=50
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/usage", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["totals"]["input_tokens"] == 500

        # 口径锚：既有详情端点对 deleted 变更同为 200。
        detail = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}", headers=auth_headers
        )
        assert detail.status_code == 200, detail.text

    async def test_403_without_permission(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """缺 CHANGE_READ 权限（非管理员且无任何工作区角色）→ 403。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        change = await _make_change(db_session, ws.id, "2026-08-30-usage-403")
        stranger = User(
            id=uuid.uuid4(),
            email=f"usage-stranger-{uuid.uuid4()}@example.com",
            password_hash="x",
            display_name="S",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(stranger)
        await db_session.commit()
        token, _ = create_access_token(
            user_id=stranger.id,
            email=stranger.email,
            is_admin=False,
            settings=get_settings(),
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/usage",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403, resp.text

    async def test_401_without_auth(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """未认证（缺鉴权头）→ 401。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        resp = await client.get(f"/api/workspaces/{ws.id}/changes/{uuid.uuid4()}/usage")
        assert resp.status_code == 401


# ── 12：GET /quicklog-entries/{ql_id}/usage 端点 ──────────────────────────


class TestQuicklogUsageEndpoint:
    """快速修复维度 usage 端点（严格 404 对齐详情端点，task-04 / FR-03）。"""

    async def test_200_bound_and_unbound_entries(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """条目存在 200：绑定条目带数字、未绑条目零值（全 0 + 三元组 None）。"""
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        ql_bound = "ql-20260830-711-bound"
        ql_unbound = "ql-20260830-712-unbound"
        _write_quicklog_file(tmp_path, ql_bound, ql_unbound)
        owner = await _make_user(db_session)
        sess = await _make_session(db_session, owner)
        await _make_quicklog_link(
            db_session, workspace_id=ws.id, ql_id=ql_bound, session_id=sess.id
        )
        run = await _make_run(
            db_session,
            agent_session_id=sess.id,
            num_turns=7,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=3000,
        )
        await _make_model_usage(
            db_session,
            run_id=run.id,
            model="ql-endpoint-model",
            input_tokens=400,
            output_tokens=40,
            cache_read_tokens=4,
            api_requests=2,
        )

        bound = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_bound}/usage", headers=auth_headers
        )
        assert bound.status_code == 200, bound.text
        body = bound.json()
        assert body["totals"] == {
            "input_tokens": 400,
            "output_tokens": 40,
            "cache_read_tokens": 4,
            "cache_creation_tokens": 0,
            "api_requests": 2,
            "num_turns": 7,
        }
        assert [item["model"] for item in body["by_model"]] == ["ql-endpoint-model"]
        assert _naive(body["started_at"]) == _T10.replace(tzinfo=None)
        assert _naive(body["finished_at"]) == _T1030.replace(tzinfo=None)
        assert body["duration_ms"] == 3000

        # 存在但未绑会话的条目 → 200 零值（不 404，design 接口定义边界口径）。
        unbound = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_unbound}/usage", headers=auth_headers
        )
        assert unbound.status_code == 200, unbound.text
        assert unbound.json()["totals"]["input_tokens"] == 0
        assert unbound.json()["by_model"] == []

    async def test_404_missing_entry(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        tmp_path: Path,
        db_session: AsyncSession,
    ) -> None:
        """不存在 → 404（先 get_entry 严格校验，对齐详情端点；不像 /sessions 容忍
        「有 link 无条目」竞态）。"""
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/ql-20260830-799-missing/usage",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        assert resp.json()["message"] == "快速修复条目不存在"


# ── 13：列表批量投影（FR-04）────────────────────────────────────────────


class TestListUsageProjection:
    """GET /changes 与 GET /quicklog-entries 的 usage 批量投影。"""

    async def test_changes_list_usage_projection(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """多变更混合（有执行 / 无执行 / deleted 有执行）一次填充：
        有执行行 usage 精确、无执行与 deleted 行恒 None。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/usage-{uuid.uuid4()}")
        c_active = await _make_change(db_session, ws.id, "2026-08-30-usage-proj-a")
        c_empty = await _make_change(db_session, ws.id, "2026-08-30-usage-proj-b")
        c_deleted = await _make_change(
            db_session, ws.id, "2026-08-30-usage-proj-d", location="deleted"
        )

        run = await _make_run(
            db_session,
            change_id=c_active.id,
            num_turns=9,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=2222,
        )
        await _make_model_usage(
            db_session,
            run_id=run.id,
            model="proj-model",
            input_tokens=800,
            output_tokens=80,
            cache_read_tokens=8,
            cache_creation_tokens=4,
            api_requests=3,
        )
        # deleted 行虽挂执行，usage 投影被前置过滤跳过（防复活口径）。
        del_run = await _make_run(db_session, change_id=c_deleted.id)
        await _make_model_usage(db_session, run_id=del_run.id, model="del-model", input_tokens=500)

        resp = await client.get(f"/api/workspaces/{ws.id}/changes", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = {i["id"]: i for i in resp.json()["items"]}

        usage = items[str(c_active.id)]["usage"]
        assert usage is not None
        assert usage["totals"] == {
            "input_tokens": 800,
            "output_tokens": 80,
            "cache_read_tokens": 8,
            "cache_creation_tokens": 4,
            "api_requests": 3,
            "num_turns": 9,
        }
        assert _naive(usage["started_at"]) == _T10.replace(tzinfo=None)
        assert _naive(usage["finished_at"]) == _T1030.replace(tzinfo=None)
        assert usage["duration_ms"] == 2222

        assert items[str(c_empty.id)]["usage"] is None
        assert items[str(c_deleted.id)]["usage"] is None

    async def test_quicklog_list_usage_projection(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """quicklog 列表：绑定条目 usage 精确填充、未绑条目 usage=None。"""
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        ql_bound = "ql-20260830-721-bound"
        ql_unbound = "ql-20260830-722-unbound"
        _write_quicklog_file(tmp_path, ql_bound, ql_unbound)
        owner = await _make_user(db_session)
        sess = await _make_session(db_session, owner)
        await _make_quicklog_link(
            db_session, workspace_id=ws.id, ql_id=ql_bound, session_id=sess.id
        )
        run = await _make_run(
            db_session,
            agent_session_id=sess.id,
            num_turns=2,
            started_at=_T10,
            finished_at=_T1030,
            duration_ms=1500,
        )
        await _make_model_usage(
            db_session,
            run_id=run.id,
            model="ql-proj-model",
            input_tokens=600,
            output_tokens=60,
            cache_read_tokens=6,
            cache_creation_tokens=3,
            api_requests=4,
        )

        resp = await client.get(f"/api/workspaces/{ws.id}/quicklog-entries", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = {i["ql_id"]: i for i in resp.json()["items"]}

        usage = items[ql_bound]["usage"]
        assert usage is not None
        assert usage["totals"] == {
            "input_tokens": 600,
            "output_tokens": 60,
            "cache_read_tokens": 6,
            "cache_creation_tokens": 3,
            "api_requests": 4,
            "num_turns": 2,
        }
        assert _naive(usage["started_at"]) == _T10.replace(tzinfo=None)
        assert usage["duration_ms"] == 1500

        assert items[ql_unbound]["usage"] is None
