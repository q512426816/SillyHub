---
author: flow-machine-draft
created_at: 2026-10-13T08:09:53.185Z
---
# 决策记录（Decisions）— 2026-10-13-session-changefiles-archive-gate

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：双条件口径若未来平台终态定义演进（如引入第四态），本 helper 需同步——缓解：helper 注释锚定三处同源文件（page.tsx/[cid]/page.tsx/mobile-change-detail.tsx），平台口径变更时 grep 可见。试过但放弃的方案：把判定改为依赖后端新增 computed 字段（如 `is_archived`）——需后端 schema 变更+gen:types，收益与前端两字段并集等价，成本不成比例（YAGNI）。已知边界：两套信号都未到平台时仍显示进行中——此为服务端同步面问题（需项目侧补推 progress 或平台 reparse 收敛），非本判定可解，已在用户反馈处置中说明。
