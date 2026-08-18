---
schema_version: 1
doc_type: module-card
module_id: file
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台文件中心（file）

## 定位
平台级「文件中心」。提供通用文件上传 / 流式下载预览 / 单条与批量元数据 / 列表 / 软删 HTTP API（挂载 `/api/file`），文件本体经 storage 抽象层落对象存储（生产 MinIO），元数据落 `file` 表。

负责：通用文件读写生命周期、大小/类型校验、Content-Disposition 安全策略、软删 + 存储对象回收补偿、可见域归属断言。

不负责：业务语义。PPM 等业务域的 `file_urls` 字段只存本表文件 id，业务流转由各业务模块/daemon 回调驱动；file 只提供原子能力与通用归属字段（owner_type/owner_id，典型 `workspace` + ws_id）。

## 契约摘要
- **上传**（multipart，query 传可选 `owner_type`/`owner_id`，新建可空）：
  - 返回精简响应（id + 原名 + mime + size）。
  - 校验阈值来自 Settings（`file_max_size_mb` / `file_allowed_type_set`）集中配置，不符抛 AppError 映射 413/415。
  - stored_key 格式 `YYYY/MM/{uuid}{.ext}`，扩展名经 `_safe_ext` 清洗为小写字母数字且 ≤10 字符（防注入）。
- **下载/预览**：
  - 流式字节流；仅 `image/jpeg|png|gif|webp` 白名单 inline，其余（含 svg/html）强制 attachment（上传白名单已排除可渲染危险类型，双防 XSS）。
  - `Content-Disposition` 用 RFC 5987 `filename*` 承载中文原名、`filename` 给 ASCII 回退。
- **元数据**：单条 + 批量（上限 200，自动跳过已软删行，供前端按 id 回显）。
- **列表**：按 `owner_type` / `owner_id` / `uploaded_by` 过滤、剔除软删、创建时间倒序、limit ≤ 200。
- **软删**：置 `deleted_at` 并回收对象存储本体。
- **可见域**（归属加固）：五类端点（上传外的资源访问）做归属断言——本人上传（uploaded_by）或具备 WORKSPACE_READ/admin 权限放行，其余 404；list 按可见域过滤（非特权用户只见本人上传）。跨用户直接拿 file_id 不再返回内容。所有端点需 JWT 登录。
- **存储解耦**：`FileService` 经 `get_storage_backend` 注入 StorageBackend 抽象，只调 put_object / get_object_stream / delete_object，不感知 MinIO 细节。

## 关键逻辑
```
# 上传（upload_file）
validate_upload(大小/类型) → stored_key=YYYY/MM/{uuid}{.ext}（_safe_ext 清洗）
→ storage.put_object 写对象 → DB 落行 commit
→ commit 失败则 best-effort 补偿删已写对象（失败仅记日志、不掩盖原异常，防孤儿堆积）

# 下载（get_stream + router）
_get_active_for(file_id, user 可见域断言) → (File 元数据, 异步字节流) → StreamingResponse

# 软删（soft_delete）——顺序硬约束
先 commit DB 软删标记 → 再删对象本体
（反序 commit 失败会留下指向已删对象的 active File，下载 404 损坏功能——宁可孤儿不可损坏）
删对象失败仅记日志、仍标软删防重复
```

## 注意事项
- **路由注册顺序**：`GET /list` 必须定义在 `GET /{file_id}` 之前，否则 `/list` 被路径参数捕获（`list` 当 uuid 段解析失败 422）；改 router 勿调换端点顺序。
- `get_stream` 签名含当前用户（可见域判定）；唯一外部调用者 PPM export-excel 已同步，新调用方必须传用户，勿绕过可见域直接取流。
- 历史上存在只置软删未删本体的孤儿对象（需一次性清理脚本回收），新代码不得 reintroduce。
- 本模块未正式上线（非 PPM），允许重置开发/测试数据，改 schema/migration 不要求历史兼容。
- 测试范式：`dependency_overrides` 注入 mock StorageBackend，不起真实 MinIO；断言校验/补偿/软删顺序而非对象存储协议细节。
- owner_type/owner_id 是通用归属字段，语义由写入方（如 daemon 借用方案回调）约定，file 模块不解释业务含义。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
