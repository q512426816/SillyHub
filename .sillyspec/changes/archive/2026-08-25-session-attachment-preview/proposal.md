---
author: WhaleFall
created_at: 2026-08-25 10:35:00
---
# 提案书（Proposal）— 会话附件与文件统一在线预览

## 动机

用户在智能体会话中上传文件发给智能体解析后，无法回看文件内容——非图片附件是完全的死标签。
本提案为平台三个文件入口（会话附件、agent 文件卡片、文件中心）提供统一的在线预览能力，
支持图片 / PDF / Word / Excel / Markdown，纯前端渲染、后端零改动。

## 关键问题

1. **会话附件不可回看**（用户直接痛点）：`attachment-chips.tsx` 中非图片 chip 是只读标签，
   不可点击、无下载；图片仅能新窗打开，无缩放/查看体验；
2. **三入口能力割裂**：agent 文件卡片仅有下载；文件中心非图片仅下载链接；均无在线查看，
   用户想确认"我发/收的到底是什么文件"只能下载到本地；
3. **前端无 Office 渲染能力**：package.json 无任何 docx/xlsx/pdf 渲染依赖。

## 变更范围

- 新建 `frontend/src/components/files/`：统一预览弹窗（FilePreviewModal）+ 格式注册表
  （preview-registry）+ blob 生命周期 hook（use-object-url）+ 六个格式渲染器；
- 三个既有组件接入：attachment-chips.tsx（会话附件 chips 可点击）、file-message-card.tsx
  （agent 文件卡片可预览）、file-viewer.tsx（文件中心非图片项可预览）；
- `lib/api/session-attachments.ts` 补 `fetchAttachmentBlob` 导出（对齐 401 刷新语义）；
- 新依赖：docx-preview（npm）、xlsx（SheetJS 官方源 0.20.3 tarball，规避 npm 漏洞版本）。

## 不在范围内（显式清单）

- 不做 pptx 在线渲染（前端库保真度不足，fallback 下载引导）
- 不做旧格式 Office（.doc/.xls/.ppt）渲染（允许上传，预览走 fallback）
- 不做后端 Office→PDF 转换 / LibreOffice / Docker 镜像变更
- 不做协作编辑（预览只读）
- 不改任何后端 API / 表结构 / OpenAPI（纯前端变更）
- 不做移动端 m/ 适配
- 不合并 explorer/file-preview.tsx（数据源与容器不同，见 design §4）

## 成功标准（可验证）

- 会话中用户发送的任意附件（图片/docx/xlsx/md/pdf/pptx）点击均弹出预览窗：前五类正常渲染，
  pptx 显示下载引导；
- agent 文件卡片、文件中心非图片项同样可预览，三入口体验一致；
- md 预览经 MarkdownText（rehype-sanitize）渲染，无 XSS 路径（D-006）；
- 不点击预览时所有既有行为（下载、图片放大）不变；
- `pnpm typecheck` / `pnpm test` / `pnpm lint` 全绿；三主题（blue/ai-native/dark）下预览窗正常。
