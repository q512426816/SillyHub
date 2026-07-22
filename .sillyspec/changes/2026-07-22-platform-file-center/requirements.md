---
author: qinyi
created_at: 2026-07-22T14:07:00
---

# 需求（Requirements）— 平台级文件中心

## 功能需求（FR）

- **FR-1 文件上传**：登录用户通过 multipart 上传文件，后端存 MinIO + 落 File 元数据表，返回文件 ID；支持图片与文档；单文件 ≤ 50MB（可配）；类型白名单（不符 415，超限 413）；记录 `owner_type`/`owner_id`/`uploaded_by`。
- **FR-2 文件下载/预览**：按文件 ID 获取文件流（`StreamingResponse`，`Content-Type` 按 MIME，inline），鉴权；图片可预览、文件可下载。
- **FR-3 文件元数据**：单个（`GET /api/file/{id}/meta`）与批量（`POST /api/file/batch-meta`）按 ID 取文件名/类型/大小，供前端回显。
- **FR-4 文件删除**：`DELETE /api/file/{id}` 软删除（置 `deleted_at`）。
- **FR-5 存储抽象层**：后端 `StorageBackend` 接口（put/get/delete/head），MinIO 为首个实现，按配置切换；未来加 OSS 实现即可扩展。
- **FR-6 前端通用上传组件 FileUpload**：受控（value=fileIds[]/onChange），区分图片/文件（accept），上传进度，单项删除，已上传项回显文件名/类型/大小。
- **FR-7 前端通用预览组件 FileViewer**：只读，图片缩略图网格 + 点击放大（antd Image），非图片类型图标 + 下载链接。
- **FR-8 图片/文件区分**：按 MIME 类型前端判定（图片 image/* 走预览，其余走文件图标+下载）。
- **FR-9 PPM 全场景接入**：约 10 处 `file_urls` 改存文件 ID，编辑/创建场景用 FileUpload、详情/只读场景用 FileViewer。

## 非功能需求（NFR）

- **NFR-1 跨平台兼容**：Windows/Linux/macOS 均可运行（docker-compose + 跨平台命令链）。
- **NFR-2 可扩展性**：切换存储后端（MinIO → OSS 等 S3 兼容）仅改配置，代码零改动（由 StorageBackend 抽象层保障）。
- **NFR-3 安全/鉴权**：沿用现有 JWT 登录体系；上传记录上传人；下载/预览需鉴权。
- **NFR-4 测试**：后端 file 模块 router/service + StorageBackend 单测（mock 注入，不依赖真实 MinIO）；前端 FileUpload/FileViewer 组件测试；migration 链不断裂；覆盖率达标。
- **NFR-5 中文 UI**：组件文案、提示、错误信息均中文。
- **NFR-6 文档**：scan 模块文档（ppm.md / 新增 file 模块卡）同步更新。
