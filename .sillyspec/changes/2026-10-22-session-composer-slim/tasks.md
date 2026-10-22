---
author: flow-machine-draft
created_at: 2026-10-22T15:08:49.335Z
---
# 任务注册表（Tasks）— 2026-10-22-session-composer-slim

- [x] task-01: 在 lib/attachment-refs.ts 新增 formatRefsForPlainText（剥离附件标记行 + 行内引用转 📎/📄/📁/🧾 文本），补 attachment-refs.test.ts 纯函数用例并跑通
- [ ] task-02: 接入展示层——message-queue-bar 摘要/展开、scheduled-messages-bar 摘要、turn-timeline 复制文本改用简化文本，更新 message-queue-bar.test.tsx 并跑通
- [ ] task-03: session-config-bar 移除 autoResume 渲染块、running 提示行与 prop，同步 session-panel-page 传参，更新 session-config-bar.test.tsx 并跑通
- [ ] task-04: session-input-bar 新增 autoResume prop 与 + 菜单「中断自动续跑」项，父层改传输入区，补 session-input-bar-plus-menu.test.tsx 用例并跑通
- [ ] task-05: ctx-usage-bar 的 QuotaPill 改为紧凑动态图标（Gauge + 最低剩余百分比，颜色阈值），点击 Popover 明细不变，更新 ctx-usage-bar.test.tsx 并跑通
- [ ] task-06: 运行触及的测试文件与 lint，记录 visual-evidence.md，确认桌面/移动端两种形态无回归
