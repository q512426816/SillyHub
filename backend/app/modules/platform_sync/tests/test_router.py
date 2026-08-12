"""platform_sync router 测试 — 覆盖契约 §13 校验清单 8 项 + §4.2 冲突算法 + §7 字典序
+ §8 零回归 + §5/§6 响应形态 + 鉴权双路径。

对照跨仓契约 ``sillyhub-progress-sync-contract.md`` §13 + 客户端 ``sync.js`` 真实行为。
"""

from __future__ import annotations

# ISO 8601 UTC 串（契约 §7：字典序 == 时间序，T1 < T2 < T3）
T1 = "2026-08-10T13:00:00.000Z"
T2 = "2026-08-10T13:45:00.000Z"
T3 = "2026-08-10T14:30:00.000Z"

SAMPLE_PROGRESS: dict = {
    "project": {"name": "demo"},
    "changes": [{"name": "2026-08-10-xxx", "current_stage": "execute", "status": "in_progress"}],
    "stages": [],
    "steps": [],
    "batch_progress": [],
    "approvals": [],
}

OTHER_PROGRESS: dict = {
    "project": {"name": "other"},
    "changes": [{"name": "2026-08-10-yyy", "current_stage": "plan"}],
    "stages": [],
    "steps": [],
    "batch_progress": [],
    "approvals": [],
}


# ── 鉴权（契约 §2：Authorization: Bearer）─────────────────────────────────────


async def test_post_no_auth_returns_401(client):
    """无 Authorization → 401。"""
    resp = await client.post("/api/changes/c1/progress", json=SAMPLE_PROGRESS)
    assert resp.status_code == 401


async def test_get_changes_no_auth_returns_401(client):
    """GET 列表无 Authorization → 401。"""
    resp = await client.get("/api/changes")
    assert resp.status_code == 401


async def test_post_apikey_auth_ok(client, apikey_headers):
    """合法 shk_live_ API Key → 200（require_platform_sync APIKey 分支）。"""
    resp = await client.post(
        "/api/changes/c1/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T1},
    )
    assert resp.status_code == 200


async def test_post_jwt_auth_ok(client, auth_headers):
    """合法 JWT → 200（require_platform_sync JWT 回退分支）。"""
    resp = await client.post(
        "/api/changes/c1/progress",
        json=SAMPLE_PROGRESS,
        headers={**auth_headers, "X-SillySpec-Pushed-At": T1},
    )
    assert resp.status_code == 200


# ── §13-1 POST 读 3 个 X-SillySpec-* header ────────────────────────────────────


async def test_post_reads_three_headers(client, apikey_headers):
    """§13-1：POST 带 User/Pushed-At → 存入 last_pusher/last_pushed_at（GET 列表可验）。"""
    resp = await client.post(
        "/api/changes/c1/progress",
        json=SAMPLE_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-User": "alice",
            "X-SillySpec-Pushed-At": T2,
        },
    )
    assert resp.status_code == 200

    lst = await client.get("/api/changes", headers=apikey_headers)
    assert lst.status_code == 200
    items = lst.json()
    hit = [it for it in items if it["name"] == "c1"]
    assert hit and hit[0]["last_pusher"] == "alice" and hit[0]["last_pushed_at"] == T2


# ── §13-2 / §13-7 base_ts 冲突算法 + 零回归 ────────────────────────────────────


async def test_first_sync_no_base_ts_accepted(client, apikey_headers):
    """§13-7 / §4.2 分支1：无 X-SillySpec-Base-Ts（首次同步）→ 无条件接受 200。"""
    resp = await client.post(
        "/api/changes/c2/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    assert resp.status_code == 200


async def test_conflict_stored_greater_than_base_ts_409(client, apikey_headers):
    """§13-2 / §4.2 分支2：stored > base_ts（字典序）→ 409。"""
    # 先 push（Pushed-At=T2，无 base_ts）建立 stored=T2
    first = await client.post(
        "/api/changes/c3/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    assert first.status_code == 200
    # 再 push base_ts=T1（T1 < T2 字典序）→ 冲突 409
    resp = await client.post(
        "/api/changes/c3/progress",
        json=OTHER_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-Base-Ts": T1,
            "X-SillySpec-Pushed-At": T3,
        },
    )
    assert resp.status_code == 409


async def test_no_conflict_stored_equal_base_ts_200(client, apikey_headers):
    """§13-2 / §4.2 分支3：stored == base_ts（stored 不 > base_ts）→ 接受 200。"""
    await client.post(
        "/api/changes/c4/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    resp = await client.post(
        "/api/changes/c4/progress",
        json=OTHER_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-Base-Ts": T2,  # stored T2 不 > base T2 → 接受
            "X-SillySpec-Pushed-At": T3,
        },
    )
    assert resp.status_code == 200


async def test_no_conflict_stored_less_than_base_ts_200(client, apikey_headers):
    """§13-2：stored < base_ts → 接受 200（base_ts 更新）。"""
    await client.post(
        "/api/changes/c5/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    resp = await client.post(
        "/api/changes/c5/progress",
        json=OTHER_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-Base-Ts": T3,  # stored T2 < base T3 → 接受
            "X-SillySpec-Pushed-At": T3,
        },
    )
    assert resp.status_code == 200


# ── §13-3 / §13-8 409 body + 不 auto-merge ─────────────────────────────────────


async def test_conflict_body_and_no_auto_merge(client, apikey_headers):
    """§13-3 / §13-8：409 body {conflict,platform_progress,last_pushed_at}，
    platform_progress 严格=平台当前 latest_progress（未合并客户端 body）。"""
    await client.post(
        "/api/changes/c6/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    resp = await client.post(
        "/api/changes/c6/progress",
        json=OTHER_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-Base-Ts": T1,
            "X-SillySpec-Pushed-At": T3,
        },
    )
    assert resp.status_code == 409
    body = resp.json()
    assert body["conflict"] is True
    assert body["last_pushed_at"] == T2  # stored
    # platform_progress 是平台当前完整 latest_progress（SAMPLE，未合并 OTHER）
    assert body["platform_progress"] == SAMPLE_PROGRESS


# ── §13-4 GET /api/changes 轻量列表（裸数组）────────────────────────────────────


async def test_get_changes_list_bare_array(client, apikey_headers):
    """§13-4 / §5：GET /changes 返回裸数组，每项 name/current_stage/last_pushed_at/last_pusher。"""
    await client.post(
        "/api/changes/c7/progress",
        json=SAMPLE_PROGRESS,
        headers={
            **apikey_headers,
            "X-SillySpec-User": "bob",
            "X-SillySpec-Pushed-At": T2,
        },
    )
    resp = await client.get("/api/changes", headers=apikey_headers)
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)  # 裸数组形态（D-007，非 {changes:[...]}）
    hit = next(it for it in items if it["name"] == "c7")
    assert hit["current_stage"] == "execute"
    assert hit["last_pushed_at"] == T2
    assert hit["last_pusher"] == "bob"


# ── §13-5 GET /api/changes/{name}/progress 完整 JSON ─────────────────────────────


async def test_get_progress_full_with_last_pushed_at(client, apikey_headers):
    """§13-5 / §6：GET 单 change 返回完整六表 + 顶层 last_pushed_at（裸形态）。"""
    await client.post(
        "/api/changes/c8/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    resp = await client.get("/api/changes/c8/progress", headers=apikey_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["project"] == {"name": "demo"}
    assert body["changes"] == SAMPLE_PROGRESS["changes"]
    assert body["last_pushed_at"] == T2  # 顶层 last_pushed_at


async def test_get_progress_not_found_404(client, apikey_headers):
    """§13-5：GET 不存在的 change → 404（客户端 fetchJson 返回 null 降级，契约 §8/§10）。"""
    resp = await client.get("/api/changes/nope/progress", headers=apikey_headers)
    assert resp.status_code == 404


# ── §13-6 字典序比对（ISO 8601 UTC 串 > ）────────────────────────────────────────


async def test_lexicographic_order_drives_conflict(client, apikey_headers):
    """§13-6 / §7：stored > base_ts 用字符串字典序（不转 datetime）。

    T2 vs T1：同为 ISO 8601 UTC，字典序 T1<T2<T3 == 时间序。验证 base_ts=T1 触发 409、
    base_ts=T3 不触发（覆盖 §4.2 比对语义，确认后端未误转 datetime）。
    """
    await client.post(
        "/api/changes/c9/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    r1 = await client.post(
        "/api/changes/c9/progress",
        json=OTHER_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Base-Ts": T1, "X-SillySpec-Pushed-At": T3},
    )
    assert r1.status_code == 409  # stored T2 > base T1
    # stored 仍是 T2（409 未覆盖），base T3 > T2 → 接受
    r2 = await client.post(
        "/api/changes/c9/progress",
        json=OTHER_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Base-Ts": T3, "X-SillySpec-Pushed-At": T3},
    )
    assert r2.status_code == 200


# ── §13-7 零回归（老 body 无 header）────────────────────────────────────────────


async def test_old_body_no_headers_accepted(client, apikey_headers):
    """§13-7 / §8：老 body（裸 JSON，无任何 X-SillySpec-* header）→ base_ts 空 → 接受 200。

    客户端老版不发 header，后端 base_ts 视为空 → 等同首次同步（零回归硬要求）。
    """
    resp = await client.post(
        "/api/changes/c10/progress",
        json=SAMPLE_PROGRESS,
        headers=apikey_headers,  # 仅鉴权 header，无 X-SillySpec-*
    )
    assert resp.status_code == 200


# ── ql-20260811-005-6881 并发首推自愈（catch IntegrityError）──────────────────────


async def test_apply_catches_integrity_error_falls_back_to_update(db_session):
    """ql-20260811-005-6881：_apply catch IntegrityError 确定性回退 UPDATE。

    并发场景的等价模拟：预插行（=并发对手已抢先 INSERT 建行）后，以 row=None
    直接调 ``_apply``（=模拟「``upsert_progress`` 的 _find_row 在对手 commit 前返回
    None」的并发窗口）→ INSERT 撞复合唯一约束 ``uq_..._workspace_change`` → catch
    IntegrityError → rollback → 重查行 → UPDATE 覆盖。断言不抛、行被覆盖成新值。

    用 ``workspace_id=None`` 模拟 shk_live_ 过渡路径（design §9，nullable 列 + 唯一
    约束允许多 NULL）。

    说明：不做 ``asyncio.gather`` 端到端并发——SQLite 单连接 + anyio TaskGroup
    会把异常聚合成 ExceptionGroup 并以 ``sqlite3.IntegrityError`` 原始形态穿透到
    ASGI 层，该路径不代表生产 PG（独立连接、异常经 SQLAlchemy 翻译成
    ``sqlalchemy.exc.IntegrityError`` 在 service 层被 catch）。生产有效性靠本用例
    （service 层 catch）+ 重建镜像后日志无 500 双重保证。
    """
    from sqlalchemy import select

    from app.modules.platform_sync.model import PlatformChangeProgressORM
    from app.modules.platform_sync.service import PlatformSyncService

    # 预插行 = 并发对手已抢先 INSERT 建行（workspace_id=None 模拟 shk_live_ 过渡）
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=None,
            change_name="race-x",
            latest_progress={"old": True},
            last_pushed_at=T1,
            last_pusher="rival",
        )
    )
    await db_session.commit()

    new_body = {
        "project": {"name": "demo"},
        "changes": [{"name": "race-x", "current_stage": "plan"}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }
    svc = PlatformSyncService(db_session)
    # row=None 模拟并发窗口（upsert_progress 的 _find_row 在对手 commit 前返回 None）
    await svc._apply(None, None, "race-x", new_body, T2, "alice")

    db_session.expire_all()
    # 复合键重查（workspace_id=None + change_name）
    row = (
        await db_session.execute(
            select(PlatformChangeProgressORM).where(
                PlatformChangeProgressORM.change_name == "race-x",
                PlatformChangeProgressORM.workspace_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    assert row is not None
    assert row.latest_progress == new_body
    assert row.last_pusher == "alice"
    assert row.last_pushed_at == T2


# ── ql-20260812-001-6eb8 GET /changes/{name}/approval（CLI execute 审批门控）────────


async def test_get_approval_returns_approved(client, apikey_headers):
    """ql-20260812-001：合法 shk_live_ 鉴权 → 200 {status: approved}，CLI execute 门控放行。

    sillyspec CLI sync.js checkApproval GET 此端点，status≠pending/rejected 即放行。
    当前无审批策略 → 默认 approved；不查库，从未上行 progress 的 change 也 approved（不 404）。
    """
    resp = await client.get("/api/changes/never-pushed/approval", headers=apikey_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


async def test_get_approval_no_auth_returns_401(client):
    """ql-20260812-001：无 Authorization → 401（require_platform_sync 守门，契约 §2）。"""
    resp = await client.get("/api/changes/c1/approval")
    assert resp.status_code == 401


async def test_get_approval_jwt_auth_ok(client, auth_headers):
    """ql-20260812-001：合法 JWT → 200（require_platform_sync JWT fallback 分支）。"""
    resp = await client.get("/api/changes/c1/approval", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
