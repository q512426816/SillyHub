---
author: flow-machine-draft
created_at: 2026-10-13T03:42:25.763Z
---
# 决策记录（Decisions）— 2026-10-13-session-taskwakeup-hide

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险是误伤用户手打的同前缀文本——该前缀由后端 TASK_WAKEUP 注入专属，用户消息不会以此开头，且既有 extract/strip 已按前缀特判多轮（2026-09-03 刷屏修复），风险口径与改前一致，不扩大。次要风险是共享文件混提交：session-log-assembler.ts / session-panel-page.tsx 工作区带有另一活跃变更（2026-10-13-subagent-stub-reconcile）的未提交 hunk，本次提交必须选择性暂存（仅暂存本变更 hunk），禁止整文件 add 裹挟。 试过但放弃的方案：①渲染侧过滤（turn-timeline / segment-view 对该前缀 return null）——需在每个渲染分支重复谓词、右栏详情面板易漏，且段数组仍被通知撑大，放弃；②后端不回传 TASK_WAKEUP user_input 日志——动协议面且丢失会话审计信息，超出小修复范围，放弃。
