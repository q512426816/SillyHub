## FR-lib-change-files-001 统一预览弹窗全屏态
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-003@v1、D-004@v1、D-008@v1
场景正文：
- 场景：默认场景 — Given 用户打开了文件预览弹窗（任一现有入口） 弹窗处于全屏态 弹窗以 `defaultFullscreen: true` 打开 弹窗打开（任意态）；When 点击工具栏「全屏」按钮 点击「退出全屏」按钮 按下 Esc；Then 弹窗撑满视口（width 100vw / height 100vh / 圆角清零），内容区占满可视高度，背景不可滚动 恢复普通态（`min(960px, 94v
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-01
最近确认：e784c9fbd

## FR-lib-change-files-002 图片预览放大缩小
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 弹窗内展示图片（普通态或全屏态） 渲染器收到 `fill=true`（全屏态）；When 点击图片；Then 进入 antd Image 内建预览层，可放大/缩小/旋转/重置，且预览层不被弹窗遮盖 图片/iframe/滚动容器高度撑满容器（替换 `max-h-[560p
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-02
最近确认：e784c9fbd

## FR-lib-change-files-003 变更文件树接入统一预览
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1、D-009@v1
场景正文：
- 场景：默认场景 — Given 变更文件树选中任意文件（文本或非文本） 选中的是图片文件（png/jpg/jpeg/webp/gif/svg/bmp/ico） 选中的是非图片非文本文件（pdf；When 点击工具栏「全屏预览」按钮；Then 以 `defaultFullscreen` 打开统一预览弹窗；fetch 恒走 `fetchChangeFileRaw`（不调用 content 端点，规避 1
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-03
最近确认：e784c9fbd

## FR-lib-change-files-004 后端变更文件二进制读取端点
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 持有 CHANGE_READ 权限的用户；When `GET /api/workspaces/{wid}/changes/{cid}/files/raw?path=<镜像内存在的图片>` path 含 `../`；Then 200，Content-Type=mimetypes.guess_type 结果（未知回 application/octet-stream），Content-D
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-04
最近确认：e784c9fbd

## FR-lib-change-files-005 工作区文件浏览器图片缩放与全屏
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given explorer 选中图片文件 explorer 选中任意文件（含二进制分支的元信息卡）；When 点击头部「全屏预览」按钮；Then 预览区用 antd Image 展示（鉴权 objectURL 数据流不变），点击可放大/缩小/旋转 以 `defaultFullscreen` 打开统一预览弹
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-05
最近确认：e784c9fbd

## FR-lib-change-files-006 HTML 原型全屏预览
变更：2026-08-26-file-fullscreen-preview
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 文件名为 .html/.htm（或 Content-Type text/html）；When 在统一弹窗中预览；Then 渲染为 iframe（sandbox="allow-scripts allow-popups"，不设 allow-same-origin），脚本可运行但隔离父页
全文：.sillyspec/changes/archive/2026-08-26-file-fullscreen-preview/requirements.md#FR-06
最近确认：e784c9fbd
