---
schema_version: 1
doc_type: module-card
module_id: components-file-center
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 文件中心通用组件（components-file-center）

## 定位
平台级文件中心通用组件三件（根级 `file-upload.tsx` / `file-viewer.tsx` / `file-image.tsx`）：
编辑态受控上传、只读态预览下载、带鉴权图片渲染。MIME 判定在前端（D-005）；API 调用已
全部抽到 lib/file/api.ts（lib-file-api 模块）——本模块组件不内联请求，只组合调用。
被 workspace 详情页、PPM（problem 附件等）与借用方案展示（components-agent）复用。

## 契约摘要
- `FileUpload`（`file-upload.tsx`）：编辑态受控上传。
  - 受控：`value: string[]（文件 id 列表）/ onChange(next: string[])`。
  - 上传：antd `Upload.customRequest` 调 `uploadFile`（XHR，带进度 + 401 自动刷新重试）。
  - 回显：已上传项经 `fetchFileMetaBatch` 取元数据——图片显缩略图（FileImage）、
    文件显类型图标 + 大小，每项可删。
  - props：`accept: "image" | "file" | "all"`（默认 all；image → input accept=image/*）、
    `owner_type` / `owner_id`（上传透传；编辑场景传、新建留空 D-008）、`disabled`。
- `FileViewer`（`file-viewer.tsx`）：只读预览。
  - `fileIds?: string[]` → `fetchFileMetaBatch` 取元数据 → 图片显缩略图网格 +
    antd `Image.PreviewGroup` 点击放大；非图片显类型图标 + 文件名 + 下载链接。
  - 空列表「暂无附件」；请求失败静默降级（catch 后按空态处理），不抛错给页面。
- `FileImage`（`file-image.tsx`）：带鉴权图片渲染。
  - `fetchFileBlob`（带 token）取 Blob → `URL.createObjectURL` → 渲染。
  - `preview=false`（默认）：普通 `<img>`（缩略图不放大）；`preview=true`：antd
    `<Image>` 可放大，放 `Image.PreviewGroup` 内自动入组；`previewMask` 遮罩文案可选。
  - 卸载或 id 变化时 `revokeObjectURL` 防内存泄露；失败态有兜底。
- 辅助依赖（lib/file/utils）：`FileTypeIcon` / `formatFileSize` / `isImageMime`。

## 关键逻辑
- 图片鉴权链（原生 img 不带 Authorization，直用 URL 会 401）：
  ```
  fetchFileBlob(id) → URL.createObjectURL(blob) → <img src={url}>
  cleanup: revokeObjectURL(url)          // unmount / id 变化时
  ```

## 注意事项
- `file_urls` 字段类型是 string[] 但值语义为文件 id（D-006）——对接后端表单字段时
  勿把 id 当 URL 拼接。
- FileImage 的 createObjectURL/revokeObjectURL 必须成对，改组件保住 cleanup 分支
  否则内存泄露。
- MIME 判定是前端职责（D-005），`isImageMime` 是唯一判据，勿在各组件散写后缀判断。
- 新建场景 owner_id 留空（后端落库时再关联，D-008）；元数据回显失败不应阻塞表单。
- 上传 401 依赖 apiFetch 的自动刷新重试链路，勿在组件内自行处理 token。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
