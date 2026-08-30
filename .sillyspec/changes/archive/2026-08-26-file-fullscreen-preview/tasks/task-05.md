---
id: task-05
title: 'Wire change file tree to fullscreen preview modal'
title_zh: '变更文件树接入全屏预览（非文本态改造 + 全屏按钮 + 测试）'
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: ['task-02', 'task-04']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-009@v1]
allowed_paths:
  - frontend/src/components/change-file-tree.tsx
  - frontend/src/components/__tests__/change-file-tree.test.tsx
expects_from:
  task-02:
    - contract: fetchChangeFileRaw
      needs: [blob]
  task-04:
    - contract: FilePreviewModalProps
      needs: [defaultFullscreen, target]
goal: >
  变更文件树接入统一预览弹窗（design §5 Phase 3 / FR-03）：非文本选中态从「暂不支持预览」占位改为
  图片内联 antd Image 可缩放 + 其他类型文件卡片；预览工具栏加「全屏预览」按钮以 defaultFullscreen 打开 FilePreviewModal，fetch 恒走 raw 端点（D-009）。
implementation:
  - 预览工具栏（路径行右侧、「编辑」按钮组之前）新增「全屏预览」按钮 → 组件挂 FilePreviewModal state，target.fetch 恒为 fetchChangeFileRaw(workspaceId, changeId, selected.path)（文本/图片/PDF/HTML 统一走 raw，不调 getChangeFileContent 做预览，D-009），meta.mime=null 靠 blob.type/扩展名经 matchRenderer 分发，download 用 raw blob + a.download
  - 非文本选中态改造（现 L377-380 占位替换）：图片扩展名 png/jpg/jpeg/webp/gif → useObjectUrl 拉 raw blob 构造鉴权 objectURL 内联 antd Image（内建缩放/旋转）；其余非文本 → 文件卡片（名称/大小 + 「全屏预览」引导按钮）；fetch 失败态给简单提示 + 引导下载；handleSelect 非文本分支同步驱动该数据流（文本取数路径不动）
  - 更新 change-file-tree.test.tsx：全屏入口用例（点击打开弹窗且 defaultFullscreen、fetch 走 fetchChangeFileRaw 而非 getChangeFileContent）+ 图片内联 Image 用例 + 其他非文本文件卡片用例
acceptance:
  - 选中任意文件（md/html/png 等）点「全屏预览」→ FilePreviewModal 以 defaultFullscreen 打开，target.fetch 恒为 fetchChangeFileRaw，测试断言预览路径未调用 getChangeFileContent
  - 选中 png/jpg/jpeg/webp/gif → 内联 antd Image（鉴权 objectURL 可放大）；其他非文本 → 文件卡片带全屏入口
  - 既有编辑/保存/pending 轮询/html iframe 用例零回归全绿
verify:
  - cd frontend && pnpm test -- --run src/components/__tests__/change-file-tree.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改编辑态（textarea/handleSave）与 pending 轮询逻辑，编辑仍走 getChangeFileContent/saveChangeFileContent
  - 不改 FilePreviewModal 与 fetchChangeFileRaw 本体（task-02/task-04 交付物），仅按契约消费
  - 不动 explorer 与 git-log 相关文件（task-06 / D-002 边界）
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
