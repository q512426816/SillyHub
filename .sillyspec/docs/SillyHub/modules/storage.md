---
schema_version: 1
doc_type: module-card
module_id: storage
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 对象存储抽象层（storage）

## 定位
平台文件中心的对象存储抽象与实现层（S3/MinIO），纯基础设施：无 HTTP router、无数据库表。只管"对象存到哪、怎么读写"（bytes 上传、流式下载、删除、元信息），文件业务元数据（文件名/大小/归属/软删）归 `file` 模块。选型基于 spike-01（aiobotocore 3.8.0 与现有异步栈实测无冲突）。

## 契约摘要
- 抽象基类 `StorageBackend`（base.py，ABC），四个抽象方法：
  - `put_object(key, data, content_type)`：上传对象；key 是存储键（由 file 层生成，storage 视为不透明透传）
  - `get_object_stream(key) -> AsyncIterator[bytes]`：按块流式读（声明为非 `async def`，兼容异步生成器与返回迭代器的 mock 两种写法）
  - `delete_object(key)` / `head_object(key) -> ObjectStat`（不存在抛底层异常）
  - `aclose()`：lifespan shutdown 关连接，默认 no-op
- `ObjectStat(size, content_type)`：head 返回值稳定结构，隔离 botocore 原始响应
- 工厂（factory.py）：
  - `init_storage_backend(settings)`：lifespan startup 建模块级单例，幂等
  - `get_storage_backend()`：FastAPI Depends 注入点；未初始化（测试直挂 router）时按当前 `get_settings()` 兜底建
  - `_build(settings)`：分发器，目前仅 `storage_backend == "minio"` 分支，其余抛 ValueError；新增 OSS 等在此注册
- 消费方：`file`（service+router 经 Depends）、`ppm.problem`（router）、`agent.service`（局部 import）、`main.py` lifespan

## 关键逻辑
MinIO 实现（`MinioStorage`）：
```
session = aiobotocore.get_session()          # 模块级复用（建 client 有开销）
client = session.create_client("s3", endpoint/keys/bucket/region)
put_object:  先 _ensure_bucket()（create_bucket 失败一律吞 → 幂等，_bucket_ready 只跑一次）
get_stream:  resp["Body"].iter_chunks(1MB) 异步产出
head:        ContentLength/ContentType → ObjectStat（ContentType 缺省 octet-stream）
```

## 注意事项
- 测试不碰真实 MinIO：`app.dependency_overrides[get_storage_backend]` 注入内存 mock，新增存储测试走同一注入路径
- storage 层不做对象级软删/版本管理（那是 file 层职责）；要多版本需换支持版本化的后端
- `get_object_stream` 是异步生成器，调用方需用 StreamingResponse 正确消费，提前关闭触发生成器清理
- 新增后端 = 实现 `StorageBackend` 四方法 + `_build` 注册分支，业务零改动；需确认 `aclose` 与流式读语义对齐
- delete_object 目前由 file 软删清理流程间接触发，本模块无自身调度

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
