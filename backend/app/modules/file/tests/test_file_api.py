"""file 模块 router/service 测试。

覆盖 FR-1 上传（201 + 落库 + 返回 id）、大小超限 413、类型不符 415、
D-009 预览安全契约（图片 inline / 非图片 attachment / 中文名 RFC5987）、
FR-3 元数据（单条 + 批量）、FR-4 软删、未登录 401。
全部经 mock StorageBackend（dependency_overrides），不依赖真实 MinIO（NFR-4）。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.auth.model import User
from app.modules.file.model import File
from app.modules.file.schema import FileMetaResp
from app.modules.file.service import FileService
from app.modules.file.tests.conftest import MockStorage, make_id, png_upload


async def test_upload_success(
    file_client: AsyncClient, auth_headers: dict, mock_storage: MockStorage
) -> None:
    resp = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["original_name"] == "现场照片.png"
    assert body["mime_type"] == "image/png"
    assert body["size"] > 0
    uuid.UUID(body["id"])  # 合法 uuid
    # 存储层确已 put（stored_key 落 mock）
    assert len(mock_storage.objects) == 1


async def test_upload_too_large_413(file_client: AsyncClient, auth_headers: dict) -> None:
    big = b"x" * (51 * 1024 * 1024)  # 超默认 50MB
    resp = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        files={"file": ("big.png", big, "image/png")},
    )
    assert resp.status_code == 413, resp.text


async def test_upload_type_not_allowed_415(file_client: AsyncClient, auth_headers: dict) -> None:
    resp = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        files={"file": ("evil.html", b"<script>1</script>", "text/html")},
    )
    assert resp.status_code == 415, resp.text


async def test_download_image_inline(
    file_client: AsyncClient, auth_headers: dict, mock_storage: MockStorage
) -> None:
    up = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    fid = up.json()["id"]
    resp = await file_client.get(f"/api/file/{fid}", headers=auth_headers)
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert cd.startswith("inline")
    assert resp.headers["content-type"].startswith("image/png")


async def test_download_non_image_attachment(file_client: AsyncClient, auth_headers: dict) -> None:
    up = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        files={"file": ("说明书.pdf", b"%PDF-fake", "application/pdf")},
    )
    fid = up.json()["id"]
    resp = await file_client.get(f"/api/file/{fid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")


async def test_download_chinese_name_rfc5987(file_client: AsyncClient, auth_headers: dict) -> None:
    up = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    fid = up.json()["id"]
    resp = await file_client.get(f"/api/file/{fid}", headers=auth_headers)
    assert "filename*=UTF-8''" in resp.headers["content-disposition"]


async def test_get_meta_and_batch_meta(file_client: AsyncClient, auth_headers: dict) -> None:
    up = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    fid = up.json()["id"]
    meta = await file_client.get(f"/api/file/{fid}/meta", headers=auth_headers)
    assert meta.status_code == 200
    assert meta.json()["id"] == fid
    assert "owner_type" in meta.json()
    batch = await file_client.post(
        "/api/file/batch-meta", headers=auth_headers, json={"ids": [fid]}
    )
    assert batch.status_code == 200
    assert len(batch.json()) == 1
    assert batch.json()[0]["id"] == fid


async def test_soft_delete_then_404(file_client: AsyncClient, auth_headers: dict) -> None:
    up = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    fid = up.json()["id"]
    dele = await file_client.delete(f"/api/file/{fid}", headers=auth_headers)
    assert dele.status_code == 204
    gone = await file_client.get(f"/api/file/{fid}", headers=auth_headers)
    assert gone.status_code == 404


async def test_upload_requires_auth(file_client: AsyncClient) -> None:
    resp = await file_client.post("/api/file/upload", files=png_upload())
    assert resp.status_code == 401, resp.text


# ── task-13 / FR-06：按 owner_type 列文件端点（业务人员「借用方案」查看）──────
# 业务人员（business_member）借用工作空间共享 daemon 产出的方案文件落 File 表
# owner_type="workspace" + owner_id=ws_id（design §5 Phase 5 / D-009@v1）。本端点
# 供前端 BorrowedSolutionFiles 列方案，按 owner_type / owner_id 过滤。


async def test_list_by_owner_type_workspace(file_client: AsyncClient, auth_headers: dict) -> None:
    """按 owner_type=workspace + owner_id 列文件，仅返回匹配归属的活跃文件。"""
    ws_id = make_id()
    # 两条 workspace 方案 + 一条 ppm_problem 文件（不同 owner_type）
    for name in ("plan-a.md", "plan-b.md"):
        resp = await file_client.post(
            "/api/file/upload",
            headers=auth_headers,
            params={"owner_type": "workspace", "owner_id": str(ws_id)},
            files={"file": (name, b"# plan", "text/markdown")},
        )
        assert resp.status_code == 201, resp.text
    other = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        params={"owner_type": "ppm_problem", "owner_id": str(make_id())},
        files={"file": ("问题附件.png", b"\x89PNG\r", "image/png")},
    )
    assert other.status_code == 201

    listed = await file_client.get(
        "/api/file/list",
        headers=auth_headers,
        params={"owner_type": "workspace", "owner_id": str(ws_id)},
    )
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    # 只返回 workspace 归属的 2 条；ppm_problem 不在
    assert len(rows) == 2
    assert all(r["owner_type"] == "workspace" for r in rows)
    assert all(r["owner_id"] == str(ws_id) for r in rows)


async def test_list_excludes_soft_deleted(file_client: AsyncClient, auth_headers: dict) -> None:
    """软删文件不出现在列表。"""
    ws_id = make_id()
    up1 = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        params={"owner_type": "workspace", "owner_id": str(ws_id)},
        files={"file": ("保留.md", b"x", "text/markdown")},
    )
    up2 = await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        params={"owner_type": "workspace", "owner_id": str(ws_id)},
        files={"file": ("删除.md", b"y", "text/markdown")},
    )
    dele = await file_client.delete(f"/api/file/{up2.json()['id']}", headers=auth_headers)
    assert dele.status_code == 204

    listed = await file_client.get(
        "/api/file/list",
        headers=auth_headers,
        params={"owner_type": "workspace", "owner_id": str(ws_id)},
    )
    rows = listed.json()
    assert len(rows) == 1
    assert rows[0]["id"] == up1.json()["id"]


async def test_list_without_filters_returns_all_active(
    file_client: AsyncClient, auth_headers: dict
) -> None:
    """无过滤参数 + platform_admin（auth_headers fixture）→ 可见域豁免，返回全部活跃文件（D-002 admin 分支）。"""
    before = await file_client.get("/api/file/list", headers=auth_headers)
    assert before.status_code == 200
    pre_count = len(before.json())

    await file_client.post(
        "/api/file/upload",
        headers=auth_headers,
        params={"owner_type": "workspace", "owner_id": str(make_id())},
        files={"file": ("x.md", b"x", "text/markdown")},
    )
    after = await file_client.get("/api/file/list", headers=auth_headers)
    assert len(after.json()) == pre_count + 1


async def test_list_requires_auth(file_client: AsyncClient) -> None:
    resp = await file_client.get("/api/file/list")
    assert resp.status_code == 401, resp.text


# ── agent-file-upload-mcp task-01：description / created_at 扩展字段 ─────────
# design §7.1 / §8 D-006@v2：/api/file/upload 既有签名不变（description 业务
# 消费方是 task-03 file_artifacts 端点），带 description 的上传走 service 直调；
# HTTP 侧只断言新字段在响应中出现且缺省为 None（旧行 NULL 兼容）。


async def test_upload_resp_description_default_none(
    file_client: AsyncClient, auth_headers: dict
) -> None:
    """HTTP 上传不传 description：上传/meta/batch/list 响应 description 均为 None，meta 另含 created_at。"""
    up = await file_client.post("/api/file/upload", headers=auth_headers, files=png_upload())
    assert up.status_code == 201, up.text
    body = up.json()
    assert body["description"] is None
    fid = body["id"]

    meta = await file_client.get(f"/api/file/{fid}/meta", headers=auth_headers)
    assert meta.status_code == 200
    assert meta.json()["description"] is None
    assert "created_at" in meta.json()

    batch = await file_client.post(
        "/api/file/batch-meta", headers=auth_headers, json={"ids": [fid]}
    )
    assert batch.status_code == 200
    assert batch.json()[0]["description"] is None
    assert "created_at" in batch.json()[0]

    listed = await file_client.get("/api/file/list", headers=auth_headers)
    assert listed.status_code == 200
    row = next(r for r in listed.json() if r["id"] == fid)
    assert row["description"] is None
    assert "created_at" in row


async def test_service_upload_with_description_roundtrip(
    db_session: AsyncSession, mock_storage: MockStorage
) -> None:
    """service 直调带 description：FileUploadResp 带出，meta/batch/list 全路径回显，created_at 等于落库时间。"""
    svc = FileService(db_session, mock_storage, get_settings())
    uid = make_id()
    resp = await svc.upload_file(
        original_name="方案.md",
        data=b"# plan",
        mime_type="text/markdown",
        uploaded_by=uid,
        description="主 agent 产出的执行方案",
    )
    assert resp.description == "主 agent 产出的执行方案"

    me = User(id=uid, is_platform_admin=False)  # 仅 _can_access 属性判定用
    row = await db_session.get(File, resp.id)
    assert row.description == "主 agent 产出的执行方案"

    meta = FileMetaResp.model_validate(await svc.get_meta(resp.id, user=me))
    assert meta.description == "主 agent 产出的执行方案"
    assert meta.created_at == row.created_at  # 等于落库时间

    batch = await svc.batch_meta([resp.id], user=me)
    assert batch[0].description == "主 agent 产出的执行方案"
    assert batch[0].created_at == row.created_at

    listed = await svc.list_files(user=me)
    assert [f.id for f in listed] == [resp.id]
    assert listed[0].description == "主 agent 产出的执行方案"
    assert listed[0].created_at == row.created_at


async def test_service_upload_description_truncated_to_255(
    db_session: AsyncSession, mock_storage: MockStorage
) -> None:
    """超长 description 落库前截断 255（仿 original_name，不加新校验错误码）。"""
    svc = FileService(db_session, mock_storage, get_settings())
    resp = await svc.upload_file(
        original_name="a.md",
        data=b"a",
        mime_type="text/markdown",
        uploaded_by=make_id(),
        description="x" * 300,
    )
    assert resp.description == "x" * 255
    row = await db_session.get(File, resp.id)
    assert row.description == "x" * 255
