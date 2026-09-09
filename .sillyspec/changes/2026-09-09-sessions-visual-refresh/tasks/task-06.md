---
id: task-06
title: turn-timeline 用户/旧路径 agent 头像 + 对话视图轮尾 RoundDivider
title_zh: 时间线头像接入与轮次胶囊替换
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-attachment-markers.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
depends_on:
  - task-03
  - task-04
goal: FR-01/FR-04 旧回退路径与轮尾：用户气泡换 ChatMessageAvatar(user)；旧路径 agent 气泡挂头像；对话视图轮尾小字替换为 RoundDivider
implementation: |
  1. 用户气泡右侧手写头像 span（turn-timeline.tsx:370-378）换 ChatMessageAvatar(kind="user", name=turn.sender.name)；title/aria-label 语义保留。
  2. 旧回退路径 agent 答复气泡的 Bot 圆标（turn-timeline.tsx:476）换 ChatMessageAvatar(kind="agent")。
  3. 对话视图轮尾：现「第 N 轮 · 已完成 · token」小字行替换为 RoundDivider（label=第 N 轮，status=turn.status 六态直传，meta=token/时间）；「全部/进度」视图的 turn-status-bar 不动（Grill G-03）。
  4. 测试：用户气泡头像构件存在且 title 不变；轮尾 RoundDivider 六态中 completed/failed 各一用例；全部视图仍渲染原状态条。轮尾「第 1 轮 ·」旧断言在 turn-timeline-session-input-bar.test.tsx:84（RoundDivider label/status 分节点渲染必 break）——按新结构适配该断言。
acceptance: 三处接入完成；对话视图轮尾为胶囊分隔；全部视图零变化；turn-timeline 相关测试（含 session-input-bar 联合文件）全绿（适配后）
verify: pnpm -C frontend exec vitest run src/components/daemon/__tests__/turn-timeline 通过
constraints:
  - data-turn-key 锚点、滚动跟随、CopyButton 浮出等行为不动
  - 占位轮（pending 无 prompt）不渲染用户气泡的逻辑保持
---

## 说明

TurnUiStatus 六态（turn-timeline.tsx:122）与 RoundDividerStatus 直传对齐，无需映射层。
