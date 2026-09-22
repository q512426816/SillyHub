---
id: task-10
title: group-chat-panel 群聊消息行接头像构件（自定义头像保留）
title_zh: 群聊消息行头像接入（自定义头像保留）
allowed_paths:
  - frontend/src/components/group-chat/group-chat-panel.tsx
  - frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  - frontend/src/components/group-chat/__tests__/member-panel.test.tsx
depends_on:
  - task-03
goal: FR-01 群聊侧（D-004@v1/D-006@v2）：消息行头像统一走 ChatMessageAvatar，成员自定义头像图片能力保留
implementation: |
  1. GroupTimelineRow 消息行的 GroupMemberAvatar 渲染处换 ChatMessageAvatar：用户成员 kind="user"（name=成员名，avatar=成员 avatar 字段——有图渲染图，无图首字）；agent 成员 kind="agent"（渐变光环，保留首字/分色区分发送者——光环仅外圈氛围，D-006@v2）。
  2. 行容器 hover/选中类名走 --row-active/--border-soft token。
  3. 归并/分页/SSE 逻辑零触碰（R-04）。
  4. 新增回归用例（写进 group-chat-panel.test.tsx，该目录仅此与 member-panel 两件测试）：成员带自定义头像（/api/file/ URL）时渲染 img（mock fetchFileBlob）；无头像回退首字；agent 成员渲染光环头像。既有群聊用例全绿。
acceptance: 群聊三形态（自定义图/首字/agent 光环）各有用例；时间线行为测试零回归
verify: pnpm -C frontend exec vitest run src/components/group-chat 通过
constraints:
  - GroupMemberAvatar 上传管线/其他消费方不受影响（仅消息行渲染点替换）
  - 气泡/引用/置顶等消息行既有结构不动
---

## 说明

群聊是多发送者场景，头像的首要职责是区分发送者——分色首字保留，渐变光环不顶替身份表达。
