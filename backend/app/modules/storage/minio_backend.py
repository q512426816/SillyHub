"""MinIO 对象存储实现（aiobotocore，S3 兼容异步客户端）。

对齐 backend 现有异步栈（asyncpg/httpx）。client 单例惰性复用（ql-20260909-012：
原实现每次操作 ``create_client`` + ``async with`` 即建即毁——每次 put/get/head/
delete 都重付 TCP+TLS 握手，附件注入一次 2-11 次全新连接；aiobotocore
session/client 创建有开销，且与 LLM proxy 已修的"逐请求新建 AsyncClient"同类）。
lifespan shutdown 经 :meth:`aclose` 关闭；首个 put_object 前自动确保 bucket 存在。

选型依据：spike-01（2026-07-22）实测 aiobotocore 3.8.0 + aiohttp 3.14.2 +
botocore 1.43.46 与现有栈无冲突，put/head/get/delete 链路全通。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from aiobotocore.client import AioBaseClient
from aiobotocore.session import get_session

from app.modules.storage.base import ObjectStat, StorageBackend

_CHUNK = 1024 * 1024  # 流式读块大小 1MB


class MinioStorage(StorageBackend):
    """MinIO 后端。client 惰性单例复用；bucket 在首个写入前确保存在。"""

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
        self._client: AioBaseClient | None = None
        self._client_lock = asyncio.Lock()

    async def _get_client(self) -> AioBaseClient:
        """惰性创建并持有 client 单例（双重检查 + Lock 防并发首建竞态）。

        aiohttp 连接池随 client 存续跨操作复用（keep-alive）；aiohttp
        ClientError 后连接池自愈，client 对象可继续使用（官方推荐形态）。
        """
        if self._client is not None:
            return self._client
        async with self._client_lock:
            if self._client is None:
                ctx = self._session.create_client(
                    "s3",
                    endpoint_url=self._endpoint,
                    aws_access_key_id=self._access_key,
                    aws_secret_access_key=self._secret_key,
                    region_name=self._region,
                )
                # create_client() 返回的是 ClientCreatorContext（异步上下文
                # 管理器），__aenter__() 的**返回值**才是 AioBaseClient——必须
                # 捕获返回值存单例；存 ctx 本体会 AttributeError（ctx 无
                # put_object 等操作方法，线上文件中心全量 500，ql-20260911-026）。
                self._client = await ctx.__aenter__()
        return self._client

    async def aclose(self) -> None:
        """关闭 client（lifespan shutdown 调用；关闭后可重建——惰性单例可复活）。"""
        async with self._client_lock:
            client, self._client = self._client, None
        if client is not None:
            await client.__aexit__(None, None, None)

    async def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        s3 = await self._get_client()
        try:
            await s3.create_bucket(Bucket=self._bucket)
        except Exception:
            # BucketAlreadyOwnedByYou / 已存在 → 忽略，幂等。
            pass
        self._bucket_ready = True

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        await self._ensure_bucket()
        s3 = await self._get_client()
        await s3.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    async def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        s3 = await self._get_client()
        resp = await s3.get_object(Bucket=self._bucket, Key=key)
        body = resp["Body"]
        try:
            async for chunk in body.iter_chunks(_CHUNK):
                yield chunk
        finally:
            # client 单例不随生成器关闭——消费方提前 break 也必须释放响应体
            # 连接（否则 aiohttp "Unclosed response" 泄漏累积）。
            body.close()

    async def delete_object(self, key: str) -> None:
        s3 = await self._get_client()
        await s3.delete_object(Bucket=self._bucket, Key=key)

    async def head_object(self, key: str) -> ObjectStat:
        s3 = await self._get_client()
        resp = await s3.head_object(Bucket=self._bucket, Key=key)
        return ObjectStat(
            size=int(resp["ContentLength"]),
            content_type=str(resp.get("ContentType", "application/octet-stream")),
        )
