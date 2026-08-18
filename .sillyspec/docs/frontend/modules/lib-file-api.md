---
schema_version: 1
doc_type: module-card
module_id: lib-file-api
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 文件中心 API 封装（lib-file-api）

## 定位
平台级文件中心的前端 API 封装（`frontend/src/lib/file/api.ts`，从 file-upload/file-viewer/file-image 组件的内联调用抽出）。覆盖上传（XHR 带进度）、元数据批量查询、按归属列文件、鉴权下载/预览四类能力；解决两个浏览器原生限制：fetch 无上传进度回调、`<img src>`/`<a href>` 不带 Authorization。消费方：components-file-center 三组件与 `agent/borrowed-solution-files-panel`（借用方案文件列表）。

## 契约摘要
- `uploadFile(file, options?): Promise<FileUploadResp>` — multipart 上传。options：`owner_type` / `owner_id`（归属）、`onProgress(percent)`、`xhrFactory`（测试注入）。成功接受 201/200。
- `fetchFileMetaBatch(ids): Promise<FileMetaResp[]>` — POST `/api/file/batch-meta`，空数组直接返回 `[]`；走 apiFetch（自带 401 refresh）。
- `listFiles(params): Promise<FileMetaResp[]>` — GET `/api/file/list`，params：`owner_type` / `owner_id` / `uploaded_by` / `limit`。借用方案用 `owner_type="workspace"&owner_id=<ws_id>` 列该工作空间 daemon 产出的方案文件。
- `getFileDownloadUrl(id): string` — 返回相对路径 `/api/file/{id}`（走 Next.js rewrite proxy，任意 origin 可达）。
- `fetchFileBlob(id): Promise<Blob>` — 带 Authorization 取二进制；图片预览转 objectURL、文件下载用。
- `downloadFile(id, filename)` — Blob → `<a download>` click → revokeObjectURL。
- 类型：`FileUploadResp`（id/original_name/mime_type/size）、`FileMetaResp`（多 owner_type/owner_id）。

## 关键逻辑
```
uploadFile:  XHR POST /api/file/upload?owner_type&owner_id（相对路径走 rewrite proxy）
             401 → ensureFreshAccessToken() 单飞刷新 → 重试一次；再 401 抛「登录已过期」
             其它非 2xx → parseError(body) 归一 ApiError（code 兜底 "upload_failed"）
fetchFileBlob: 原生 fetch 带 Bearer；401 → 刷新重试一次；非 ok 抛 ApiError("download_failed")
```

## 注意事项
- 上传走 **XHR 而非 fetch**：上传进度（onProgress）只有 XHR 有；错误体需手工 JSON.parse 归一成 ApiError，不能享受 apiFetch 的解析。
- 一律用**相对路径**（`/api/file/...`）走 Next.js rewrite proxy——绝对内网 IP 公网浏览器不可达。
- 下载端点要 JWT：不要把 `getFileDownloadUrl` 的 URL 直接塞 `<img>`/`<a>`（不带 Authorization 会 401），必须经 `fetchFileBlob`。
- 401 刷新语义对齐 apiFetch（`ensureFreshAccessToken` 模块级 inflight 保证并发 401 只发一次刷新）。
- `xhrFactory` 是测试 seam：单测注入伪 XHR 模拟进度/401 重试，勿在业务路径使用。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
