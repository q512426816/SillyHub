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
    """ql-20260811-005-6881 + task-04：_apply catch IntegrityError 确定性回退 UPDATE。

    并发场景的等价模拟：建 workspace 行 + 预插行（=并发对手已抢先 INSERT 建行）后，
    以 row=None 直接调 ``_apply``（=模拟「``upsert_progress`` 的 _find_row 在对手 commit
    前返回 None」的并发窗口）→ INSERT 撞复合唯一约束 ``uq_..._workspace_change`` →
    catch IntegrityError → rollback → 重查行 → UPDATE 覆盖。断言不抛、行被覆盖成新值。

    task-01/02/03 主键改为独立 ``id`` 后，冲突源是 ``(workspace_id, change_name)`` 复合
    唯一（design §5 / R-03）：``workspace_id=None`` 双发不再撞唯一（SQL NULL 不参与
    唯一性）→ 不回退、反造两行。故本用例改用**真实 workspace UUID**：预插同复合键
    ``(ws.id, "race-x")`` 行，并发二次 INSERT 撞复合唯一 → 确定性回退 UPDATE 覆盖
    （FR-05 / R-03，断言「回退 UPDATE 成功」而非「NULL 走 IntegrityError」）。

    说明：不做 ``asyncio.gather`` 端到端并发——SQLite 单连接 + anyio TaskGroup
    会把异常聚合成 ExceptionGroup 并以 ``sqlite3.IntegrityError`` 原始形态穿透到
    ASGI 层，该路径不代表生产 PG（独立连接、异常经 SQLAlchemy 翻译成
    ``sqlalchemy.exc.IntegrityError`` 在 service 层被 catch）。生产有效性靠本用例
    （service 层 catch）+ 重建镜像后日志无 500 双重保证。
    """
    import uuid

    from sqlalchemy import select

    from app.modules.platform_sync.model import PlatformChangeProgressORM
    from app.modules.platform_sync.service import PlatformSyncService
    from app.modules.workspace.model import Workspace

    # 建 workspace 行（workspace_id FK→workspaces，复合唯一约束参与方须为真实 UUID）
    ws = Workspace(
        id=uuid.uuid4(),
        name="ws-race",
        slug="ws-race",
        root_path="/tmp/ws-race",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    # _apply 内部 IntegrityError → rollback 会无条件 expire 全部对象（expire_on_commit 只管
    # commit）；先在 ws 未过期时捕获裸 uuid 局部变量，避免后面对过期属性做同步懒加载
    # （MissingGreenlet）。
    ws_id = ws.id

    # 预插行 = 并发对手已抢先 INSERT 建行（同 workspace 复合键 (ws.id, "race-x")）
    rival = PlatformChangeProgressORM(
        workspace_id=ws.id,
        change_name="race-x",
        latest_progress={"old": True},
        last_pushed_at=T1,
        last_pusher="rival",
    )
    db_session.add(rival)
    await db_session.commit()
    await db_session.refresh(rival)
    rival_id = rival.id
    assert rival_id is not None

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
    await svc._apply(ws.id, None, "race-x", new_body, T2, "alice")

    # expire_all 前 ws_id 已捕获（见建行处）；expire 后只访问裸 uuid 局部变量。
    db_session.expire_all()
    # 复合键重查（ws.id + change_name）
    row = (
        await db_session.execute(
            select(PlatformChangeProgressORM).where(
                PlatformChangeProgressORM.change_name == "race-x",
                PlatformChangeProgressORM.workspace_id == ws_id,
            )
        )
    ).scalar_one_or_none()
    assert row is not None
    assert row.latest_progress == new_body
    assert row.last_pusher == "alice"
    assert row.last_pushed_at == T2
    # 主键生效（task-01）：id 非 None，且回退 UPDATE 后保持对手行 id、不新造
    assert row.id is not None
    assert row.id == rival_id


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


# ── Change 2026-08-14-platform-sync-docs-approval task-05：documents / approval 端点 ──

DOCS: dict = {
    "proposal.md": "# proposal 测试",
    "design.md": "# design 测试",
    "tasks.md": "# tasks 测试",
}


async def test_post_documents_ok(client, apikey_headers):
    """POST documents 合法 body → 200 {synced, change_name}（FR-01）。"""
    resp = await client.post("/api/changes/doc-change/documents", json=DOCS, headers=apikey_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"synced": 3, "change_name": "doc-change"}


async def test_post_documents_empty_map_422(client, apikey_headers):
    """空 map → 422（schema 白名单 validator）。"""
    resp = await client.post("/api/changes/doc-change/documents", json={}, headers=apikey_headers)
    assert resp.status_code == 422


async def test_post_documents_bad_key_422(client, apikey_headers):
    """白名单外键 → 422。"""
    resp = await client.post(
        "/api/changes/doc-change/documents",
        json={"evil.md": "x"},
        headers=apikey_headers,
    )
    assert resp.status_code == 422


async def test_post_documents_bad_value_422(client, apikey_headers):
    """值非 str → 422（dict[str, str] 类型校验）。"""
    resp = await client.post(
        "/api/changes/doc-change/documents",
        json={"proposal.md": 123},
        headers=apikey_headers,
    )
    assert resp.status_code == 422


async def test_post_documents_no_auth_401(client):
    """无 Authorization → 401。"""
    resp = await client.post("/api/changes/doc-change/documents", json=DOCS)
    assert resp.status_code == 401


async def test_post_approval_rejected_with_reason(client, apikey_headers):
    """POST approval rejected + reason → 200（FR-02）；GET 读回真实状态（FR-03）。"""
    resp = await client.post(
        "/api/changes/ap-change/approval",
        json={"decision": "rejected", "reason": "设计有缺口"},
        headers=apikey_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["decision"] == "rejected"

    got = await client.get("/api/changes/ap-change/approval", headers=apikey_headers)
    assert got.status_code == 200
    assert got.json()["status"] == "rejected"
    assert got.json()["reason"] == "设计有缺口"


async def test_post_approval_approved_without_reason_key(client, apikey_headers):
    """approved 分支 body 不含 reason 键（CLI sync.js:963 字面）→ 200（Grill UB-3）。"""
    resp = await client.post(
        "/api/changes/ap-change/approval",
        json={"decision": "approved"},
        headers=apikey_headers,
    )
    assert resp.status_code == 200


async def test_post_approval_bad_decision_422(client, apikey_headers):
    """非过去式 decision（"approve"）→ 422。"""
    resp = await client.post(
        "/api/changes/ap-change/approval",
        json={"decision": "approve"},
        headers=apikey_headers,
    )
    assert resp.status_code == 422


async def test_post_approval_no_auth_401(client):
    """无 Authorization → 401。"""
    resp = await client.post("/api/changes/ap-change/approval", json={"decision": "approved"})
    assert resp.status_code == 401


async def test_get_approval_no_record_default_approved(client, apikey_headers):
    """GET 无任何记录 → 默认 approved 放行（ql-20260812-001-6eb8 兼容，FR-03）。"""
    resp = await client.get("/api/changes/never-pushed-x/approval", headers=apikey_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "approved"
    assert body["reason"] == "no approval record; default-approved"


async def test_get_approval_placeholder_row_still_default(client, apikey_headers):
    """仅 documents 的占位行（approval NULL）→ GET approval 仍默认 approved（FR-05 例外）。"""
    await client.post("/api/changes/placeholder-c/documents", json=DOCS, headers=apikey_headers)
    resp = await client.get("/api/changes/placeholder-c/approval", headers=apikey_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


async def test_single_writer_progress_preserves_approval(client, apikey_headers):
    """单写者回归：push progress 后 set_approval 再 push → approval 仍在（FR-04）。"""
    await client.post(
        "/api/changes/writer-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T1},
    )
    await client.post(
        "/api/changes/writer-c/approval",
        json={"decision": "rejected", "reason": "hold"},
        headers=apikey_headers,
    )
    # 二次 push progress（base_ts 推进）不冲掉 approval
    await client.post(
        "/api/changes/writer-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T2},
    )
    got = await client.get("/api/changes/writer-c/approval", headers=apikey_headers)
    assert got.json()["status"] == "rejected"


async def test_single_writer_approval_preserves_progress(client, apikey_headers):
    """单写者回归：push progress 后 upsert documents → latest_progress 仍在（FR-04）。"""
    await client.post(
        "/api/changes/writer2-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T1},
    )
    await client.post("/api/changes/writer2-c/documents", json=DOCS, headers=apikey_headers)
    got = await client.get("/api/changes/writer2-c/progress", headers=apikey_headers)
    assert got.status_code == 200
    assert got.json()["changes"] == SAMPLE_PROGRESS["changes"]


async def test_placeholder_guard_progress_404_and_list_hidden(client, apikey_headers):
    """占位行守卫（FR-05 / Grill UB-1）：仅 documents 建行 → GET progress 404 +
    GET /changes 列表不出现；随后 push progress 正常 UPDATE 不撞复合唯一键。"""
    await client.post("/api/changes/guard-c/documents", json=DOCS, headers=apikey_headers)
    # 守卫 1：GET progress 404（不是 200 空态）
    prog = await client.get("/api/changes/guard-c/progress", headers=apikey_headers)
    assert prog.status_code == 404
    # 守卫 2：列表不出现占位行
    lst = await client.get("/api/changes", headers=apikey_headers)
    assert all(it["name"] != "guard-c" for it in lst.json())
    # 后续 push progress 正常 UPDATE（不撞 uq 复合唯一）
    push = await client.post(
        "/api/changes/guard-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**apikey_headers, "X-SillySpec-Pushed-At": T1},
    )
    assert push.status_code == 200
    prog2 = await client.get("/api/changes/guard-c/progress", headers=apikey_headers)
    assert prog2.status_code == 200
    # 且 documents 仍在（单写者）
    assert prog2.json().get("changes") == SAMPLE_PROGRESS["changes"]
