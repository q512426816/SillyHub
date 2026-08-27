# 决策知识 — frontend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-002@v1 : 采用方案 A 复用现有 SSE 事件通道
状态：implemented
锚点：`backend/app/modules/daemon/run_sync/service.py`
最近确认：04bb45fe
理由：方案 A，复用现有 Redis `agent_session:{id}` 频道，新增 `plan_mode_entered` / `bash_status` / `bash_chunk` 事件类型。

## D-003@v1 : askuser 弹窗支持最小化
状态：implemented
锚点：`frontend/src/components/permissions/ask-user-dialog-card.tsx`
最近确认：04bb45fe
理由：可最小化，最小化后收缩为右下角浮动胶囊，点击可还原，不遮挡会话主内容。

## D-004@v1 : 文件预览走纯前端渲染（注册表架构）
状态：implemented
锚点：`frontend/src/components/files/preview-registry.ts`
最近确认：3b1624fb
理由：统一预览覆盖全部文件入口（附件 chips/文件卡片/文件中心），matchRenderer 按 blob.type > meta.mime > 扩展名分发；后端仅存取文件零渲染职责（2026-08-25-session-attachment-preview D-001/D-002）。

## D-005@v1 : 预览弹窗用 antd Modal
状态：implemented
锚点：`frontend/src/components/files/file-preview-modal.tsx`
最近确认：3b1624fb
理由：FRONTEND_PAGE_STYLE 约定弹窗不用 Drawer；标题栏含元信息+下载，body 按注册表分发（D-004）。

## D-006@v1 : md 预览必须经 MarkdownText 渲染
状态：implemented
锚点：`frontend/src/components/files/previewers/markdown-previewer.tsx`
最近确认：3b1624fb
理由：XSS 防线——markdown 渲染唯一入口 MarkdownText，禁止 raw HTML 直染（D-006@v1）。

## D-007@v1 : PDF 渲染用 pdf.js 画布（iframe+原生查看器不可依赖）
状态：implemented
锚点：`frontend/src/components/files/previewers/pdf-previewer.tsx`
最近确认：3b1624fb
理由：ql-20260827-001——Chrome 原生查看器对内嵌 blob PDF 报"未能加载"、嵌入式 Chromium 无 PDF 组件；pdf.js 逐页画布零插件依赖，worker 静态放 public/，>50 页截断提示下载。

## D-008@v1 : Excel 不做在线渲染（xls/xlsx → fallback 下载引导）
状态：implemented
锚点：`frontend/src/components/files/preview-registry.ts`
最近确认：3b1624fb
理由：ql-20260826-013 用户决策——SheetJS 表格还原度差、OnlyOffice/LibreOffice 管线先后退役（字体/网格排版/页数偏差），Excel 预览弹窗直接给下载引导。

## D-009@v1 : md 附件渲染器统一 useObjectUrl 托管 blob 生命周期
状态：implemented
锚点：`frontend/src/components/files/use-object-url.ts`
最近确认：3b1624fb
理由：鉴权拉 blob → createObjectURL → 卸载/切换自动 revoke 三件套统一 hook，消灭三入口手写拉取泄漏风险（R-04）。
