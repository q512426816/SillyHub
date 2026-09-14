"""拖拽排序 move 端点与列表排序 HTTP 级测试（change 2026-09-14-workspace-drag-sort task-05）。

覆盖 FR-01/FR-02/FR-03/FR-08 全部分支，作为 task-02（端点契约）/task-03（move
服务）/task-04（列表排序接入）三个实现任务的验收闸门：

- 契约 422（D-013@v1）：三选一违反四形态（全缺 / after_id+before_id 同传 /
  after_id==before_id 同值 / id+to 同传）→ HTTP_422_MOVE_ANCHOR_CONFLICT；
  锚点不可见（不存在 / 他人 workspace / 软删 / status ∉ {active, archived}）→
  HTTP_422_MOVE_ANCHOR_NOT_VISIBLE；自锚 → HTTP_422_MOVE_ANCHOR_SELF；
  to="prev_page_tail" 且被移动卡在第 0 页 → 422。均断言中文文案。
- 幂等 backfill（D-006@v2）：重复 move 不重复插入排序行。
- to 分页数学（D-012@v1）：下带=下页页首 / 上带=上页页尾 / 越界收敛 /
  page_size 显式传参与默认 12。
- 中点 + 精度耗尽整集重排（R-01）：两行位置贴死 → rebalanced=true 且落位正确。
- D-004 回归：无行用户列表 = created_at DESC；backfill 后新建 workspace 落最前。
- FR-01 两用户顺序隔离：用户 A move 后 B 的列表与此前完全一致。
- D-014 分页数量不变量：move 前后 total 不变、各页恒 PAGE_SIZE、无重复 id。
- 列表排序 LEFT JOIN 回归（FR-03）：混合有行/无行 + 四路筛选与 limit/offset。
- 鉴权 403（D-007@v1）：非管理员对不可见 workspace move → 403。

种子数据用 db_session 直插模型行（test_permission_scope.py 同款模式，勿新建
workspace/tests/conftest.py）；断言只基于 design「接口定义」公开契约
（错误码 / rank / total / 顺序），sort_position 不出现在任何 DTO。
"""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import UserWorkspaceOrder, Workspace

# created_at 严格区分（秒级递减），保证默认视图 created_at DESC 全序无并列。
_BASE_TS = datetime(2026, 9, 14, 8, 0, 0, tzinfo=UTC)

# D-002@v1 / R-08：PAGE_SIZE=12 与前端常量同源（design 接口定义 page_size 默认 12）。
_PAGE_SIZE = 12


# ── 种子与请求 helper（直插模型，test_permission_scope.py 同款模式）──────────


async def _make_ws(
    db_session: AsyncSession,
    *,
    name: str,
    created_at: datetime,
    status: str = "active",
    wtype: str | None = None,
    deleted_at: datetime | None = None,
) -> Workspace:
    """直插一行 Workspace（root_path/slug 加随机后缀避开唯一索引）。"""
    ws = Workspace(
        name=name,
        slug=f"{name}-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/mv-{name}-{uuid.uuid4().hex[:8]}",
        status=status,
        type=wtype,
        deleted_at=deleted_at,
        created_at=created_at,
        updated_at=created_at,
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _seed_workspaces(
    db_session: AsyncSession,
    n: int,
    *,
    prefix: str = "mv",
    wtype: str | None = None,
) -> list[Workspace]:
    """批量直插 N 个 active workspace。

    created_at 严格递减（w0 最新）→ 未物化用户的默认视图 created_at DESC 序
    恰为 [w0, w1, ..., w{n-1}]，后续断言直接按下标引用。
    """
    return [
        await _make_ws(
            db_session,
            name=f"{prefix}-{i}",
            created_at=_BASE_TS - timedelta(seconds=i),
            wtype=wtype,
        )
        for i in range(n)
    ]


async def _make_user(db_session: AsyncSession, *, prefix: str = "mv-user") -> tuple[User, str]:
    """普通（非管理员）用户 + 访问令牌（test_permission_scope.py 同款）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4().hex[:6]}@example.com",
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


async def _grant_read(db_session: AsyncSession, *, user: User, ws: Workspace) -> None:
    """给用户授予单个 workspace 的 workspace:read（行级可见集合来源）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"ws_reader_{uuid.uuid4().hex[:8]}",
        name="Workspace Reader",
        description="test role with workspace:read",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission="workspace:read"))
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


async def _admin_user(db_session: AsyncSession) -> User:
    """conftest auth_admin_token 落库的平台管理员（固定邮箱复用）。"""
    stmt = select(User).where(User.email == "admin@example.com").limit(1)
    return (await db_session.execute(stmt)).scalars().one()


async def _order_row_count(db_session: AsyncSession, user: User) -> int:
    stmt = select(UserWorkspaceOrder.id).where(UserWorkspaceOrder.user_id == user.id)
    return len((await db_session.execute(stmt)).all())


async def _order_positions(db_session: AsyncSession, user: User) -> list[float]:
    stmt = (
        select(UserWorkspaceOrder.sort_position)
        .where(UserWorkspaceOrder.user_id == user.id)
        .order_by(UserWorkspaceOrder.sort_position.asc())
    )
    return [float(v) for v in (await db_session.execute(stmt)).scalars().all()]


async def _list_ids(
    client: AsyncClient,
    headers: dict[str, str],
    **params: Any,
) -> tuple[list[str], int]:
    """GET /api/workspaces → (当前用户视角的有序 id 列表, total)。"""
    resp = await client.get("/api/workspaces", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return [item["id"] for item in body["items"]], body["total"]


async def _move(
    client: AsyncClient,
    headers: dict[str, str],
    ws: Workspace,
    **payload: Any,
) -> Response:
    # httpx 的 json= 走标准库序列化，UUID 需先转字符串。
    body = {
        key: str(value) if isinstance(value, uuid.UUID) else value for key, value in payload.items()
    }
    return await client.post(f"/api/workspaces/{ws.id}/move", json=body, headers=headers)


# ── 契约 422：三选一违反四形态 → HTTP_422_MOVE_ANCHOR_CONFLICT（D-013）──────


async def test_move_anchor_conflict_all_missing(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """锚点全缺 → 422 CONFLICT + 中文文案。"""
    ws = (await _seed_workspaces(db_session, 1))[0]
    resp = await _move(client, auth_headers, ws)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_CONFLICT"
    assert "必须恰好提供一个" in body["message"]


async def test_move_anchor_conflict_after_and_before(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """after_id + before_id 同传（不同值）→ 422 CONFLICT。"""
    w0, w1 = await _seed_workspaces(db_session, 2)
    resp = await _move(client, auth_headers, w0, after_id=w1.id, before_id=w0.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_CONFLICT"
    assert "必须恰好提供一个" in body["message"]


async def test_move_anchor_conflict_after_equals_before(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """after_id == before_id 同值（计数=2）→ 422 CONFLICT。"""
    w0, w1 = await _seed_workspaces(db_session, 2)
    resp = await _move(client, auth_headers, w0, after_id=w1.id, before_id=w1.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_CONFLICT"
    assert "必须恰好提供一个" in body["message"]


async def test_move_anchor_conflict_id_with_to(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """after_id + to 同传 → 422 CONFLICT。"""
    w0, w1 = await _seed_workspaces(db_session, 2)
    resp = await _move(client, auth_headers, w0, after_id=w1.id, to="next_page_head")
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_CONFLICT"
    assert "必须恰好提供一个" in body["message"]


# ── 契约 422：锚点有效性 → NOT_VISIBLE / SELF / 第 0 页（D-013/D-012）────────


async def test_move_anchor_not_found(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """锚点 id 不存在 → 422 NOT_VISIBLE + 中文文案。"""
    w0, _ = await _seed_workspaces(db_session, 2)
    resp = await _move(client, auth_headers, w0, after_id=uuid.uuid4())
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"
    assert "锚点工作区不存在" in body["message"]


async def test_move_anchor_soft_deleted(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """锚点 workspace 软删（deleted_at 非空）→ 422 NOT_VISIBLE。"""
    w0, _ = await _seed_workspaces(db_session, 2)
    dead = await _make_ws(
        db_session,
        name="mv-soft-deleted",
        created_at=_BASE_TS + timedelta(seconds=5),
        deleted_at=datetime.now(UTC),
    )
    resp = await _move(client, auth_headers, w0, before_id=dead.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"
    assert "锚点工作区不存在" in body["message"]


async def test_move_anchor_status_out_of_range(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """锚点 status ∉ {active, archived}（pending）→ 422 NOT_VISIBLE。"""
    w0, _ = await _seed_workspaces(db_session, 2)
    pending = await _make_ws(
        db_session,
        name="mv-pending",
        created_at=_BASE_TS + timedelta(seconds=5),
        status="pending",
    )
    resp = await _move(client, auth_headers, w0, after_id=pending.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"
    assert "状态不允许" in body["message"]


async def test_move_anchor_invisible_to_non_admin(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """锚点=他人 workspace（不在调用者可见集合）→ 422 NOT_VISIBLE（D-013 判据）。"""
    target, _ = await _seed_workspaces(db_session, 2, prefix="tgt")
    other = await _make_ws(
        db_session,
        name="mv-other-user-ws",
        created_at=_BASE_TS + timedelta(seconds=1),
    )
    user, token = await _make_user(db_session)
    # 用户只对 target 持 workspace:read——other 存在且 active 但对其不可见。
    await _grant_read(db_session, user=user, ws=target)
    headers = {"Authorization": f"Bearer {token}"}

    resp = await _move(client, headers, target, after_id=other.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"
    assert "锚点工作区不存在" in body["message"]


async def test_move_anchor_self(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """自锚（锚点=被移动卡自身）→ 422 HTTP_422_MOVE_ANCHOR_SELF。"""
    w0, w1, _ = await _seed_workspaces(db_session, 3)
    resp = await _move(client, auth_headers, w0, after_id=w0.id)
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_SELF"
    assert "自身" in body["message"]

    resp2 = await _move(client, auth_headers, w1, before_id=w1.id)
    assert resp2.status_code == 422, resp2.text
    assert resp2.json()["code"] == "HTTP_422_MOVE_ANCHOR_SELF"


async def test_move_prev_page_tail_on_first_page(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """to=prev_page_tail 且被移动卡在第 0 页 → 422（FR-02 末分支）。"""
    w0, w1, _ = await _seed_workspaces(db_session, 3)
    # w0 是 created_at DESC 序第一张（rank 0，第 0 页）。
    resp = await _move(client, auth_headers, w0, to="prev_page_tail")
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"
    assert "第一页" in body["message"]
    # 判据只看页号：同页其它卡（w1，rank 1 仍在第 0 页）同样 422。
    resp2 = await _move(client, auth_headers, w1, to="prev_page_tail")
    assert resp2.status_code == 422, resp2.text


# ── 成功路径 + 幂等 backfill（D-006@v2 / FR-01）──────────────────────────────


async def test_move_after_success_and_idempotent_backfill(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """after_id 落位成功 + backfill 幂等：重复 move 排序行数不增长。"""
    cards = await _seed_workspaces(db_session, 6)
    w0, w1, _, w3, _, _ = cards
    admin = await _admin_user(db_session)

    resp = await _move(client, auth_headers, w3, after_id=w0.id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 响应契约：{workspace, rebalanced, rank}（task-02 expects_from）。
    assert body["workspace"]["id"] == str(w3.id)
    assert body["rebalanced"] is False
    assert body["rank"] == 1

    # 首次 move 触发 backfill：可见 ∧ active/archived 全集 6 行一次物化。
    assert await _order_row_count(db_session, admin) == 6
    ids, total = await _list_ids(client, auth_headers)
    assert total == 6
    assert ids == [str(w.id) for w in [cards[0], w3, cards[1], cards[2], cards[4], cards[5]]]

    # 第二次 move：幂等 backfill 不重复插入（唯一索引行数不变）。
    resp2 = await _move(client, auth_headers, cards[4], after_id=w1.id)
    assert resp2.status_code == 200, resp2.text
    assert await _order_row_count(db_session, admin) == 6


# ── to 分页数学（D-012@v1 / FR-02）───────────────────────────────────────────


async def test_move_to_next_page_head(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """下带 to=next_page_head（page_size=12 显式）→ rank=(P+1)×page_size=下页页首。"""
    cards = await _seed_workspaces(db_session, 30)  # 3 页：12/12/6
    w0 = cards[0]  # rank 0（第 0 页）
    resp = await _move(client, auth_headers, w0, to="next_page_head", page_size=_PAGE_SIZE)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rank"] == 12  # (0+1)×12
    ids, total = await _list_ids(client, auth_headers)
    assert total == 30
    assert ids[12] == str(w0.id)
    assert ids[11] == str(cards[12].id)
    assert ids[13] == str(cards[13].id)


async def test_move_to_prev_page_tail_default_page_size(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """上带 to=prev_page_tail（page_size 缺省=12）→ rank=P×page_size-1=上页页尾。"""
    cards = await _seed_workspaces(db_session, 30)
    w13 = cards[13]  # rank 13（第 1 页）
    resp = await _move(client, auth_headers, w13, to="prev_page_tail")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rank"] == 11  # 1×12-1
    ids, _ = await _list_ids(client, auth_headers)
    assert ids[11] == str(w13.id)
    assert ids[10] == str(cards[10].id)
    assert ids[12] == str(cards[11].id)


async def test_move_to_explicit_page_size(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """page_size 显式传参与默认值分轨：page_size=5 时按 5 宽度做分页数学。"""
    cards = await _seed_workspaces(db_session, 10)
    w7 = cards[7]  # rank 7 → page 1（page_size=5）
    resp = await _move(client, auth_headers, w7, to="prev_page_tail", page_size=5)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rank"] == 4  # 1×5-1

    # 同一张卡在默认 page_size=12 下页号不同：w8（重排后 rank 8）在第 0 页 → 422。
    w8 = cards[8]
    resp2 = await _move(client, auth_headers, w8, to="prev_page_tail")
    assert resp2.status_code == 422, resp2.text
    assert resp2.json()["code"] == "HTTP_422_MOVE_ANCHOR_NOT_VISIBLE"


async def test_move_to_next_page_head_converges_to_tail(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """越界收敛：末卡 to=next_page_head → 收敛到序列尾，rank 与顺序不变。"""
    cards = await _seed_workspaces(db_session, 30)
    w29 = cards[29]  # rank 29（末页末卡）
    before_ids, _ = await _list_ids(client, auth_headers)
    resp = await _move(client, auth_headers, w29, to="next_page_head")
    assert resp.status_code == 200, resp.text
    assert resp.json()["rank"] == 29
    after_ids, _ = await _list_ids(client, auth_headers)
    assert after_ids == before_ids


# ── 中点 + 精度耗尽整集重排（D-011 / R-01）──────────────────────────────────


async def test_move_precision_exhaustion_triggers_rebalance(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """相邻两行位置贴死（相邻浮点值）→ 中点坍缩触发整集重排 rebalanced=true。"""
    cards = await _seed_workspaces(db_session, 3)
    a, b, c = cards  # 显示序 [a, b, c]
    admin = await _admin_user(db_session)
    glued = math.nextafter(1024.0, math.inf)  # 与 1024.0 相邻的浮点值
    db_session.add_all(
        [
            UserWorkspaceOrder(user_id=admin.id, workspace_id=a.id, sort_position=1024.0),
            UserWorkspaceOrder(user_id=admin.id, workspace_id=b.id, sort_position=glued),
            UserWorkspaceOrder(user_id=admin.id, workspace_id=c.id, sort_position=3072.0),
        ]
    )
    await db_session.commit()

    resp = await _move(client, auth_headers, c, after_id=a.id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rebalanced"] is True
    assert body["rank"] == 1
    ids, _ = await _list_ids(client, auth_headers)
    # 整集重排后 a=1024 / b=2048，c 落中点 1536 → 最终顺序 [a, c, b]。
    assert ids == [str(a.id), str(c.id), str(b.id)]
    # 重排后间隔恢复：三行位置呈 1024 间隔递增序列（c 在 1024 与 2048 之间）。
    positions = await _order_positions(db_session, admin)
    assert positions[0] < positions[1] < positions[2]
    assert positions[1] == 1536.0


# ── D-004 回归：无行用户现状 + backfill 后新建落最前（FR-03）────────────────


async def test_list_without_order_rows_matches_created_at_desc(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """从未拖拽的用户：列表 = created_at DESC，与现状完全一致（D-004 回归）。"""
    cards = await _seed_workspaces(db_session, 5)
    ids, total = await _list_ids(client, auth_headers)
    assert total == 5
    assert ids == [str(w.id) for w in cards]  # 种子序即 created_at DESC 序
    admin = await _admin_user(db_session)
    assert await _order_row_count(db_session, admin) == 0


async def test_new_workspace_after_backfill_lands_first(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """backfill 后新建 workspace：无行落最前；下次 move 物化到 min(pos) 之下区段。"""
    cards = await _seed_workspaces(db_session, 4)
    w0, w1, _, w3 = cards
    resp = await _move(client, auth_headers, w3, after_id=w0.id)
    assert resp.status_code == 200, resp.text
    ids, _ = await _list_ids(client, auth_headers)
    assert ids == [str(w.id) for w in [w0, w3, cards[1], cards[2]]]

    # 新建 workspace（无排序行）→ 列表落最前（D-004@v1）。
    newest = await _make_ws(
        db_session,
        name="mv-after-backfill-new",
        created_at=_BASE_TS + timedelta(seconds=10),
    )
    ids2, total = await _list_ids(client, auth_headers)
    assert total == 5
    assert ids2[0] == str(newest.id)
    assert ids2[1:] == ids

    # 再次 move：backfill 把 newest 物化到现有最小位置之下，显示序零变化。
    admin = await _admin_user(db_session)
    min_pos_before = min(await _order_positions(db_session, admin))
    resp2 = await _move(client, auth_headers, w1, after_id=w3.id)
    assert resp2.status_code == 200, resp2.text
    assert await _order_row_count(db_session, admin) == 5
    positions = await _order_positions(db_session, admin)
    assert positions[0] < min_pos_before  # min(pos)-1024×n 区段
    ids3, _ = await _list_ids(client, auth_headers)
    assert ids3 == ids2


# ── 列表排序 LEFT JOIN 回归：混合行 + 四路筛选 + limit/offset（FR-03）───────


async def test_mixed_order_rows_left_join_and_filters(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """混合有行/无行排序 =（无行最前, created_at DESC）+（sort_position ASC）；筛选行为不变。"""
    cards = await _seed_workspaces(db_session, 4, prefix="mix", wtype=None)
    w0, _, w2, w3 = cards
    # w2/w3 给受控类型，供 type 筛选分支用（w0/w1 type 为 NULL 走 unclassified）。
    w2.type = "other"
    w3.type = "other"
    db_session.add_all([w2, w3])
    await db_session.commit()

    resp = await _move(client, auth_headers, w3, after_id=w0.id)
    assert resp.status_code == 200, resp.text
    # 全行视图：[w0, w3, w1, w2]（w3 移到 w0 之后）。
    base_ids, _ = await _list_ids(client, auth_headers)
    assert base_ids == [str(w.id) for w in [w0, w3, cards[1], w2]]

    # 新建两张无行卡：typed 新于 untyped → 无行组 created_at DESC = [typed, untyped]。
    typed_new = await _make_ws(
        db_session,
        name="mix-new-typed",
        created_at=_BASE_TS + timedelta(seconds=20),
        wtype="other",
    )
    untyped_new = await _make_ws(
        db_session,
        name="mix-new-untyped",
        created_at=_BASE_TS + timedelta(seconds=10),
        wtype=None,
    )
    ids, total = await _list_ids(client, auth_headers)
    assert total == 6
    assert ids == [
        str(typed_new.id),
        str(untyped_new.id),
        str(w0.id),
        str(w3.id),
        str(cards[1].id),
        str(w2.id),
    ]

    # 四路筛选：结果集过滤但相对顺序保持（默认排序下筛选不改显示序）。
    type_ids, type_total = await _list_ids(client, auth_headers, type="other")
    assert type_total == 3
    assert type_ids == [str(typed_new.id), str(w3.id), str(w2.id)]

    unclass_ids, unclass_total = await _list_ids(client, auth_headers, unclassified=True)
    assert unclass_total == 3
    assert unclass_ids == [str(untyped_new.id), str(w0.id), str(cards[1].id)]

    q_ids, q_total = await _list_ids(client, auth_headers, q="mix-3")
    assert q_total == 1
    assert q_ids == [str(w3.id)]

    status_ids, status_total = await _list_ids(client, auth_headers, status="active")
    assert status_total == 6
    assert status_ids == ids

    # limit/offset 切片仍按当前显示序（含无行最前组）。
    page_ids, page_total = await _list_ids(client, auth_headers, limit=2, offset=1)
    assert page_total == 6
    assert page_ids == ids[1:3]


# ── FR-01 两用户顺序隔离 ─────────────────────────────────────────────────────


async def test_move_isolated_per_user(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """用户 A move 后 A 列表变化，用户 B 列表与此前完全一致（D-001@v1）。"""
    cards = await _seed_workspaces(db_session, 6)
    w0, _, _, _, _, w5 = cards
    user_b, token_b = await _make_user(db_session, prefix="mv-user-b")
    for ws in cards:
        await _grant_read(db_session, user=user_b, ws=ws)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    b_before, b_total_before = await _list_ids(client, headers_b)
    assert b_total_before == 6
    assert b_before == [str(w.id) for w in cards]  # B 未拖过 = created_at DESC

    resp = await _move(client, auth_headers, w5, after_id=w0.id)
    assert resp.status_code == 200, resp.text

    a_ids, a_total = await _list_ids(client, auth_headers)
    assert a_total == 6
    assert a_ids == [str(w.id) for w in [w0, w5, cards[1], cards[2], cards[3], cards[4]]]

    b_after, b_total_after = await _list_ids(client, headers_b)
    assert b_total_after == 6
    assert b_after == b_before  # B 的顺序与此前完全一致（隔离）


# ── D-014 分页数量不变量 ─────────────────────────────────────────────────────


async def test_pagination_invariant_across_move(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """move 是纯重排：total 不变、各页恒 PAGE_SIZE（末页允许不满）、无重复/丢卡。"""
    cards = await _seed_workspaces(db_session, 30)
    w0 = cards[0]

    async def _pages() -> tuple[list[list[str]], int]:
        pages: list[list[str]] = []
        total = 0
        offset = 0
        while True:
            ids, t = await _list_ids(client, auth_headers, limit=_PAGE_SIZE, offset=offset)
            total = t
            if not ids:
                break
            pages.append(ids)
            offset += _PAGE_SIZE
            if offset >= t:
                break
        return pages, total

    before_pages, before_total = await _pages()
    assert before_total == 30
    assert [len(p) for p in before_pages] == [12, 12, 6]

    resp = await _move(client, auth_headers, w0, to="next_page_head", page_size=_PAGE_SIZE)
    assert resp.status_code == 200, resp.text
    assert resp.json()["rank"] == 12

    after_pages, after_total = await _pages()
    assert after_total == before_total  # total 不变
    assert [len(p) for p in after_pages] == [12, 12, 6]  # 各页恒 PAGE_SIZE（末页不满）

    flat = [i for page in after_pages for i in page]
    assert len(flat) == len(set(flat))  # 无重复 id
    assert set(flat) == {str(w.id) for w in cards}  # 无丢卡/空页
    # 纯重排：w0 从第 0 页移到第 1 页页首，其余相对顺序不变。
    assert flat[12] == str(w0.id)
    assert flat[:12] == [str(cards[i].id) for i in range(1, 13)]


# ── 鉴权 403（D-007@v1）──────────────────────────────────────────────────────


async def test_move_403_for_invisible_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """非管理员对不可见 workspace move → 403 HTTP_403_PERMISSION_DENIED。"""
    w_mine, _ = await _seed_workspaces(db_session, 2, prefix="mine")
    w_secret = await _make_ws(
        db_session,
        name="mv-secret",
        created_at=_BASE_TS + timedelta(seconds=1),
    )
    user, token = await _make_user(db_session)
    await _grant_read(db_session, user=user, ws=w_mine)  # 持 WORKSPACE_READ 但仅限 w_mine
    headers = {"Authorization": f"Bearer {token}"}

    resp = await _move(client, headers, w_secret, after_id=w_mine.id)
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_403_PERMISSION_DENIED"
    assert "无权访问该工作区" in body["message"]
