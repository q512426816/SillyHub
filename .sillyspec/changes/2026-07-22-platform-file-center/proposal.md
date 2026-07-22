---
author: qinyi
created_at: 2026-07-22T14:06:00
---

# 提案（Proposal）— 平台级文件中心（MinIO + 通用上传/预览 + PPM 接入）

## 一句话

建立平台级通用文件服务（后端 `/api/file` + 前端通用上传/预览组件），用 MinIO（S3 兼容）存储并做后端存储抽象层，PPM 约 10 处附件场景全部接入真实文件上传与图片/文件回显。

## 动机

项目当前**无文件管理能力**：后端无文件表/对象存储/上传接口/StaticFiles，前端仅一个"粘贴链接"组件 `ppm-file-urls.tsx`、无图片预览。但 PPM 的 task/plan/problem/kanban 已预留 `file_urls` 字段，只存 URL 字符串且约 10 处只有 2 处接入。业务需要上传/查阅附件、区分图片文件、回显——当前缺口大、体验差。本提案建立真正的平台级文件中心，覆盖旧决策 D-010@v1（"不建文件服务"）。

## 方案（A，用户确认）

- 存储：**MinIO（S3 兼容）** + 后端 **StorageBackend 抽象层**（未来切阿里云 OSS 零改代码）。
- 上传链路：**前端 → 后端代理 → MinIO**（鉴权集中、换存储前端无感、符合现有 Excel 导入先例）。
- 归属：**独立 File 元数据表**（owner_type/owner_id/uploaded_by）。
- PPM：**复用 `file_urls` 存文件 ID**（字段与前后端类型不变，改动最小），约 10 处接入。
- 图片：**纯前端按 MIME 预览**（缩略图+点击放大/文件图标+下载），无后端图像处理。

详见 `design.md`。

## 影响

- **后端**：新增 `storage`/`file` 两个模块、`file` 表 migration、config/minio 配置、main 挂载 `/api/file`。
- **前端**：新增 FileUpload/FileViewer 组件、file api 封装、PPM 约 10 处接入、废弃 `ppm-file-urls.tsx`。
- **部署**：docker-compose（生产 + dev）新增 minio 服务。
- **决策**：覆盖 D-010@v1（建立文件服务）。

## 不在范围内（Non-Goals）

- 服务端图片压缩/裁剪/缩略图生成（不引入 Pillow）。
- 预签名直传（方案 B，过度设计）。
- 新建 PPM 附件关联表（方案 C，改动过大）。
- 文件配额/版本/全文检索。
- 按工作区/成员的强权限隔离（本期沿用 JWT 登录可见）。

## 风险

见 `design.md`「风险与回滚」。关键：MinIO 新增服务需生产/开发同步部署；`file_urls` 语义变更旧数据可清空（项目未上线）；aiobotocore 异步客户端生命周期需与 FastAPI 依赖注入对齐。
