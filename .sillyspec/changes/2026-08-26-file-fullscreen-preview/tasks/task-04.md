---
id: task-04
title: 'Add fullscreen mode to file preview modal'
title_zh: 'FilePreviewModal 全屏态（fullscreen + defaultFullscreen + 工具栏按钮 + 测试）'
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1, D-004@v1, D-008@v1]
expects_from:
  task-03:
    - contract: PreviewerProps
      needs: [fill]
provides:
  - contract: FilePreviewModalProps
    fields: [defaultFullscreen, target]
allowed_paths:
  - frontend/src/components/files/file-preview-modal.tsx
  - frontend/src/components/files/__tests__/file-preview-modal.test.tsx
  - frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx
goal: >
  FilePreviewModal 增全屏态（CSS 伪全屏，D-004）——fullscreen state + defaultFullscreen
  prop + 工具栏切换按钮 + 全屏样式与 body 锁滚动，并按 fullscreen 透传 fill 给渲染器。
implementation:
  - 新增内部 state fullscreen 与 prop defaultFullscreen（open 时初始化，target 切换不重置）
  - 工具栏下载按钮左侧增全屏切换按钮，图标用 ExpandOutlined 与 CompressOutlined，aria-label 随态显示全屏或退出全屏
  - 全屏态样式——Modal width 换 100vw、content 撑满 100vh、圆角清零、body 区 flex-1；普通态维持 min(960px, 94vw) 宽与 max-h-[calc(100vh-220px)] 不变
  - 进入全屏时 document.body.style.overflow 置 hidden、退出还原并在卸载清理（参考 agent-log-viewer L836-842 先例）
  - 渲染器分发处按 fill 等于 fullscreen 布尔值透传（含 OnlyofficePreviewer 分支）；Esc 保持 antd 默认直接关窗
  - file-preview-modal.test.tsx 补全屏用例——defaultFullscreen 初始态、按钮切换、fill 透传断言
acceptance:
  - defaultFullscreen 为 true 时 open 即处于全屏态；缺省 false 时普通态样式与现状一致（零回归）
  - 点击工具栏按钮可在全屏与普通态间切换，图标与 aria-label 随态切换
  - 全屏态下分发到的渲染器收到 fill 为 true，普通态为 false
  - 组件内不存在任何 keydown 拦截（Esc 走 antd 默认直接关窗，D-008）
verify:
  - cd frontend && pnpm test -- --run src/components/files/__tests__/file-preview-modal.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
related_tests:
  - path: frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx
    reason: RENDERER_MAP 新增 html 条目引用桶文件新导出 HtmlPreviewer，该套件枚举式 vi.mock 工厂未含新导出致加载失败（QA 验收实证归因），补 mock 替身一行
constraints:
  - defaultFullscreen 缺省 false，现有四类入口（attachment-chips/file-message-card/run-file-artifacts/file-viewer）零改动零回归
  - 普通态 Modal 宽度与 max-h 类名不变，全屏态经条件类名或条件样式切换
  - Esc 不拦截——不注册任何 keydown 监听（D-008），全屏退出仅靠工具栏按钮
  - 不改渲染器内部与 registry（属 task-03）；body 锁滚动在退出与卸载时还原
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
