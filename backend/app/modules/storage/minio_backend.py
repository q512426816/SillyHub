"""MinIO 对象存储实现（aiobotocore，S3 兼容异步客户端）。

对齐 backend 现有异步栈（asyncpg/httpx），客户端为模块级复用（aiobotocore
session/client 创建有开销），首个 put_object 前自动确保 bucket 存在。

选型依据：spike-01（2026-07-22）实测 aiobotocore 3.8.0 + aiohttp 3.14.2 +
botocore 1.43.46 与现有栈无冲突，put/head/get/delete 链路全通。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from aiobotocore.session import get_session

from app.modules.storage.base import ObjectStat, StorageBackend

_CHUNK = 1024 * 1024  # 流式读块大小 1MB


class MinioStorage(StorageBackend):
    """MinIO 后端。bucket 在首个写入前确保存在。"""

    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "us-east-1",
    ) -> None:
        self._endpoint = endpoint
        self._access_key = access_key
        self._secret_key = secret_key
        self._bucket = bucket
        self._region = region
        self._session = get_session()
        self._bucket_ready = False

    def _client(self):
        return self._session.create_client(
            "s3",
            endpoint_url=self._endpoint,
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
            region_name=self._region,
        )

    async def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        async with self._client() as s3:
            try:
                await s3.create_bucket(Bucket=self._bucket)
            except Exception:
                # BucketAlreadyOwnedByYou / 已存在 → 忽略，幂等。
                pass
        self._bucket_ready = True

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        await self._ensure_bucket()
        async with self._client() as s3:
            await s3.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    async def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        async with self._client() as s3:
            resp = await s3.get_object(Bucket=self._bucket, Key=key)
            body = resp["Body"]
            async for chunk in body.iter_chunks(_CHUNK):
                yield chunk

    async def delete_object(self, key: str) -> None:
        async with self._client() as s3:
            await s3.delete_object(Bucket=self._bucket, Key=key)

    async def head_object(self, key: str) -> ObjectStat:
        async with self._client() as s3:
            resp = await s3.head_object(Bucket=self._bucket, Key=key)
        return ObjectStat(
            size=int(resp["ContentLength"]),
            content_type=str(resp.get("ContentType", "application/octet-stream")),
        )
