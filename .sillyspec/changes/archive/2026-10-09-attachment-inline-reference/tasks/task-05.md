---
id: task-05
title: '群聊闭环：输入区接入 + handleSend 置换 + 用例'
title_zh: '群聊闭环：输入区接入 + handleSend 置换 + 用例'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
target_files:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
goal: >
  群聊输入区与单聊同款能力（右击插入/映射/镜像层/删除联动），handleSend 组装前置换（群聊无定时发送，出口仅 handleSend）。
implementation:
  - 按 task-03 同模式接入 group-chat-panel.tsx：chip onContextMenu、attTokenMap、handleRemoveAttachment 联动剥离、InputRefOverlay 挂载（高度拖拽同步）
  - handleSend（group-chat-panel.tsx:1935 附近）组装 attachmentIds 处对 draft 先 substituteAttRefsForSend 再发送；发送成功清 chips 时同步清 tokenMap
  - 用例：右击插入、同名唯一化、删附件联动、发送后 prompt 含置换文本、群聊既有附件用例零回归
acceptance:
  - group-chat-panel.test.tsx 新用例全绿且既有用例零回归
verify:
  - cd frontend && pnpm vitest run src/components/group-chat/__tests__/group-chat-panel.test.tsx
constraints:
  - 群聊 @提及/引用回复/typing 既有逻辑不动；群聊无定时发送不接该路径
---

# 群聊闭环：输入区接入 + handleSend 置换 + 用例

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
