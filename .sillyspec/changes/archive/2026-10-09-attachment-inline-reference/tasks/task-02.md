---
id: task-02
title: '镜像高亮层 InputRefOverlay 与历史渲染 InlineAttRefText 组件 + 单测'
title_zh: '镜像高亮层 InputRefOverlay 与历史渲染 InlineAttRefText 组件 + 单测'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03, FR-06]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/input-ref-overlay.tsx
  - frontend/src/components/daemon/attachment-ref-tag.tsx
  - frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  - frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/input-ref-overlay.tsx
  - NEW:frontend/src/components/daemon/attachment-ref-tag.tsx
  - NEW:frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  - NEW:frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
goal: >
  提供编辑态标签镜像渲染层（背景块+×角标）与历史正文引用解析渲染两个展示组件，供输入区与气泡消费。
implementation:
  - InputRefOverlay：与 textarea 同版式参数（overlayClassName/overlayStyle 透传，white-space:pre-wrap + word-break 同参）；tokens 位置渲染品牌色背景块（brand 语义阶、pointer-events:none）；× 角标独立小元素 pointer-events:auto，点击 onRemoveToken(token) 并 stopPropagation+preventDefault；tokens 为空返回 null（零视觉回归）
  - InlineAttRefText：parseInlineAttRefs 拆段渲染，text 段原样、ref 段标签样式（品牌色底），onOpenRef 缺省不渲染可点击；解析失败片段原样文本
  - 两组件单测：镜像层空 tokens 不渲染/角标点击回调/标签渲染；InlineAttRefText 拆段/点击回调/失败容错
acceptance:
  - 两组件单测全绿
  - tsc --noEmit 零错
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/input-ref-overlay.test.tsx src/components/daemon/__tests__/attachment-ref-tag.test.tsx
constraints:
  - 组件不直接操作输入区状态（受控 props）；×角标不得拦截 textarea 正常输入
---

# 镜像高亮层 InputRefOverlay 与历史渲染 InlineAttRefText 组件 + 单测

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
