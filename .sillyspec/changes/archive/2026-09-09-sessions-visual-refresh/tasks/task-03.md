---
id: task-03
title: 共享构件 ChatMessageAvatar + useAvatarSrc 平移
title_zh: 共享消息头像构件与头像取图平移
allowed_paths:
  - frontend/src/components/chat/chat-message-avatar.tsx
  - frontend/src/components/chat/use-avatar-src.ts
  - frontend/src/components/chat/__tests__/chat-message-avatar.test.tsx
  - frontend/src/components/group-chat/group-member-avatar.tsx
depends_on:
  - task-01
goal: FR-01（D-003@v1/D-006@v2）：新建共享消息头像构件；群聊自定义头像能力经 avatar 入参保留
implementation: |
  1. 新建 use-avatar-src.ts：自 group-member-avatar.tsx 平移 useAvatarSrc（文件中心 /api/file/{id} → fetchFileBlob 带 token → objectURL；http 外链直用；空/非法→null），逻辑单份不拷贝；group-member-avatar.tsx 改为从 components/chat/ import。
  2. 新建 chat-message-avatar.tsx 实现 design.md 接口定义（kind/name/avatar/size/title）：
     - kind=agent：品牌渐变底（from-brand-600 to-info）+ 外圈光环（1.5px brand-400 40% 环）+ Bot 图标（lucide），shadow-primary；
     - kind=user：avatar 非空渲染图片（useAvatarSrc 解析），否则 muted 底+name 首字大写（现 turn-timeline 头像形态）；
     - size 28/32，默认 32。
  3. 单测：agent 渐变/光环类名断言；user 无 avatar 首字回退；avatar 文件中心 URL 走 blob（mock fetchFileBlob）、外链直用；size 两档。
acceptance: 构件导出符合接口定义；group-member-avatar.tsx 不再内含 useAvatarSrc 实现（改 import）且群聊既有测试全绿（group-chat-panel/member-panel 两件套）；新单测全绿
verify: pnpm -C frontend exec vitest run src/components/chat src/components/group-chat 通过；tsc --noEmit 0 错
constraints:
  - 禁硬编码 hex（渐变/光环走 brand 语义阶类名）
  - 不改 group-member-avatar 对外 props/行为
---

## 说明

agent 侧图标用 Bot（lucide，项目已有依赖）；渐变光环用伪元素或 ring 类实现均可，以 v4 原型为准。group-member-avatar 无独立测试文件（group-chat/__tests__ 仅 group-chat-panel/member-panel 两件）——平移回归由这两件套 + 新构件单测覆盖。
