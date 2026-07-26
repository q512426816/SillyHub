---
schema_version: 1
doc_type: module-card
module_id: storage
---

# storage

## 定位

平台文件中心的**存储后端抽象与实现层**，纯基础设施模块，无 HTTP router、无数据库表。

只负责"对象存到哪、怎么存、怎么读"——对象本体（bytes）的上传、流式下载、删除、元信息查询。
**不负责**文件业务元数据（文件名、大小、归属、软删标记等落 `file` 表的字段，那是 `file` 模块的职责）。

边界示例：
- `storage` 处理 `put_object(key, bytes, content_type)` 把内容写进 MinIO；
- `file` 模块负责生成 `key`、把元数据写 `file` 表、软删、权限校验，再调用 storage 删除/下载。

依赖方向：`storage` 依赖 `core`（config）；被 `file` 模块经 FastAPI Depends 注入使用。

## 契约摘要

对外只暴露一套抽象后端 + 一个 Depends 注入点，业务代码（file 服务）只依赖接口不关心底层实现。

抽象基类 `StorageBackend`（base.py）定义四个核心能力（具体符号清单以 `_module-map.yaml` 为准）：

- `put_object(key, data, content_type)`：上传对象。`key` 是存储键（非原始文件名），由上层 file 模块生成。
- `get_object_stream(key)`：按块流式读取，返回异步迭代器，供 `StreamingResponse` 做下载/预览，避免大文件整体进内存。声明为非 `async def`，以兼容异步生成器实现与返回迭代器的 mock 注入两种写法。
- `delete_object(key)`：删除对象（file 软删后由清理流程调用，本模块的调用方目前主要是 file 服务）。
- `head_object(key) -> ObjectStat`：读对象元信息（`size`、`content_type`），不存在抛底层异常。
- `aclose()`：关闭底层连接，lifespan shutdown 调用，默认无操作。

配套数据类 `ObjectStat(size, content_type)`——head 返回值的稳定结构，避免上层依赖 botocore 原始响应字典。

注入点：`get_storage_backend()` 作为 FastAPI Depends 提供给 file 服务；测试经 `app.dependency_overrides[get_storage_backend]` 换成内存 mock，不依赖真实 MinIO（NFR-4）。

## 关键逻辑

**工厂选后端（factory.py）**

- `init_storage_backend(settings)`：应用 lifespan startup 调一次，按 `settings.storage_backend` 建实现并缓存为模块级单例 `_backend`。重复调用返回已建单例（幂等）。
- `_build(settings)`：分发器，目前仅 `storage_backend == "minio"` 分支；新增 OSS 等后端在此加分支（NFR-2，切换后端只改配置 + factory 注册，业务零改动）。
- `get_storage_backend()`：Depends 注入点。单例未初始化时（如测试直挂 router）按当前 `get_settings()` 兜底建一个，避免 None。

**MinIO 实现（minio_backend.py，`MinioStorage`）**

- 基于 **aiobotocore**（S3 兼容异步客户端），对齐后端 asyncpg/httpx 异步栈，客户端为模块级 `session` 复用（创建有开销，不每次新建 session）。
- 每次 IO 用 `_client()` 上下文管理器 `create_client("s3", endpoint_url=..., ...)` 创建临时 client，参数取自 `settings` 的 `s3_endpoint / s3_access_key / s3_secret_key / s3_bucket / s3_region`。
- **bucket 自动创建**：首个 `put_object` 前调 `_ensure_bucket()`，`create_bucket` 失败一律吞掉（`BucketAlreadyOwnedByYou` / 已存在 → 幂等），用 `_bucket_ready` 标志位只执行一次。
- **流式下载**：`get_object_stream` 用 `resp["Body"].iter_chunks(1MB)` 异步产出，按 1MB 分块。
- **head**：从 botocore 响应取 `ContentLength` / `ContentType`，映射成 `ObjectStat`，`ContentType` 缺省兜底 `application/octet-stream`。

## 注意事项

- 该模块是 `2026-07-22-platform-file-center` 变更落地的存储底座；选型依据是同变更的 spike-01（aiobotocore 3.8.0 + aiohttp 3.14.2 + botocore 1.43.46 与现有栈无冲突，put/head/get/delete 链路实测全通）。
- **测试不碰真实 MinIO**：file 测试用 `MockStorage`（内存实现 StorageBackend）经 `dependency_overrides` 注入。新增存储相关测试应走同一注入路径，禁止直连真实 MinIO。
- `key` 由 file 模块负责生成（避免 storage 层假设文件命名/业务语义），storage 层只把它当不透明存储键透传给 S3 API。
- 删除目前由 file 软删流程触发；storage 自身不做"对象级"软删或版本管理，要保留多版本需换支持版本化的后端实现。
- 新增后端（OSS / 其它 S3 兼容）：实现 `StorageBackend` 四方法 + 在 `_build` 注册分支即可，但需同步确认 `aclose` / 流式读语义对齐（尤其 OSS 等非完全 S3 兼容的实现）。
- `get_object_stream` 返回异步生成器，调用方（file 下载/预览）需用 `StreamingResponse` 正确消费，提前关闭会触发生成器清理。
