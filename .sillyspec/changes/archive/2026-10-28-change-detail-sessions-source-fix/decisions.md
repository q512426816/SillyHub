---
author: flow-machine-draft
created_at: 2026-10-27T21:34:04.289Z
---
# 决策记录（Decisions）— 2026-10-28-change-detail-sessions-source-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：substr 64→512 放宽后单行拉回字节量增大（数百会话列表请求时放大），但 512B×N 远小于原 TOAST 全文口径，且仅标题子查询路径。评审 P1（已修复）：daemon 自愈回写 healed 原样超 title_fallback 列宽 String(64) 会使 PG 列表 500——回写截 [:64] 对齐列宽，防回归测试钉死（写回值长度断言双方言可判）。已放弃方案：① SQL 侧正则剥离（PG regexp_replace 与 SQLite 方言分叉，违反双方言约束）；② 重算存量 title_fallback 列（需迁移+回填，把小修复撑大，读侧清洗可达同显示效果）。
