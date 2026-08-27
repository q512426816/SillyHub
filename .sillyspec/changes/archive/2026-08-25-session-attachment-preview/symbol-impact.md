# 符号影响面报告

> tasks.md 内容指纹（生成时）: e6b4ba08a38550b3——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。

- task-01: 新增依赖（docx-preview/xlsx 官方源 tarball），无函数/类型签名级变更
- task-02: 新增 useObjectUrl hook（新符号），无既有调用点被影响；新增文件只在 task-08 消费（已列入 expects_from）
- task-03: 新增 matchRenderer 纯函数与 RendererKey 类型（新符号），无既有调用点被影响
- task-04: 修改 lib/api/session-attachments.ts 新增 fetchAttachmentBlob 导出（新增符号，不改既有 fetchAttachmentObjectUrl 签名）；既有调用点 attachment-chips.tsx:21 不受影响（该组件属 task-09 范围）
- task-05: 新增 image/pdf/fallback 三渲染器组件（新符号），无既有调用点被影响；新增文件只在 task-08 消费
- task-06: 新增 docx/xlsx 两渲染器组件（新符号），无既有调用点被影响；新增文件只在 task-08 消费
- task-07: 新增 markdown-previewer 组件（新符号），无既有调用点被影响；新增文件只在 task-08 消费
- task-08: 新增 FilePreviewModal、FilePreviewTarget（新符号），无既有调用点被影响；新组件只在 task-09/10 消费（已列入 expects_from）
- task-09: 修改 attachment-chips.tsx（改组件内部行为，props 签名不变：仍只收 attachments: ParsedAttachmentMarker[]）；既有调用点 turn-timeline.tsx:360 不受影响（props 未变）
- task-10: 修改 file-message-card.tsx 与 file-viewer.tsx（均只加 onClick/预览入口，props 签名不变：FileMessageCardProps 与 FileViewerProps 均不变）；既有调用点 run-file-artifacts.tsx:104 与 ppm 页（kanban-task-detail-drawer.tsx:312、problem-detail-modal.tsx:316/359）均不受影响（props 未变）
- task-11: 回归核查卡，无新符号，无签名级变更
