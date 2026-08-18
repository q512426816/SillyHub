---
schema_version: 1
doc_type: module-card
module_id: storage
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 对象存储抽象层（storage）

## 定位

平台级对象存储的**抽象层**：`StorageBackend` ABC 定义 S3 兼容四方法契约，当前唯一实现
MinioStorage（aiobotocore 异步客户端）。业务代码只依赖接口；换后端只改配置 +
factory 注册，业务零改动（NFR-2）。无 HTTP 端点、无表——纯库模块。

## 契约摘要

- `StorageBackend`（base.py ABC）：
  - `put_object(key, data: bytes, content_type)` — 整对象上传
  - `get_object_stream(key) -> AsyncIterator[bytes]` — 流式分块读（StreamingResponse
    下载/预览用，大文件不整体入内存）；声明为普通 `def`（兼容生成器实现与 mock 注入）
  - `delete_object(key)` — 删除（file 软删后的清理流程调用，当前暂无直接调用方）
  - `head_object(key) -> ObjectStat` — 元信息（size/content_type），不存在抛底层异常
  - `aclose()` — lifespan shutdown 关连接，默认 no-op
- `ObjectStat`（frozen dataclass）：`size: int`、`content_type: str`
- `init_storage_backend(settings)` — main.py lifespan startup 建模块级单例（幂等）
- `get_storage_backend()` — FastAPI Depends 注入点；未初始化时按当前配置兜底自建
- 配置（core/config.py）：`storage_backend`（当前仅 "minio"，其它值 ValueError）、
  `s3_endpoint` / `s3_access_key` / `s3_secret_key` / `s3_bucket` / `s3_region`

## 关键逻辑

```
_build(settings): settings.storage_backend=="minio" → MinioStorage(...)
                   （新增 OSS 等在此注册分支）

MinioStorage: 模块级 aiobotocore session 复用（建 client 有开销）
  put 前 _ensure_bucket()（create_bucket 异常吞 = 幂等，已存在不炸）
  get 流式: body.iter_chunks(1MB) 逐块 yield
```

## 注意事项

- 消费方：file 模块（文件中心上传/下载/元信息，`Depends(get_storage_backend)` 注入）、
  agent（persist_borrow_run_output 借用 run 产物持久化，lazy import factory）、ppm 依赖
  该层走对象存储；main.py lifespan startup init / shutdown aclose
- 测试不依赖真实 MinIO（NFR-4）：`app.dependency_overrides[get_storage_backend]` 注入
  mock，或 monkeypatch factory 单例
- `get_object_stream` 签名是普通 `def` 返回 AsyncIterator——为兼容同步 mock 替身，
  勿改回 `async def`
- aiobotocore 版本与 botocore 需对齐（spike-01 2026-07-22 实测组合：aiobotocore
  3.8.0 + botocore 1.43.46 + aiohttp 3.14.2 无冲突）
- 凭证全部走 settings（env 注入），代码零硬编码

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
