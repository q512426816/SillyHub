---
id: task-08
title: 'file-preview-modal-shell'
title_zh: 'FilePreviewModal 弹窗壳（标题栏/下载/loading/error + registry 分发）+ 单测'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-02, task-03, task-05, task-06, task-07]
blocks: [task-09, task-10, task-11]
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/files/file-preview-modal.tsx
  - frontend/src/components/files/index.ts
  - frontend/src/components/files/previewers/index.ts
  - frontend/src/components/files/__tests__/file-preview-modal.test.tsx
goal: >
  新建统一预览弹窗壳 FilePreviewModal（antd Modal），标题栏展示文件信息并提供下载与关闭，
  body 经 useObjectUrl 拉取 blob 后按 matchRenderer 静态分发六渲染器，内置 loading 与 error 重试态，
  为三入口提供统一预览容器并落地 files 目录导出（FR-01 / D-004@v1）。
expects_from:
  task-02: [{contract: useObjectUrl, needs: [blob, url, status, retry]}]
  task-03: [{contract: matchRenderer, needs: [RendererKey]}]
  task-05: [{contract: PreviewerProps, needs: [blob, url, meta]}]
  task-06: [{contract: PreviewerProps, needs: [blob, url, meta]}]
  task-07: [{contract: PreviewerProps, needs: [blob, url, meta]}]
provides: [{contract: FilePreviewModal, fields: [target, open, onClose]}]
implementation:
  - 按 design §7 定义并导出 FilePreviewTarget 与 FilePreviewModal（props 为 target、open、onClose）
  - 容器用 antd Modal 不用 Drawer（D-004@v1），宽度 min(960px, 94vw)，遮罩与 ESC 关闭触发 onClose
  - 标题栏 FileTypeIcon + 文件名截断 + formatFileSize 大小与 MIME 元信息 + 下载按钮 + 关闭按钮（对齐 prototype 的 modal-head）
  - 下载优先走 target.download 回调，无回调时用 objectURL 的 a[download] 以 meta.name 保存
  - body 内 useObjectUrl(target 的 fetch) 拉取 blob，loading 显 Spin，error 显失效文案并提供重试（R-07）
  - ok 后以 matchRenderer(blob.type ?? meta.mime, meta.name) 取 RendererKey，静态 import 六渲染器分发统一 PreviewerProps
  - 一并落地 files/index.ts 目录导出；单测覆盖 loading、error 重试、分发与下载路径
acceptance:
  - 弹窗宽度 min(960px, 94vw)，标题栏含图标、文件名、大小或 MIME、下载、关闭五要素
  - loading 态显示 spinner，error 态显示文件已失效或被清理文案并提供重试与关闭引导（R-07）
  - 六种 RendererKey 均分发到对应渲染器且传入统一的 PreviewerProps
  - target 为 null 或 open 为 false 时不发起 blob 拉取，关闭或切换后 objectURL 被释放
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/files/__tests__/file-preview-modal.test.tsx
constraints:
  - 六渲染器静态 import 分发，不做运行时动态注册（编译期依赖渲染器文件故排在渲染器任务之后）
  - 颜色走 brand-* 语义阶与主题 token 不硬编码 hex，阴影走 var 化 token（FRONTEND_PAGE_STYLE §6）
  - 不改动三入口组件与渲染器内部实现（接入归 task-09 与 task-10）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
