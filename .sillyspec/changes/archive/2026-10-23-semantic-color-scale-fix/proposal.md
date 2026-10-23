---
author: flow-machine-draft
created_at: 2026-10-22T23:40:11.769Z
---
# 提案书（Proposal）— 2026-10-23-semantic-color-scale-fix

## 动机

任务原话转写：修复语义色阶未定义导致的隐形状态标记

动机：上一变更评审 P3 留债——session-list-panel 的琥珀点（pending_approval/blocked「在等你」）与 agent-log/liveness-badge 五态的徽章/灯使用 warning-50/200/500/700、info-50/200/500/700、destructive-50/200/500/700，但 tailwind.config.ts 的 warning/info/destructive 只定义 DEFAULT+foreground（数字阶不存在），这些类实际零生成——状态点透明不可见、徽章软底/描边/深字全部丢失。已实证：globals.css 无对应类，config 无 safelist/plugin，全仓仅这两处使用。

成功标准：
- tailwind.config.ts 为 warning/info/destructive 补齐数字阶 50/200/500/700，基于既有语义 CSS 变量用 color-mix 派生（主题感知、无硬编码 hex，三套主题块零新增变量）
- 调用点零改动（liveness-badge 五态 + session-list-panel 两处 bg-warning-500 原样生效）
- 用真实 tailwind 构建验证 bg-warning-500 / border-warning-200 等类确实生成 CSS（非仅配置在场）
- 新增配置断言测试防复发；触及面既有测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. tailwind.config.ts 为 warning/info/destructive 补齐数字阶 50/200/500/700，基于既有语义 CSS 变量用 color-mix 派生（主题感知、无硬编码 hex，三套主题块零新增变量）
2. 调用点零改动（liveness-badge 五态 + session-list-panel 两处 bg-warning-500 原样生效）
3. 用真实 tailwind 构建验证 bg-warning-500 / border-warning-200 等类确实生成 CSS（非仅配置在场）
4. 新增配置断言测试防复发；触及面既有测试全绿

## 成功标准（可验证）

1. tailwind.config.ts 为 warning/info/destructive 补齐数字阶 50/200/500/700，基于既有语义 CSS 变量用 color-mix 派生（主题感知、无硬编码 hex，三套主题块零新增变量）
2. 调用点零改动（liveness-badge 五态 + session-list-panel 两处 bg-warning-500 原样生效）
3. 用真实 tailwind 构建验证 bg-warning-500 / border-warning-200 等类确实生成 CSS（非仅配置在场）
4. 新增配置断言测试防复发；触及面既有测试全绿
