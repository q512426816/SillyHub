---
schema_version: 1
doc_type: module-card
module_id: file
---

# file

## 定位
平台级基础设施域的「文件中心」。提供通用的文件上传 / 下载预览 / 元数据 / 批量元数据 / 软删 HTTP API（挂载于 `/api/file`），文件本体经 storage 抽象层落到对象存储（生产为 MinIO），元数据落到 `file` 表。

负责：通用文件读写生命周期、大小/类型校验、流式下载、Content-Disposition 安全策略、软删 + 存储对象回收补偿。

不负责：业务语义。PPM 等业务域的 `file_urls` 字段只存本表文件 id（D-006 决策），具体业务流转（如借用方案落库）由各业务模块/daemon 回调驱动，file 模块仅提供原子能力与通用归属字段（`owner_type` / `owner_id`）。

## 契约摘要
对外暴露五类能力（具体路由/符号以 `_module-map.yaml` 为准）：
- 上传：multipart 上传，query 传可选 `owner_type` / `owner_id`（新建时可为空，D-008），返回精简响应（id + 原名 + mime + size）。
- 下载/预览：流式返回字节流，按 mime 决定 `inline`（图片白名单）还是 `attachment`（D-009 安全契约）。
- 单条 / 批量元数据：批量上限 200 条，自动跳过已软删行，供前端按 id 回显。
- 列表：按 `owner_type` / `owner_id` / `uploaded_by` 过滤，剔除软删，按创建时间倒序，`limit` ≤ 200。
- 软删：置 `deleted_at`，并同步回收对象存储本体。

所有端点需 JWT 登录（`get_current_user`）；大小/类型不符在 service 抛 `AppError`，由全局异常处理器映射为 413 / 415。

**可见域**（security-audit-remediation 归属加固）：五端点（上传/下载/单条与批量元数据/软删）对资源做归属断言——本人上传（`uploaded_by`）或具备 `WORKSPACE_READ`/admin 权限放行，其余一律 404；list 端点按可见域过滤（非特权用户只见本人上传）。跨用户直接拿 file_id 访问不再返回内容。

## 关键逻辑
- **存储解耦**：`FileService` 经 `Depends(get_storage_backend)` 注入 `StorageBackend` 抽象（生产 `MinioBackend`，测试用 `dependency_overrides` 换 mock，不依赖真实 MinIO，NFR-4）。file 模块只调抽象层的 `put_object` / `get_object_stream` / `delete_object`，不感知 MinIO 细节。
- **上传流转**（`upload_file`）：校验大小/类型 → 生成 `stored_key`（格式 `YYYY/MM/{uuid}{.ext}`，扩展名经 `_safe_ext` 清洗为小写字母数字且 ≤10 字符防注入）→ `storage.put_object` 写对象 → 落 `File` 表 commit。若 commit 失败，best-effort 补偿删除已写对象（失败仅记日志、不掩盖原异常），避免孤儿对象堆积（第五批 code-quality 修复）。
- **下载流转**（`get_stream` + router）：取活跃 File → 返回 `(File 元数据, 异步字节流)`，router 用 `StreamingResponse` 流式吐出；`Content-Disposition` 用 RFC 5987 的 `filename*` 承载中文原名、`filename` 给 ASCII 回退。只有 `image/jpeg|png|gif|webp` 白名单才 `inline`，其余（含 svg/html）强制 `attachment`，配合上传白名单排除 `text/html`、`image/svg+xml` 等可渲染危险类型，防 XSS。
- **校验来源**：阈值与允许类型来自 `Settings.file_max_size_mb` 与 `file_allowed_type_set`，集中配置、不在代码硬编码。
- **软删回收**（`soft_delete`）：先 commit DB 软删标记，再删对象本体（顺序硬约束——反序 commit 失败会留下指向已删对象的 active File，下载 404 损坏功能，故宁可孤儿不可损坏）。删对象失败仅记日志、仍标软删防重复。
- **归属字段语义**：`owner_type` / `owner_id` 为通用归属，典型场景 `owner_type="workspace"` + `owner_id=<ws_id>`，由 daemon 借用方案回调落库（design §5 Phase 5 / D-009@v1），前端据此列方案文件。

## 注意事项
- **路由注册顺序**：`GET /list` 必须定义在 `GET /{file_id}` 之前，否则 `/list` 会被 `/{file_id}` 捕获（`list` 当路径段，uuid 解析失败 → 422）。改 router 时勿随意调整端点顺序。
- **软删历史孤儿**：第五批 code-quality 之前软删只置 `deleted_at`、对象本体未删，历史已软删未删的对象需一次性清理脚本回收（账单泄漏）。
- **本模块未正式上线**（非 PPM），允许重置开发/测试数据，不要求历史兼容；改 schema/migration 无需保数据。
- **测试范式**：单测注入 mock `StorageBackend`，不要起真实 MinIO；断言校验/补偿/软删顺序而非具体对象存储协议。
- **归属断言**（security-audit-remediation）：`get_stream` 签名连带变更——唯一外部调用者 PPM `export-excel` 已同步；下游新调用方须传当前用户做归属判定，勿绕过可见域直接取流。
- **设计依据**：详见 `.sillyspec/changes/2026-07-22-platform-file-center/design.md`（D-003 校验位置 / D-006 PPM file_urls 值语义 / D-008 owner 可空 / D-009 预览安全契约）。
