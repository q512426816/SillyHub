---
author: WhaleFall
created_at: 2026-07-31T11:17:49
---

# 需求（Requirements）— /runtimes 离线只读浏览会话

## 功能需求

### FR-01 离线会话入口可见
runtime 离线时，`/runtimes` 卡片的"会话"按钮仍渲染可点（不再因 `status !== 'online'` 隐藏），点击进入会话弹窗。
- 验收：离线 runtime 卡片显示"会话"按钮（title/图标暗示只读），点击打开 RuntimeSessionDialog。

### FR-02 active 会话离线只读 + 重连恢复
离线时打开的 active（进行中）会话：保持 active 态（不转 ended），顶部显示"运行时离线，只读浏览"横幅，历史消息照常展示（DB logs），发送/打断/结束/新建禁用；runtime 重连（online）后自动恢复可操作（去横幅 + 启用按钮 + 恢复 SSE），无需手动 reopen。
- 验收：离线 active 会话只读浏览历史 + 4 操作禁用 + 横幅；重连后操作自动恢复（dialog runtimeOffline 从实时 runtimes 重查翻转）。

### FR-03 4 操作离线禁用
离线时禁用：新建会话、结束会话、打断本轮、发送（4 个）；RunErrorItem "重新发送"走既有 handleResend `!hasOnlineProvider` 守卫，离线已挡（无需叠加）。
- 验收：离线时 4 按钮 disabled；RunErrorItem 重新发送离线不可用。

### FR-04 change-session-section 隔离
共用 InteractiveSessionPanel 的 changes 页会话区（change-session-section）行为不变：`offlineReadOnly` prop 默认 false，change-session-section 不传。
- 验收：change-session-section 离线/在线行为与改前一致（回归）。

### FR-05 后端 0 改动
会话列表（listAgentSessions）/ 历史（getAgentSessionLogs）API 是 DB 查询，离线本就可用，本轮不改后端。
- 验收：后端无代码/ schema 改动；离线时前端能拉到会话列表 + 历史。

## 约束

- active 保持（不污染 view.status / session.status 机制），重连无缝恢复（非转 ended 再 reopen）
- dialog 派生 runtimeOffline 必须从实时 `runtimes` prop 重查（非 stale `runtime` prop），否则重连不生效（D-005）
- 离线 attach 不建 SSE，直接以 initialTurns（DB logs）只读渲染，不进 reconnecting 卡超时（B3）
- 共享 panel 的 offlineReadOnly 默认 false，不波及 change-session-section
- 不改后端 API / schema / page.tsx URL 恢复
