---
schema_version: 1
doc_type: module-card
module_id: storage
source_commit: pending
author: qinyi
created_at: 2026-07-22T16:00:00
---
# storage

## 定位
平台级对象存储后端的**抽象层**，定义统一的 S3 兼容契约（上传/下载流/删除/HEAD）。当前实现为 MinIO（自建，S3 协议），后续若迁移到阿里云 OSS 或其它 S3 兼容存储，只需新增一个 `StorageBackend` 子类并切换 `factory`，上层 `file` 模块与业务代码零改动。是文件中心（`file` 模块）唯一依赖的存储入口。

## 契约摘要
- `StorageBackend`（ABC，`base.py`）四方法一生命周期：
  - `put_object(key, data, content_type) -> None` — 整对象上传（`data: bytes`）
  - `get_object_stream(key) -> AsyncIterator[bytes]` — **流式**分块下载（1MB/块），声明为普通 `def` 返回异步迭代器（便于测试 Mock）
  - `delete_object(key) -> None` — 删除对象
  - `head_object(key) -> ObjectStat | None` — 取 size/content_type，不存在返回 `None`
  - `aclose() -> None` — 关闭底层会话（lifespan shutdown 调用）
- `ObjectStat`（dataclass）：`size: int`、`content_type: str | None`
- `MinioStorage`（`minio_backend.py`）：基于 `aiobotocore` 的异步 S3 客户端，构造时幂等建桶（`_ensure_bucket`）
- `get_storage_backend() -> StorageBackend` — FastAPI `Depends` 注入点（懒加载兜底）
- `init_storage_backend(settings)` — 应用 lifespan 启动时初始化模块级单例
- 配置（`core/config.py` storage 段）：`storage_backend`、`s3_endpoint`、`s3_access_key/secret_key`、`s3_bucket`、`s3_region`

## 关键逻辑
```
init_storage_backend(settings):
  if _backend is None:                        # 模块级单例，幂等
    _backend = MinioStorage(endpoint, ak, sk, bucket, region)
    await _backend._ensure_bucket()           # 不存在则建桶，已存在跳过

MinioStorage.get_object_stream(key):          # 流式下载，省内存
  async with client.get_object(Bucket, Key) as resp:
    async for chunk in body.iter_chunks(_CHUNK):   # _CHUNK = 1MB
      yield chunk

factory.get_storage_backend():                # Depends 注入点
  if _backend is None: init_storage_backend(get_settings())   # 懒加载兜底
  return _backend
```

## 注意事项
- `get_object_stream` 是**异步生成器**，但函数签名是普通 `def`（返回 `AsyncIterator`）——这是为了让 SQLite 内存测试用同步 Mock 替身，写测试时勿改回 `async def`。
- `aiobotocore` 版本必须与 `botocore` 对齐（pin 在 3.8.0），否则 `Session.create_client` 会 import 失败。
- 桶名、endpoint、密钥全部走 `settings`（env 注入），代码中无硬编码凭证。
- 迁移到 OSS 时：新增 `OssStorage(StorageBackend)` 实现四方法，在 `factory` 里按 `settings.storage_backend` 选择实现，上层不动。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
