---
id: task-10
title: 'file-message-card + file-viewer 入口接入 + 交互测试'
title_zh: 'file-message-card + file-viewer 入口接入 + 交互测试'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-08]
blocks: [task-11]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002@v1]
expects_from:
  task-08:
    - contract: FilePreviewModal
      needs: [target, open, onClose]
allowed_paths:
  - frontend/src/components/daemon/file-message-card.tsx
  - frontend/src/components/file-viewer.tsx
  - frontend/src/components/daemon/__tests__/file-message-card.test.tsx
  - frontend/src/components/file-viewer.test.tsx
goal: >
  让 agent 文件卡片（通用形态）与文件中心查看器的非图片项都能点击弹统一预览窗
  （FR-04/FR-05），三入口体验一致；图片形态既有放大交互与既有下载能力保留不动。
implementation:
  - file-message-card.tsx 通用形态 FilePlainCard 主体 onClick 打开 FilePreviewModal，fetch 包装 fetchFileBlob(fileId)，meta 为 name/mime/size，download 复用既有 downloadFile；下载按钮 onClick 加 stopPropagation 不触发预览
  - FileThumbCard 图片形态保持 antd Image 放大不变（已达目标，避免回归）
  - file-viewer.tsx 非图片列表项在下载图标旁加预览入口点击打开 FilePreviewModal；图片网格 PreviewGroup 行为不变
  - 既有测试追加交互用例：file-message-card.test.tsx 断言卡片点击触发预览且下载不冒泡、file-viewer.test.tsx 断言预览入口存在且不删既有下载图标
acceptance:
  - 通用卡片主体点击弹预览，下载按钮独立可点不触发预览（stopPropagation）
  - file-viewer 非图片项有预览入口，既有下载图标保留
  - 图片形态（FileThumbCard 与 PreviewGroup）与现有测试断言均不失效
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/file-message-card.test.tsx
  - cd frontend && pnpm exec vitest run src/components/file-viewer.test.tsx
constraints:
  - 不改 FileThumbCard 图片形态与 file-viewer 图片网格的既有交互（兼容策略）
  - 不改 downloadFile 与 fetchFileBlob 的既有导出与语义
  - 颜色走 brand-* 语义阶不硬编码 hex
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
