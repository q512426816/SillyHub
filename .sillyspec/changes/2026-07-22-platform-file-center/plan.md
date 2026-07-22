---
author: qinyi
created_at: 2026-07-22T14:30:00
plan_level: full
---

# 实现计划（Plan）— 平台级文件中心

## Spike 前置验证

| Spike | 验证内容 | 通过标准 | 不通过后果 |
|---|---|---|---|
| spike-01 | aiobotocore + MinIO + FastAPI 异步上传/下载最小链路；aiobotocore 与现有 httpx/aiohttp 栈版本对齐 | 本地起 minio，`put_object` / `get_object_stream` 跑通，无依赖冲突，app-lifespan 单例可用 | task-02 改用 `minio-py` + `run_in_executor`，或锁定兼容版本 |

> 仅 aiobotocore 异步集成有技术不确定性，其余方案已确定，无需更多 Spike。

## Wave 1（存储基础设施，无依赖）

- [ ] task-01: docker-compose 新增 minio 服务（生产 + dev，命名卷持久化，9000 API/9001 控制台，root 账号 env）（覆盖：D-001）
- [ ] task-02: backend storage 配置（config + .env）+ aiobotocore 依赖 + StorageBackend 抽象层（base/minio/factory，app-lifespan 单例 + Depends 注入）（覆盖：D-001, D-002）

## Wave 2（后端文件服务，依赖 Wave 1）

- [ ] task-03: File 元数据模型 + alembic migration 建 `file` 表（覆盖：D-004, D-008）
- [ ] task-04: file schema + service（上传存 MinIO+落库 / 下载流 / batch-meta / 软删）（覆盖：FR-1~4, D-003）
- [ ] task-05: file router（POST /upload、GET /{id}、GET /{id}/meta、POST /batch-meta、DELETE /{id}；大小/类型校验 413/415；JWT 鉴权；D-009 Content-Disposition 安全契约）+ main.py 挂载 /api/file（覆盖：FR-1~4, D-009）
- [ ] task-06: 后端测试（router/service + StorageBackend mock 注入 dependency_overrides；校验 413/415；软删除）（覆盖：NFR-4）

## Wave 3（前端组件，依赖 Wave 2 API）

- [ ] task-07: `lib/file/api.ts`（uploadFile 走 XHR customRequest + 401 refresh 重试 / fetchFileMetaBatch / getFileDownloadUrl）（覆盖：FR-1, FR-3）
- [ ] task-08: FileUpload 组件（antd Upload.customRequest + onProgress 进度 + 已上传回显 batch-meta + 单项删除；编辑传 owner_type+owner_id、新建仅 owner_type）（覆盖：FR-6, FR-8）
- [ ] task-09: FileViewer 组件（图片缩略图 + antd Image 放大、非图片图标 + 下载，MIME 判定）（覆盖：FR-7, FR-8, D-005）
- [ ] task-10: 前端组件测试（mock api；antd 动态组件 jsdom 处理）（覆盖：NFR-4）

## Wave 4（PPM 接入，依赖 Wave 3 组件，任务间可并行）

- [ ] task-11: 问题附件接入（`problem-list/_forms.tsx` FileUpload + `problem-detail-modal.tsx` FileViewer）（覆盖：FR-9, D-006）
- [ ] task-12: 任务附件接入（`task-plans/page.tsx` FileUpload + `task-detail-modal.tsx` FileViewer + 跨天填报可挂附件）（覆盖：FR-9）
- [ ] task-13: 任务执行附件接入（`task-execute/page.tsx` attach_group_id / check_attach_group_id）（覆盖：FR-9）
- [ ] task-14: 看板附件接入（`kanban-create-task-dialog` / `kanban-edit-task-dialog` / `kanban-task-detail-drawer` 三处）（覆盖：FR-9）
- [ ] task-15: 里程碑/项目计划附件接入 + 废弃 ppm-file-urls.tsx + 同步 scan 文档（ppm.md + file 模块卡）（覆盖：FR-9, NFR-6）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | docker-compose minio | W1 | P0 | spike-01 | D-001 |
| task-02 | storage 配置+抽象层 | W1 | P0 | spike-01 | D-001, D-002 |
| task-03 | File 模型+migration | W2 | P0 | task-02 | D-004, D-008 |
| task-04 | file schema+service | W2 | P0 | task-02, task-03 | FR-1~4, D-003 |
| task-05 | file router+挂载 | W2 | P0 | task-04 | FR-1~4, D-009 |
| task-06 | 后端测试 | W2 | P0 | task-05 | NFR-4 |
| task-07 | lib/file/api | W3 | P0 | task-05 | FR-1, FR-3 |
| task-08 | FileUpload 组件 | W3 | P0 | task-07 | FR-6, FR-8 |
| task-09 | FileViewer 组件 | W3 | P0 | task-07 | FR-7, FR-8, D-005 |
| task-10 | 前端组件测试 | W3 | P1 | task-08, task-09 | NFR-4 |
| task-11 | 问题附件接入 | W4 | P0 | task-08, task-09 | FR-9, D-006 |
| task-12 | 任务附件接入 | W4 | P0 | task-08, task-09 | FR-9 |
| task-13 | 任务执行附件接入 | W4 | P0 | task-08, task-09 | FR-9 |
| task-14 | 看板附件接入 | W4 | P0 | task-08, task-09 | FR-9 |
| task-15 | 里程碑+废弃+文档 | W4 | P1 | task-11~14 | FR-9, NFR-6 |

## 关键路径

spike-01 → task-02 → task-03 → task-04 → task-05 → task-07 → task-08 → task-11（最长路径，Wave1→2→3→4 顺序，决定最短交付周期）

## 全局验收标准

- [ ] docker-compose minio 服务健康（生产 + dev）
- [ ] 后端 file 模块单测全绿（mock StorageBackend，不依赖真实 MinIO）
- [ ] migration 链不断裂（`alembic heads` 单一）
- [ ] `POST /api/file/upload` 返回 file_id，大小超限 413 / 类型不符 415 生效
- [ ] `GET /api/file/{id}` 图片白名单 inline、非图片（含 svg/html）强制 attachment（D-009）
- [ ] 前端 FileUpload/FileViewer 组件测试通过
- [ ] PPM 各处附件可上传/预览/删除（问题/任务/执行/看板/里程碑）
- [ ] `file_urls` 存文件 ID（非 URL）
- [ ] 中文 UI、跨平台命令链（Win/Linux/macOS）
- [ ] scan 文档（ppm.md + 新增 file 模块卡）同步

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 MinIO 存储 | task-01, task-02 | minio 服务 + 配置 |
| D-002 StorageBackend 抽象 | task-02 | base/minio/factory + Depends 注入 |
| D-003 后端代理上传 | task-04, task-05 | /api/file/upload 链路 |
| D-004 独立 File 表 | task-03 | file 表 + owner 多态 |
| D-005 前端 MIME 预览 | task-09 | FileViewer 图片/文件区分 |
| D-006 file_urls 存文件 ID | task-11~15 | PPM 各处接入 |
| D-007 单 change + 波次 | 全 plan | 4 波次组织 |
| D-008 owner 归属 | task-03, task-04 | owner_type/owner_id + uploaded_by |
| D-009 预览安全契约 | task-05 | Content-Disposition + 类型白名单 |
| 覆盖 D-010@v1 | 全变更 | 建立平台文件服务（推翻"不建文件服务"） |
