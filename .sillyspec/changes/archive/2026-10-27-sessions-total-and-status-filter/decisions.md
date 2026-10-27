---
author: flow-machine-draft
created_at: 2026-10-27T05:31:16.872Z
---
# 决策记录（Decisions）— 2026-10-27-sessions-total-and-status-filter

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：PC 端 SessionListPanel 体量大（~2500 行）且测试面广，「活跃→在线」改名与组内 10 条收敛可能波及既有断言文案——改动严格限定 STATUS_OPTIONS 命名 + 截断常量与在线豁免逻辑，跑该组件既有测试全量核对（该文件属本变更触及面，非全量测试）。 - 试过放弃的方案：① 后端 limit 放宽到 le=2000 让前端拉全量——放大量级敏感查询（q 搜索/links 子查询）且治标不治本（5000 条时再截），放弃；② 新增独立统计端点 GET /sessions/status-counts——多一次往返与一个 openapi 面，而 status_counts 与列表同过滤口径天然同源，并入列表响应更稳，放弃；③ 手机端 chips 计数用客户端样本估算——515>500 时计数错（正是本次要修的病根），放弃。 - 遗留已知边界：全工作区在线会话数 >500 时「在线全显」仍受单次拉取上限约束（status_group 过滤后的命中集本身 ≤limit）——不另做聚合翻页，计数仍真实（status_counts 不受 limit 影响）。
