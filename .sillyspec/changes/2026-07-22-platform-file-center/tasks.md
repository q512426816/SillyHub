---
author: qinyi
created_at: 2026-07-22T14:08:00
---

# 任务清单（Tasks）— 平台级文件中心

> 粗粒度任务，`plan` 阶段细拆到 `tasks/task-NN.md` 并排依赖/波次。

## Wave 1 — 存储基础设施（MinIO + 抽象层）

- **task-01** docker-compose 新增 minio 服务（生产 `deploy/docker-compose.yml` + 开发 `deploy/docker-compose.dev.yml`，命名卷持久化，9000/9001 端口，root 账号密码 env）
- **task-02** backend 加 `aiobotocore` 依赖（`pyproject.toml`）
- **task-03** backend config 加 storage 配置项（`core/config.py`：storage_backend/s3_endpoint/s3_access_key/s3_secret_key/s3_bucket/s3_region/file_max_size_mb/file_allowed_types）+ `.env.example` 同步

## Wave 2 — 后端文件服务（`app/modules/file/` + storage 抽象）

- **task-04** storage 抽象层（`modules/storage/`：`base.py` StorageBackend ABC + `minio_backend.py` MinioStorage + `factory.py` 按配置选实现）
- **task-05** File 元数据模型（`modules/file/model.py`：File 表）+ alembic migration 建 `file` 表
- **task-06** file schema（FileUploadResp / FileMetaResp / BatchMetaReq）
- **task-07** file service（上传存 MinIO+落库 / 下载流 / 元数据查询 / 软删除）
- **task-08** file router（`POST /upload`、`GET /{id}`、`GET /{id}/meta`、`POST /batch-meta`、`DELETE /{id}`；大小/类型校验 413/415；JWT 鉴权）+ `main.py` 挂载 `/api/file`
- **task-09** 后端测试（router/service + StorageBackend mock 注入；校验 413/415；软删除）

## Wave 3 — 前端通用组件

- **task-10** `lib/file/api.ts`（uploadFile / fetchFileMetaBatch / getFileDownloadUrl，带 401 refresh apiFetch）
- **task-11** `components/file-upload.tsx`（FileUpload 受控组件，antd Upload.customRequest，accept 区分图片/文件，进度/删除/回显）
- **task-12** `components/file-viewer.tsx`（FileViewer 只读，图片缩略图+antd Image 放大、文件图标+下载）
- **task-13** 前端组件测试（mock api；antd 动态组件 jsdom 处理）

## Wave 4 — PPM 全场景接入（约 10 处）

- **task-14** `ppm/problem-list/_forms.tsx`（PpmFileUrls → FileUpload）
- **task-15** `ppm/_components/problem-detail-modal.tsx`（加 FileViewer）
- **task-16** `ppm/task-plans/page.tsx`（创建/编辑加 FileUpload）
- **task-17** `ppm/_components/task-detail-modal.tsx`（详情 FileViewer + 跨天填报可挂附件）
- **task-18** `ppm/task-execute/page.tsx`（attach_group_id / check_attach_group_id 接 FileUpload/FileViewer）
- **task-19** `ppm/kanban/_components/kanban-create-task-dialog.tsx`（FileUpload）
- **task-20** `ppm/kanban/_components/kanban-edit-task-dialog.tsx`（FileUpload，表单暴露 file_urls）
- **task-21** `ppm/kanban/_components/kanban-task-detail-drawer.tsx`（PpmFileUrls 只读 → FileViewer）
- **task-22** `ppm/milestone-details/page.tsx` + `ppm/project-plans/page.tsx`（PsPlanNodeDetail 附件）

## 收尾

- **task-23** 废弃/删除 `components/ppm-file-urls.tsx`（确认无引用后）
- **task-24** 同步 scan 文档（ppm.md 加附件接入说明；新增 file 模块卡）
