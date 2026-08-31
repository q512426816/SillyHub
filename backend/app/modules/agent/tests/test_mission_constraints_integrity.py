"""mission.constraints 损坏防护单测（ql-20260831-008-6876）.

生产实证链：mission 建档 constraints=JSON null（非 SQL NULL）→ patrol 合并
SQL 的 ``COALESCE(constraints,'{}')`` 只挡 SQL NULL → PG 下
``json-null || 对象`` 产出数组且逐轮追加（两条 mission 滚到 760KB）→ 读取端
``(mission.constraints or {}).get`` 对真值数组崩 AttributeError（converge 500
/ patrol 每轮 mission_patrol_mission_failed）。

覆盖三态（SQL NULL / JSON null / 历史损坏数组）：

- 合并 SQL（:func:`patrol._json_merge_expr`，测试库为 SQLite 分支）：三种初值
  经 ``json_type`` 守卫合并后均落干净 dict（非 object 回 ``'{}'`` 再并入补丁，
  正常 dict 键保留）——存量损坏行由下一次合并**自愈**；
- 读取端归一（:class:`model.ConstraintsJSON` TypeDecorator）：数组 → ``{}``、
  dict 原样、SQL NULL → None（``is not None`` 守卫语义不变）；
- PG 分支 SQL 串含 ``jsonb_typeof`` 守卫（字符串断言——测试库跑不了 PG 分支，
  防守卫被误删的回归锚点）。
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import Uuid, bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission
from app.modules.agent.patrol import _json_merge_expr
from app.modules.workspace.model import Workspace


async def _make_mission(db: AsyncSession) -> AgentMission:
    ws = Workspace(
        id=uuid.uuid4(),
        name="mc",
        slug=f"mc-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/mc-{uuid.uuid4().hex[:8]}",  # root_path 唯一索引，逐次唯一
        default_agent="claude_code",
        status="active",
    )
    db.add(ws)
    await db.flush()
    mission = AgentMission(workspace_id=ws.id, objective="integrity")
    db.add(mission)
    await db.commit()
    await db.refresh(mission)
    return mission


def _by_id_sql(fragment: str):
    """带 Uuid 类型绑定的 SQL（raw text 下 sqlite 存 hex 无横线，须走类型绑定）。"""
    return text(f"{fragment} WHERE id = :mid").bindparams(
        bindparam("mid", type_=Uuid(as_uuid=True))
    )


async def _seed_constraints(db: AsyncSession, mission_id: uuid.UUID, raw: str | None) -> None:
    """绕过 ORM bind 归一直接落库（模拟损坏 / 异构初值）。SQL NULL 传 None。"""
    await db.execute(
        _by_id_sql("UPDATE agent_missions SET constraints = :v"),
        {"v": raw, "mid": mission_id},
    )
    await db.commit()


async def _merge_probe(db: AsyncSession, mission_id: uuid.UUID) -> dict:
    """按 patrol 真实用法执行合并 UPDATE，返回合并后的库内值（raw 读回）。"""
    dialect = db.bind.dialect.name if db.bind is not None else "sqlite"
    merge_sql = str(_json_merge_expr(dialect))
    await db.execute(
        _by_id_sql(f"UPDATE agent_missions SET constraints = {merge_sql}"),
        {
            "__constraints_merge_patch": json.dumps({"probe_key": "probe_val"}),
            "mid": mission_id,
        },
    )
    await db.commit()
    stored = (
        await db.execute(
            _by_id_sql("SELECT constraints FROM agent_missions"),
            {"mid": mission_id},
        )
    ).scalar_one()
    return json.loads(stored) if isinstance(stored, str) else stored


async def test_merge_sql_normalizes_sql_null(db_session: AsyncSession) -> None:
    """SQL NULL 初值 → 合并后为补丁 dict（原 COALESCE 语义保持）。"""
    mission = await _make_mission(db_session)
    await _seed_constraints(db_session, mission.id, None)

    merged = await _merge_probe(db_session, mission.id)

    assert merged == {"probe_key": "probe_val"}


async def test_merge_sql_normalizes_json_null(db_session: AsyncSession) -> None:
    """JSON null 初值（生产损坏触发器）→ 守卫回 '{}' 再合并，不再产出数组。"""
    mission = await _make_mission(db_session)
    await _seed_constraints(db_session, mission.id, "null")

    merged = await _merge_probe(db_session, mission.id)

    assert merged == {"probe_key": "probe_val"}


async def test_merge_sql_heals_corrupted_array(db_session: AsyncSession) -> None:
    """历史损坏数组初值 → 合并自愈为干净 dict（数组残留不再逐轮追加）。"""
    mission = await _make_mission(db_session)
    await _seed_constraints(
        db_session,
        mission.id,
        '[null, {"worker_force_ended_at": "2026-08-31T00:00:00+00:00"}]',
    )

    merged = await _merge_probe(db_session, mission.id)

    assert merged == {"probe_key": "probe_val"}


async def test_merge_sql_preserves_existing_dict_keys(db_session: AsyncSession) -> None:
    """正常 dict 初值 → 只并入补丁键、既有键保留（F05 合并语义零回归）。"""
    mission = await _make_mission(db_session)
    await _seed_constraints(db_session, mission.id, '{"keep_me": 1}')

    merged = await _merge_probe(db_session, mission.id)

    assert merged == {"keep_me": 1, "probe_key": "probe_val"}


async def test_type_decorator_normalizes_array_on_read(db_session: AsyncSession) -> None:
    """库内数组（绕 ORM 落入）→ ORM 读取归一 {}（读取端兜底，全读取点覆盖）。"""
    mission = await _make_mission(db_session)
    await _seed_constraints(db_session, mission.id, '[{"worker_force_ended_at": "x"}]')

    # populate_existing 强制刷新（get 对 identity map 过期实例不重查，且 expire_all
    # 后的惰性属性同步访问在 async 下抛 MissingGreenlet）。
    loaded = (
        await db_session.execute(
            select(AgentMission)
            .where(AgentMission.id == mission.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()

    assert loaded.constraints == {}


async def test_type_decorator_preserves_dict_and_none(db_session: AsyncSession) -> None:
    """dict 原样透传；SQL NULL → None（is not None 守卫语义不变）。"""
    mission_dict = await _make_mission(db_session)
    await _seed_constraints(db_session, mission_dict.id, '{"orchestration_mode": "external"}')
    mission_null = await _make_mission(db_session)
    await _seed_constraints(db_session, mission_null.id, None)

    async def _fresh_load(mid: uuid.UUID) -> AgentMission:
        return (
            await db_session.execute(
                select(AgentMission)
                .where(AgentMission.id == mid)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    loaded_dict = await _fresh_load(mission_dict.id)
    loaded_null = await _fresh_load(mission_null.id)

    assert loaded_dict.constraints == {"orchestration_mode": "external"}
    assert loaded_null.constraints is None


def test_pg_merge_expr_contains_jsonb_typeof_guard() -> None:
    """PG 分支 SQL 串含 jsonb_typeof 守卫（回归锚点，防守卫被误删）。"""
    pg_sql = str(_json_merge_expr("postgresql"))

    assert "jsonb_typeof" in pg_sql
    assert "'object'" in pg_sql
    assert "ELSE" in pg_sql
