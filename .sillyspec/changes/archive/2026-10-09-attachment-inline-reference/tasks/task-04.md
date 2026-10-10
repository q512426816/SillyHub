---
id: task-04
title: '单聊发送置换 7 点位接线（组装×4 + 定时×2 + 团队触发核对）'
title_zh: '单聊发送置换 7 点位接线（组装×4 + 定时×2 + 团队触发核对）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 13:50:14
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
goal: >
  单聊全部发送出口在 prompt 组装前应用 substituteAttRefsForSend，token 未置换直发零残留（Grill 盘点 7 点位 + 团队触发路径核对）。
implementation:
  - page/dialog 各自接收 SessionInputBar 的 onAttTokenMapChange 存 state（与 pendingAttachments 同生命周期，发送成功后随清空）
  - 7 点位应用置换：session-panel-page.tsx:2773/2909（joinAttachmentMarkers 组装前对 prompt 置换）+ session-panel-page.tsx:830（createScheduledMessage 定时直取草稿处）+ session-panel-page.tsx:3067（/team 团队触发直发处，:3251 解析消费）+ session-panel-dialog.tsx:1068/1220（组装）+ session-panel-dialog.tsx:307（定时）
  - 置换输入 = 草稿 value + tokenMap state + 当前附件列表；tokenMap 空时原样返回（零开销旁路）
acceptance:
  - 带引用草稿经普通发送/定时发送/团队触发路径发出后，落库 prompt 含 [附件引用:uuid|name] 且 uuid 与 attachment_ids 一致
  - 既有 page/dialog 附件用例零回归
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx" src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx
constraints:
  - 不动后端与 attachment_ids 参数通道；置换只发生在前端组装点
---

# 单聊发送置换 7 点位接线（组装×4 + 定时×2 + 团队触发核对）

目标与步骤见 frontmatter；验收证据（测试输出摘要）追加于本文件末尾。
