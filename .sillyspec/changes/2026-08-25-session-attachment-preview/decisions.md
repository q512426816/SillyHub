---
author: WhaleFall
created_at: 2026-08-25 10:20:00
---

# 决策记录（Decisions）— 会话附件与文件统一在线预览

> 本变更有实现/验收影响的决策台账。用户已逐条确认（2026-08-25 对话）。

## D-001@v1: 纯前端渲染技术路线
- type: architecture
- status: accepted
- source: user
- question: Office 文档（Word/Excel/PPT）在线预览采用纯前端渲染还是后端 LibreOffice 转 PDF？
- answer: 用户选「纯前端渲染」：docx/xlsx 用浏览器端 JS 库渲染；pptx 前端库保真度差，改为提示下载。不加后端转换服务、不加部署负担。
- normalized_requirement: 不引入 LibreOffice/后端转换；docx 用 docx-preview、xlsx 用 SheetJS 前端渲染；pptx 走 fallback 下载引导；Docker 镜像与后端代码零改动。
- impacts: [design §2/§3/§5 Phase3, R-01, R-06]
- evidence: 用户在 AskUserQuestion「预览技术」选择「纯前端渲染（推荐）」（2026-08-25）
- priority: P0

## D-002@v1: 统一预览组件覆盖全部文件入口（注册表架构）
- type: architecture
- status: accepted
- source: user
- question: 在线查看只覆盖用户会话附件，还是三入口（会话附件/agent 文件卡片/文件中心）统一？
- answer: 用户选「全部文件入口」+ 方案 B 注册表架构：FilePreviewModal 壳 + preview-registry 分发 + useObjectUrl 生命周期 hook + previewers/ 按格式拆渲染器，三入口接同一组件。
- normalized_requirement: 新建 frontend/src/components/files/ 目录（modal/registry/hook/六渲染器）；attachment-chips.tsx、file-message-card.tsx、file-viewer.tsx 三处接入同一 FilePreviewModal；扩展新格式只加 renderer 文件 + registry 一行。
- impacts: [design §5 Phase1/2, §6 文件清单]
- evidence: 用户在 AskUserQuestion「覆盖范围」选「全部文件入口（推荐）」、「实现方案」选「B 注册表架构（推荐）」（2026-08-25）
- priority: P0

## D-003@v1: PDF 纳入预览范围
- type: boundary
- status: accepted
- source: user
- question: 除图片/Office/Markdown 外是否支持 PDF 在线预览？
- answer: 支持。iframe + objectURL 内嵌浏览器原生 PDF 视图器，零新依赖。
- normalized_requirement: application/pdf → iframe 渲染器；无 PDF 相关 npm 依赖。
- impacts: [design §5 Phase3, R-05]
- evidence: 用户在 AskUserQuestion「PDF 支持」选「支持（推荐）」（2026-08-25）
- priority: P1

## D-004@v1: 交互形态用 antd Modal
- type: architecture
- status: accepted
- source: docs
- question: 预览容器形态 Modal 还是 Drawer？
- answer: Modal。依据 FRONTEND_PAGE_STYLE.md §6/§12：弹窗一律 antd Modal（不用 Drawer），删除确认/表单弹窗同规范；预览属内容弹窗同规则适用。
- normalized_requirement: FilePreviewModal 基于 antd Modal 实现；标题栏含文件元信息 + 下载 + 关闭；内容区滚动、弹窗尺寸 min(960px, 94vw)。
- impacts: [design §6 file-preview-modal 行]
- evidence: .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md L172-194/L331（用户对 AI 建议（P2 低风险）无异议）
- priority: P2

## D-005@v1: SheetJS 固定官方源 tarball
- type: risk
- status: accepted
- source: code
- question: npm 上 xlsx 包 0.18.5 存在已知漏洞（CVE-2023-30533 ReDoS / CVE-2024-22363 原型污染），官方修复版仅发布在 cdn.sheetjs.com，装哪个版本？
- answer: package.json 固定 `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`（精确 tarball，不走 semver）；execute 阶段实测本机 install 与 Docker build 可复现性，失败按 R-02 三级退路（vendor 进仓 / 代理 / 换 exceljs）。
- normalized_requirement: 不安装 npm xlsx@0.18.5；lockfile 提交；Docker/CI 构建链可达性风险如实登记（design R-02），不声称"已解决"；execute 验收含安装可复现检查。
- impacts: [design §6 依赖行, R-02]
- evidence: SheetJS 官方安全公告（npm 版停留 0.18.5，新版仅官方 CDN）；Design Grill F-3 修正缓解描述；frontend/Dockerfile 全量走 npmmirror 的现状
- priority: P1

## D-006@v1: md 预览必须经 MarkdownText 渲染（XSS 防线）
- type: risk
- status: accepted
- source: design-grill
- question: 用户上传的 .md 文件预览渲染，能否直接用 @uiw/react-markdown-preview？
- answer: 不可以裸用。@uiw 默认启用 rehype-raw 直出内嵌 HTML，渲染不可信上传内容构成存储型 XSS；必须复用 `frontend/src/components/ui/markdown-text.tsx`（自带 rehype-sanitize + MARKDOWN_SANITIZE_SCHEMA + ssr:false），与仓库既有防线一致。
- normalized_requirement: markdown-previewer.tsx 只能经 MarkdownText 渲染 md 文件内容；verify 阶段验收项：确认 renderer 未直接 import @uiw/react-markdown-preview。
- impacts: [design §5 Phase3, §6 markdown-previewer 行, R-08(P0)]
- evidence: Design Grill F-1（fail 必修项）；ui/markdown-text.tsx 头注释记载该防线结论；explorer/file-preview.tsx 同做法先例
- priority: P0
