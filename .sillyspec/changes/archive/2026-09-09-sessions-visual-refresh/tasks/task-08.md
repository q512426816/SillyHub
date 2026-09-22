---
id: task-08
title: session-list-panel 列表行降噪 + 选中态 token 化
title_zh: 会话列表行降噪与选中态 token 化
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
depends_on:
  - task-01
goal: FR-05（D-009@v1）：会话行重排为两行结构；选中态改 --row-active 渐变底 + --row-active-ring 内描边
implementation: |
  1. 行结构（session-list-panel.tsx:2052 附近现 border-l-[3px] 行）：改两行——第一行「标题 + 右侧等宽相对时间（tabular-nums）」，第二行「引擎标识 + 管理员 · N 轮」，未读数保留浅色胶囊位置不变。引擎标识显式复用单一源 PROVIDER_META（lib/daemon/runtimes.ts:183，claude=purple / cursor=amber / pi=pink 等已有 color 类）——列表行引擎 tag 收敛为色点+短名，色点从 PROVIDER_META.color 派生（plan 审查修正：不新写 hex）。
  2. 选中态：border-l-[3px] 硬竖条去除，改 background: var(--row-active) + box-shadow inset 0 0 0 1px var(--row-active-ring) + shadow-sm；hover bg-muted/50 保持。
  3. 活跃点加柔光晕（box-shadow 0 0 8px success 55% 透明，对应 v4 .s-dot）；空闲点弱化保持。
  4. 列表列容器（1558 行 rounded-lg border bg-card）玻璃化：bg 改 var(--glass) + backdrop-blur。
  5. 群聊分区行同构处理（同选中态 token）；测试适配类名断言。
acceptance: 行两行化且信息不丢（标题/时间/引擎/轮数/未读）；选中态 ring+渐变生效；session-list-panel 测试全绿（适配后）
verify: pnpm -C frontend exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx 通过
constraints:
  - 置顶/归档/删除等行内操作按钮与右键菜单行为不动
  - 引擎色点显式复用 PROVIDER_META 单一源（不新写 hex；plan 审查修正，替代卡内早先的错色值）
---

## 说明

行高控制住（py 不加大），避免列表变矮密度。
