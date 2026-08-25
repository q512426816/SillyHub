---
id: task-09
title: 'attachment-chips 会话附件入口接入（全部 chip 可点击）+ 交互测试'
title_zh: 'attachment-chips 会话附件入口接入（全部 chip 可点击）+ 交互测试'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-04, task-08]
blocks: [task-11]
requirement_ids: [FR-01]
decision_ids: []
expects_from:
  task-04:
    - contract: fetchAttachmentBlob
      needs: [blob]
  task-08:
    - contract: FilePreviewModal
      needs: [target, open, onClose]
allowed_paths:
  - frontend/src/components/daemon/attachment-chips.tsx
  - frontend/src/components/daemon/__tests__/attachment-chips.test.tsx
goal: >
  把会话用户消息的附件 chips 从只读标签/新窗打开改为可点击弹统一预览窗（FR-01），
  图片缩略图视觉保留，预览经 FilePreviewModal，fetch 用 fetchAttachmentBlob 包装。
implementation:
  - AttachmentChips 增加本地预览 state（当前 target 加 open），文件 chip 与图片 chip 点击均打开 FilePreviewModal
  - 构造 target：fetch 为包装 fetchAttachmentBlob(att.id) 的回调，meta 为 name 加 kind（mime 缺省由 blob.type 兜底），download 复用同 blob 保存
  - 图片 chip 移除外层 a 标签新窗打开路径，缩略图点击改为弹预览窗；拉取失败仍降级为图标 chip 不阻塞消息渲染（兼容现状）
  - 新建 __tests__/attachment-chips.test.tsx：mock FilePreviewModal 与 fetchAttachmentBlob，断言图片与文件 chip 点击均触发打开预览
acceptance:
  - 文件 chip 点击弹出预览窗（原只读行为消除），图片 chip 点击不再新开浏览器标签
  - 附件拉取失败时仍降级为图标 chip，不影响消息渲染
  - 交互测试全绿，marker 解析与 joinAttachmentMarkers 未被改动
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/attachment-chips.test.tsx
constraints:
  - 不改 runtime-session-helpers.tsx 的 parseAttachmentMarkers 与 joinAttachmentMarkers（兼容策略）
  - 不改动图片缩略图的 blob 拉取逻辑，仅改点击行为
  - 颜色沿用现有 bg-primary-foreground/10 语义，不硬编码 hex
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
