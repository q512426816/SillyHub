---
author: qinyi
created_at: 2026-08-25 15:35:00
plan_level: light
---
# 轻量计划（Light Plan）：/runtimes 会话入口统一为智能会话助手 + 抽屉列表换工作区树

## 来源
brainstorm 已定方案A（用户选定）：壳 store 加 lockedRuntime，SessionListPanel 加 scope:runtime 变体，悬浮抽屉换树+加宽至 ~960px，/runtimes「会话」按钮接线改为唤起悬浮。详见 design.md §3、requirements.md FR-01~05。

## 范围
- frontend/src/stores/floating-session.ts（+测试）
- frontend/src/components/sessions/session-list-panel.tsx（+测试）
- frontend/src/components/floating/floating-session-host.tsx（+测试）
- frontend/src/app/(dashboard)/runtimes/page.tsx（+测试）
- frontend/src/components/daemon/runtime-session-dialog.tsx（+2 测试，删除）

## 为什么不走 quick（用户提问登记的决策依据）
①规则 6 quick 档 ≤3 文件，本次 8 改 3 删共 11 文件超档；②quick --done 审计硬拦所有文件删除（ql-20260811 两次实测，--files/--force-baseline 全无效），而本变更必须删除旧弹窗 runtime-session-dialog.tsx 及两个测试文件，quick 收尾必被拦死。故走完整流程（plan_level=light）。

## 验收
- AC-01 /runtimes 点「会话」唤起悬浮抽屉，头部显示「🔒 {机器} · {智能体}」锁定徽标，不再渲染 RuntimeSessionDialog
- AC-02 抽屉左侧为 /sessions 同款工作区树（搜索/两层筛选/分组/归档/批量/展开记忆全保留），仅显示当前 runtime 会话
- AC-03 抽屉内「＋」新建会话钉死当前 runtime，不弹 PreSessionPicker
- AC-04 抽屉加宽至约 960px，树栏固定 320px（无 md: 视口断点布局）
- AC-05 ?session= 恢复打开抽屉并选中会话；runtime 不匹配时按全局态打开并清锁定
- AC-06 pnpm -C frontend tsc 0 错误 + floating/sessions/runtimes 三组既有测试绿
