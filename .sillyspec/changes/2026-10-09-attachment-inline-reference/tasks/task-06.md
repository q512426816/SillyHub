---
id: task-06
title: '历史渲染接入：单聊正文段与群聊气泡接 InlineAttRefText + 点击预览'
title_zh: '历史渲染接入：单聊正文段与群聊气泡接 InlineAttRefText + 点击预览'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: [task-02, task-04]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/group-chat/group-chat-panel.tsx
target_files:
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/group-chat/group-chat-panel.tsx
goal: >
  历史消息正文中的 [附件引用:uuid|name] 渲染为可点击标签，点击打开 FilePreviewModal 按 uuid 在线预览；无引用消息渲染逐字不变。
implementation:
  - turn-segment-views.tsx 用户正文段（whitespace-pre-wrap 文本节点）包 InlineAttRefText，宿主挂 FilePreviewModal（fetch 为 fetchAttachmentBlob(uuid)，与 attachment-chips.tsx:90 同链路含 officeSource）
  - group-chat-panel.tsx 气泡正文（用户/回放行）同款接入（FilePreviewModal 已有挂载点可复用 state）
  - 用例：含引用正文渲染标签并可点击开预览；无引用正文与旧消息渲染逐字不变；解析失败片段原样
acceptance:
  - 单聊/群聊历史引用渲染与点击预览用例全绿
  - 本变更前历史消息（无引用）渲染零变化
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx src/components/group-chat/__tests__/group-chat-panel.test.tsx
constraints:
  - 纯渲染层改动，不改消息存储与解析协议；React.memo 段级缓存防长文重析（R-06）
---

# 历史渲染接入：单聊正文段与群聊气泡接 InlineAttRefText + 点击预览

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
