"""file 模块 router/service 测试。

覆盖 FR-1 上传（201 + 落库 + 返回 id）、大小超限 413、类型不符 415、
D-009 预览安全契约（图片 inline / 非图片 attachment / 中文名 RFC5987）、
FR-3 元数据（单条 + 批量）、FR-4 软删、未登录 401。
全部经 mock StorageBackend（dependency_overrides），不依赖真实 MinIO（NFR-4）。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.modules.file.tests.conftest import MockStorage, png_upload


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
