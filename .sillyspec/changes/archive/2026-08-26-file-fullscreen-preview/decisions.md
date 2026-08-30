# 决策台账（decisions.md）

---
author: qinyi
created_at: 2026-08-26 19:52:00
updated_at: 2026-08-26 19:52:00
---

## D-001@v1: 变更文件图片预览连后端一起做
- type: premise
- status: accepted
- source: user
- question: 变更文件里图片目前完全不能预览（后端仅支持读文本），是否本次连后端二进制端点一起做？
- answer: 用户确认「一起做（推荐）」——后端新增 raw 端点，变更文件树图片可预览+缩放。
- normalized_requirement: 后端必须提供变更文件二进制读取端点，前端变更文件树图片预览经该端点取 Blob。
- impacts: [FR-03, FR-04, design §5 Phase 1/3, task 后端 raw 端点]
- evidence: AskUserQuestion 轮次 1（2026-08-26 对话）；backend/app/modules/change/service.py read_file 仅 UTF-8 文本
- priority: P0
- 锚点: backend/app/modules/change/router.py（新增 files/raw 路由）
- 模块域: backend, frontend

## D-002@v1: 覆盖范围不含 git-log
- type: boundary
- status: accepted
- source: user
- question: 「其他类似的展示功能」覆盖哪些？
- answer: 用户勾选「统一预览弹窗加全屏 + 工作区文件浏览器」，未勾选 git 提交记录文件列表。
- normalized_requirement: git-log 模块零改动；Non-Goals 明确排除。
- impacts: [design §3 Non-Goals]
- evidence: AskUserQuestion 轮次 1 多选题答案
- priority: P1
- 模块域: frontend

## D-003@v1: 方案 A 统一弹窗升级
- type: architecture
- status: accepted
- source: user
- question: 文件全屏预览的实现方案（A 统一弹窗升级 / B 各处局部增强 / C 真全屏+灯箱库）？
- answer: 用户选「方案A：统一弹窗升级」。
- normalized_requirement: 全屏能力实现在 FilePreviewModal 单点，新入口经 FilePreviewTarget 契约接入，零新增 npm 依赖。
- impacts: [FR-01~FR-05, design §5]
- evidence: AskUserQuestion 轮次 2；落选理由见 design §3（B 四套重复 / C 新依赖+兼容坑）
- priority: P0
- 锚点: frontend/src/components/files/file-preview-modal.tsx
- 模块域: frontend

## D-004@v1: CSS 伪全屏而非浏览器 Fullscreen API
- type: architecture
- status: accepted
- source: code
- question: 全屏用什么实现？
- answer: antd Modal 尺寸切换（100vw/100vh）实现伪全屏，参考 agent-log-viewer.tsx L905 fixed inset-0 先例。不用 requestFullscreen()——iframe/弹窗嵌套下兼容坑多且不可控。
- normalized_requirement: 全屏态 = Modal width 100vw + content 100vh + 圆角清零 + body overflow hidden 兜底。
- impacts: [design §5 Phase 2]
- evidence: frontend/src/components/agent-log-viewer.tsx L730/L905-908/L836-842/L1020-1024
- priority: P1
- 模块域: frontend

## D-005@v1: 新增 HtmlPreviewer 渲染器
- type: architecture
- status: accepted
- source: code
- question: 变更目录里的 prototype-*.html 如何全屏预览？现 RENDERER_MAP 无 html 项（落 fallback 引导下载）。
- answer: 新增 html 渲染器：iframe sandbox="allow-scripts allow-popups" + srcDoc（与 change-file-tree 内联 HTML 预览同款安全策略）；registry 增 text/html mime + html/htm 扩展名。
- normalized_requirement: matchRenderer("text/html", *.html/htm) → html 渲染器；sandbox 不设 allow-same-origin。
- impacts: [FR-03b, design §5 Phase 2, §6, R-04]
- evidence: frontend/src/components/change-file-tree.tsx L68-80 同款 iframe；frontend/src/components/files/preview-registry.ts
- priority: P1
- 锚点: frontend/src/components/files/previewers/html-previewer.tsx（新增）
- 模块域: frontend

## D-006@v1: raw 端点 50MB 上限 + inline disposition
- type: boundary
- status: accepted
- source: code
- question: 二进制端点的大小与响应头策略？
- answer: MAX_RAW_BYTES=50MB（变更目录为原型图/文档，远超文本端点 1MB 但无需无限）；Content-Disposition: inline + RFC5987 filename*（前端 XHR 取 blob，disposition 仅供直开兜底）。超限 413。
- normalized_requirement: read_file_raw 超限抛 413；Content-Length=实际字节数；media_type=guess_type 未知回 octet-stream。
- impacts: [design §5 Phase 1, §7.1, R-03]
- evidence: backend/app/modules/change/service.py L55（MAX_CONTENT_BYTES=1MB）；backend/app/modules/explorer/router.py L91-107（RFC5987 同款）
- priority: P1
- 锚点: backend/app/modules/change/router.py（files/raw）
- 模块域: backend

## D-007@v1: explorer/变更文件不接 OnlyOffice
- type: boundary
- status: accepted
- source: code
- question: explorer/变更文件的 office 文件是否走 OnlyOffice 高保真？
- answer: 不接。officeSource 仅支持 session_attachment|file 两类有平台 id 的来源；这两处无 id，不传该字段恒走本地渲染器（docx-preview/SheetJS）。
- normalized_requirement: 新入口构造 FilePreviewTarget 时不携带 officeSource。
- impacts: [design §3, R-05]
- evidence: frontend/src/components/files/file-preview-modal.tsx L45-48（officeSource 类型定义）
- priority: P2
- 模块域: frontend

## D-008@v1: Esc 保持 antd 默认关窗
- type: compatibility
- status: accepted
- source: code
- question: 全屏态按 Esc 是先退全屏还是直接关窗？
- answer: 保持 antd Modal 默认（Esc 直接关窗）。拦截改写需 hack antd 键盘处理链，脆弱且收益小；原型演示的「先退全屏」仅为示意，不作为实现要求。
- normalized_requirement: 不注册任何 keydown 拦截；全屏退出仅靠工具栏按钮。
- impacts: [design §5 Phase 2, §12 自审]
- evidence: antd Modal keyboard 默认行为；原型与实现差异已在 design 自审记录
- priority: P2
- 模块域: frontend

## D-009@v1: 变更文件全屏预览统一走 raw 端点
- type: consistency
- status: accepted
- source: design-grill
- question: 变更文件预览的 fetch 是文本走 content 端点、二进制走 raw，还是统一走 raw？（Grill C-04：content 端点 1MB 截断会让大 HTML 原型全屏静默截断，且 ChangeFileContent 无 truncated 字段）
- answer: 统一走 raw 端点（50MB 额度）：规避截断、单一代码路径、matchRenderer 统一分发（EXT_MAP 对 md 兜底）。编辑仍走 content 端点不变。
- normalized_requirement: change-file-tree 构造 FilePreviewTarget 的 fetch 恒为 fetchChangeFileRaw；不调用 getChangeFileContent 做预览。
- impacts: [FR-03, design §5 Phase 3, §6]
- evidence: Design Grill C-04（brainstorm-review-2026-08-26-195027）；backend/app/modules/change/service.py L340-341 截断逻辑
- priority: P1
- 锚点: frontend/src/components/change-file-tree.tsx
- 模块域: frontend, backend
