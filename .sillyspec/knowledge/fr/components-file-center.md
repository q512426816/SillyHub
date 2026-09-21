## FR-components-file-center-001 会话附件可点击预览
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在会话面板查看历史消息，消息带附件（图片或文件） 附件为图片（png/jpeg/webp/gif） 附件拉取失败（已删除/网络错误）；When 点击任一附件 chip 点击 chip 点击 chip；Then 弹出统一预览窗（FilePreviewModal），按格式渲染内容，可下载、可关闭 预览窗内 antd Image 居中展示，可放大/缩放/旋转（原新窗打开路径
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-01
最近确认：1594ae8b7

## FR-components-file-center-002 格式渲染覆盖
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 附件/文件为 PDF 文件为 .docx 文件为 .xlsx 单个 sheet 超过 2000 行 文件为 .md 文件为 pptx 或其他不支持的格式；When 打开预览 打开预览 打开预览 渲染 打开预览 打开预览
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-02
最近确认：1594ae8b7

## FR-components-file-center-003 格式匹配优先级
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话附件 marker 仅含 id/kind/name（无 mime）；When 预览窗解析渲染器；Then 按 blob.type（后端 media_type 透传）> 入口 meta.mime > 扩展名 的优先级匹配
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-03
最近确认：1594ae8b7

## FR-components-file-center-004 agent 文件卡片可预览
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given agent 回复中包含文件卡片（通用形态） 文件卡片为图片形态；When 点击卡片主体（文件名区域） 查看缩略图；Then 弹出统一预览窗；下载按钮独立可点（不触发预览） 维持现有 antd Image 放大交互不变（避免回归）
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-04
最近确认：1594ae8b7

## FR-components-file-center-005 文件中心非图片文件可预览
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 文件中心查看器（FileViewer）列表中存在非图片文件；When 点击其"预览"入口；Then 弹出统一预览窗；既有下载图标保留；图片网格 PreviewGroup 行为不变
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-05
最近确认：1594ae8b7

## FR-components-file-center-006 blob 生命周期统一管理
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 预览窗打开（拉取 blob → objectURL）；When 预览窗关闭或切换文件；Then objectURL 自动 revoke，无泄漏；快速重复开关无竞态（stale 结果丢弃）
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-06
最近确认：1594ae8b7

## FR-components-file-center-007 三主题适配
变更：2026-08-25-session-attachment-preview
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台处于任一主题（blue/ai-native/dark）；When 打开预览窗；Then 弹窗壳/加载态/错误态/fallback 均走主题 token（brand-* 语义阶），无硬编码 hex；
全文：.sillyspec/changes/archive/2026-08-25-session-attachment-preview/requirements.md#FR-07
最近确认：1594ae8b7
