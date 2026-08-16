"""双用户上行冒烟 e2e（task-06 / D-001@v1 / FR-01~FR-05 集成收口）。

测试内集成用例形态（TaskCard constraints 认可的冒烟形态二）：pytest httpx
AsyncClient 走**真实** token 签发 + 上行链路，不依赖部署环境。一条用例串起
写入侧→读侧投影全链路，覆盖冒烟四断言：

1. owner 对齐——A token 首推（owner 首填 A，零事件）→ B token 再推 →
   ``ux_changes.owner_id==B``，详情 enrich 后 ``owner_name==B.username``、
   列表摘要 ``owner_name`` 同源；
2. owner_change 留痕——恰 1 条 ``change_events`` 行（detail 逐字
   ``{from_user_id: A, to_user_id: B}``、created_by=B），详情 steps 时间线
   合成出 ``kind="event"`` 条目（output ``"A → B"`` 用户名）；
3. 同用户幂等——B token 原样重复上行 → 事件零新增、owner 仍 B；
4. brownfield 零变化——``X-SillySpec-User`` header 仍只喂 ``last_pusher``
   （落库值==header 字符串，与 owner 更新互不干扰，§9 兼容语义）；CLI 旧
   steps 行不带 kind 字段 → 响应条目 kind 缺省 ``"step"``、旧字段
   （name/output/status/completed_at/stage/ordering）形状不变。

helper 范式同 test_owner_sync.py ``_make_ws_and_users_with_tokens``，差异：
用户带 ``username``（读侧 ``_resolve_user_names`` 取 display_name 优先
username fallback，此处只设 username → owner_name==username，断言可预期）。
steps 的 completed_at 用固定过去时点（2026/08/01，CLI 本地时区格式），保证
在任何晚于该时点的运行时刻事件都能按时间序插进 execute 组（step1 之后）。
"""

from __future__ import annotations

import uuid as _uuid

from sqlalchemy import select

# 两用户名（冒烟断言口径：owner_name / 事件 output 的 A/B 均用 username）
UNAME_A = "smoke-alice"
UNAME_B = "smoke-bob"

# X-SillySpec-User header 字符串（CLI 侧自报身份；只喂 last_pusher，与 owner 无关）
HEADER_USER_A = "alice@laptop"
HEADER_USER_B = "bob@server"


def _six_table_body(name: str, step_output: str) -> dict:
    """serializeForSync 六表 body：含 stages.started_at + execute 组两 step。

    - changes[0] 同名条目供占位行取 title/current_stage + 投影 current_stage；
    - stages[].started_at（CLI 本地时区格式）供事件 stage 近似归属解析；
    - steps：execute 组 1 完成（completed_at 固定过去时点）+ 1 进行中
      （completed_at=None 视为最晚）→ 事件条目预期插在两者之间。
    """
    return {
        "project": {"name": "demo"},
        "changes": [
            {"name": name, "current_stage": "execute", "status": "in_progress", "title": name}
        ],
        "stages": [
            {"stage": "brainstorm", "status": "completed", "started_at": "2026/07/01 09:00:00"},
            {"stage": "execute", "status": "in_progress", "started_at": "2026/08/01 09:00:00"},
        ],
        "steps": [
            {
                "change_name": name,
                "stage": "execute",
                "name": "实现模块",
                "status": "completed",
                "ordering": 1,
                "output": step_output,
                "completed_at": "2026/08/01 10:00:00",
                "wait_reason": None,
            },
            {
                "change_name": name,
                "stage": "execute",
                "name": "写回归测试",
                "status": "in-progress",
                "ordering": 2,
                "output": None,
                "completed_at": None,
                "wait_reason": None,
            },
        ],
        "batch_progress": [],
        "approvals": [],
    }


async def _make_ws_two_users_with_tokens(db_session):
    """建 workspace + 两用户（各带 username）各签一枚 shpsync_ token。

    同 test_owner_sync.py 多用户范式；冒烟需读侧 owner_name 可预期 → 用户带
    username（_resolve_user_names display_name 优先 username fallback，只设
    username 即取 username）。
    """
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    tag = _uuid.uuid4().hex[:8]
    ws = Workspace(
        id=_uuid.uuid4(),
        name=f"ws-owner-smoke-{tag}",
        slug=f"ws-owner-smoke-{tag}",
        root_path=f"/tmp/ws-owner-smoke-{tag}",
        status="active",
    )
    db_session.add(ws)
    users: list[User] = []
    for uname in (UNAME_A, UNAME_B):
        user = User(
            id=_uuid.uuid4(),
            email=f"owner-smoke-{uname}-{tag}@example.com",
            username=uname,
            password_hash=password_hasher.hash("x"),
            status="active",
        )
        db_session.add(user)
        users.append(user)
    await db_session.commit()
    await db_session.refresh(ws)

    headers: list[dict[str, str]] = []
    for user in users:
        _row, plaintext = await PlatformSyncTokenService(
            db_session, settings=get_settings()
        ).create(
            workspace_id=ws.id,
            name=f"owner-smoke-{user.username}-{tag}",
            created_by=user.id,
        )
        assert plaintext.startswith("shpsync_"), "签发明文须为 shpsync_ 前缀（key_prefix 取证）"
        headers.append({"Authorization": f"Bearer {plaintext}"})
    return ws.id, users, headers


async def _push(client, headers, name, *, header_user, pushed_at):
    """push progress（无 base_ts=首推无条件接受分支，命中接受路径）。"""
    return await client.post(
        f"/api/changes/{name}/progress",
        json=_six_table_body(name, step_output=f"进度来自 {header_user}"),
        headers={
            **headers,
            "X-SillySpec-User": header_user,
            "X-SillySpec-Pushed-At": pushed_at,
        },
    )


async def test_dual_user_push_smoke_e2e(client, db_session, auth_headers):
    """冒烟四断言：owner 对齐 B / owner_change 留痕 / 同用户幂等 / brownfield 零变化。"""
    from app.modules.change.model import Change, ChangeEventORM
    from app.modules.platform_sync.model import PlatformChangeProgressORM

    ws_id, users, token_headers = await _make_ws_two_users_with_tokens(db_session)
    user_a, user_b = users
    name = "owner-smoke-e2e"

    # ── A 首推：owner 首填 A，零事件（FR-01 第一分支）────────────────────────
    resp_a = await _push(
        client,
        token_headers[0],
        name,
        header_user=HEADER_USER_A,
        pushed_at="2026-08-16T09:00:00.000Z",
    )
    assert resp_a.status_code == 200, f"A 首推失败：{resp_a.status_code} {resp_a.text}"

    change = (
        (
            await db_session.execute(
                select(Change).where(Change.workspace_id == ws_id, Change.change_key == name)
            )
        )
        .scalars()
        .one()
    )
    assert change.owner_id == user_a.id, "断言一前置：A 首推后 owner 首填=A"
    assert (
        await db_session.execute(select(ChangeEventORM).where(ChangeEventORM.workspace_id == ws_id))
    ).scalars().all() == [], "首填非变化，零事件"

    # ── B 再推：owner 变 B + 恰 1 条 owner_change 事件（FR-02/FR-03）─────────
    resp_b = await _push(
        client,
        token_headers[1],
        name,
        header_user=HEADER_USER_B,
        pushed_at="2026-08-16T10:00:00.000Z",
    )
    assert resp_b.status_code == 200, f"B 再推失败：{resp_b.status_code} {resp_b.text}"

    await db_session.refresh(change)
    # 断言一：owner 对齐最新上行 token 用户 B
    assert change.owner_id == user_b.id, "断言一：owner 应对齐 B 的 token 身份"

    events = list(
        (
            await db_session.execute(
                select(ChangeEventORM)
                .where(ChangeEventORM.workspace_id == ws_id)
                .order_by(ChangeEventORM.created_at, ChangeEventORM.id)
            )
        )
        .scalars()
        .all()
    )
    # 断言二：owner_change 事件行存在且 detail 含 from=A to=B
    assert len(events) == 1, "断言二：A→B 变化应恰记 1 条事件"
    ev = events[0]
    assert ev.event_type == "owner_change"
    assert ev.detail == {"from_user_id": str(user_a.id), "to_user_id": str(user_b.id)}
    assert ev.created_by == user_b.id
    assert ev.change_id == change.id

    # ── 读侧投影：详情 enrich（owner_name + 时间线合成事件条目）──────────────
    detail = await client.get(f"/api/workspaces/{ws_id}/changes/{change.id}", headers=auth_headers)
    assert detail.status_code == 200, f"详情失败：{detail.status_code} {detail.text}"
    body = detail.json()
    # 断言一（读侧）：owner_name == B 用户名
    assert body["owner_name"] == UNAME_B, "断言一（读侧）：详情 owner_name 应为 B 用户名"

    steps = body["steps"]
    assert steps is not None and len(steps) == 3, "时间线应为 2 step + 1 event 合成"
    step1, event_entry, step2 = steps
    # 断言二（读侧）：kind=event 条目存在，output 含 "A → B"（用户名）
    assert event_entry["kind"] == "event"
    assert event_entry["event_type"] == "owner_change"
    assert event_entry["name"] == "责任人变更"
    assert event_entry["status"] == "completed"
    assert event_entry["output"] == f"{UNAME_A} → {UNAME_B}"
    assert event_entry["stage"] == "execute"
    assert event_entry["completed_at"] is not None
    # 插入位：execute 组内 completed step 之后、进行中 step 之前；统一重编 ordering
    assert step1["name"] == "实现模块" and step2["name"] == "写回归测试"
    assert [s["ordering"] for s in steps] == [0, 1, 2]
    # 断言四（部分）：CLI 旧 steps 行不带 kind → 缺省 "step"，旧字段形状零变化
    for s in (step1, step2):
        assert s["kind"] == "step"
        assert s["event_type"] is None
        for field in ("name", "stage", "status", "output", "completed_at", "ordering"):
            assert field in s, f"旧契约字段 {field} 不得缺失"
    assert step1["completed_at"].startswith("2026-08-01T"), "completed_at 应归一化为 ISO UTC"
    assert step1["output"] == f"进度来自 {HEADER_USER_B}", "明细 output 全量透传（B 最后上行值）"

    # 列表摘要同源：enrich_summaries 批量路径 owner_name
    listing = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
    assert listing.status_code == 200
    item = next(i for i in listing.json()["items"] if i["change_key"] == name)
    assert item["owner_name"] == UNAME_B, "列表摘要 owner_name 应同源为 B 用户名"

    # ── 断言三：B 原样重复上行 → 事件零新增、owner 仍 B（FR-01 幂等分支）────
    resp_b2 = await _push(
        client,
        token_headers[1],
        name,
        header_user=HEADER_USER_B,
        pushed_at="2026-08-16T11:00:00.000Z",
    )
    assert resp_b2.status_code == 200

    await db_session.refresh(change)
    assert change.owner_id == user_b.id, "断言三：同用户重复上行 owner 仍=B"
    events_after = (
        (
            await db_session.execute(
                select(ChangeEventORM).where(ChangeEventORM.workspace_id == ws_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(events_after) == 1, "断言三：同用户重复上行零新事件"

    # ── 断言四：X-SillySpec-User 语义零变化（只喂 last_pusher，与 owner 互不干扰）──
    progress_row = (
        (
            await db_session.execute(
                select(PlatformChangeProgressORM).where(
                    PlatformChangeProgressORM.workspace_id == ws_id,
                    PlatformChangeProgressORM.change_name == name,
                )
            )
        )
        .scalars()
        .one()
    )
    assert progress_row.last_pusher == HEADER_USER_B, (
        "last_pusher 应取 X-SillySpec-User header 字符串（而非 token 用户名/owner）"
    )
    assert progress_row.last_pushed_at == "2026-08-16T11:00:00.000Z"
    # owner 与 last_pusher 并存互不覆盖：owner=B（token 身份），last_pusher=header 自报
    assert change.owner_id == user_b.id and progress_row.last_pusher == HEADER_USER_B
