---
id: task-07
title: session-panel 面板头面包屑降噪 + 玻璃化
title_zh: 会话面板头面包屑降噪与玻璃化
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
depends_on:
  - task-01
goal: FR-07：真会话/预会话面板头元信息收敛为面包屑式一行；面板头与面板容器玻璃化
implementation: |
  1. 面板头类常量 PANEL_HEADER_CLS_* 实在 page-helpers.tsx:55-58——玻璃化改这里（背景 var(--glass) + backdrop-blur + border var(--border-soft)）；面板根容器背景改 var(--glass-heavy) + backdrop-blur（配合 task-09 极光透出）。
  2. 面板头左侧收敛面包屑：会话短 id chip（等宽小字 muted 底）+ 脉冲状态点「活跃」+ 机器（Monitor 图标）+ 工作区（FolderOpen 图标+bold）以「·」分隔；现平铺 chips 收敛。右侧操作区（对话/进度切换、搜索、打断本轮、子代理目录）只调间距。
  3. 预会话同构头（新会话标题 + 机器/工作区 chips）同款收敛。
  4. 测试适配：session-panel-variant.test.tsx:255-265 用 toBe 逐字断言头/根类名字面量——按新类名更新断言（玻璃化必 break，预期内适配）；其余 aria-label/testid 全保留。
acceptance: 面板头一行面包屑 + 右操作区；头部/面板玻璃类名生效；session-panel-variant/pre-session 等既有测试适配后全绿
verify: pnpm -C frontend exec vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx src/components/daemon/__tests__/session-panel-pre-session.test.tsx 通过
constraints:
  - 不打断 PANEL_HEADER_CLS 移动/桌面双态契约（mobile 变体同步收敛）
  - 状态点脉冲动画用既有 animate-pulse 或 globals 既有动效 token，不新增 keyframes
---

## 说明

面包屑分隔符用「·」muted 色；工作区名加粗作终点（v4 原型 .crumb-meta）。
